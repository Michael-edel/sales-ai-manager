import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../index";

const origin = "https://ai.michael.kz";
const fixturePassword = "fixture-only-wrong-password";
let sqlite, env, kdfCalls, userLookups, intercept;
function statement(sql, bindings = []) {
  const execute = () => {
    if (/SELECT \* FROM app_users WHERE/.test(sql)) userLookups++;
    const prepared = sqlite.prepare(sql);
    if (prepared.columns().length) return { results: prepared.all(...bindings), success: true, meta: {} };
    const result = prepared.run(...bindings);
    return { results: [], success: true, meta: { changes: Number(result.changes) } };
  };
  return { bind: (...values) => statement(sql, values), first: async () => execute().results[0] || null,
    all: async () => execute(), run: async () => execute() };
}
const ipKey = ip => `ip:v1:${createHash("sha256").update(ip).digest("base64")}`;
const pairKey = (username, ip) => createHash("sha256").update(`${username}|${ip}`).digest("base64");
const attempt = key => sqlite.prepare("SELECT * FROM auth_login_attempts WHERE attempt_key=?").get(key);
async function login(username, ip = "192.0.2.1", extraHeaders = {}) {
  const response = await worker.fetch(new Request(origin + "/api/auth/login", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json",
      ...(ip === null ? {} : { "CF-Connecting-IP": ip }), ...extraHeaders },
    body: JSON.stringify({ username, password: fixturePassword }),
  }), env);
  return { status: response.status, data: await response.json(), retryAfter: Number(response.headers.get("Retry-After")) };
}
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  const folder = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(folder).filter(file => file.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(new URL(file, folder), "utf8"));
  sqlite.prepare("INSERT INTO app_users(username,display_name,role,password_hash,password_salt,password_iterations) VALUES('fixture-admin','Fixture','admin',?,?,100000)")
    .run(Buffer.alloc(32).toString("base64"), Buffer.alloc(16).toString("base64"));
  kdfCalls = 0; userLookups = 0; intercept = null;
  env = { DB: { prepare: sql => statement(sql) }, ASSETS: { fetch: vi.fn() }, PASSWORD_KDF: {
    idFromName: () => "fixture-private", get: () => ({ fetch: async () => {
      kdfCalls++;
      if (intercept) await intercept();
      return Response.json({ matches: false });
    } }),
  } };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); sqlite.close(); });

describe("atomic login throttling before user lookup and password work", () => {
  it("bounds parallel rotating usernames from one IP to twenty KDF calls and does not extend a denied window", async () => {
    const replies = await Promise.all(Array.from({ length: 25 }, (_, index) => login(`missing-${index}`)));
    expect(replies.filter(reply => reply.status === 401)).toHaveLength(20);
    const denied = replies.filter(reply => reply.status === 429);
    expect(denied).toHaveLength(5);
    expect(denied.every(reply => reply.retryAfter > 0 && reply.retryAfter <= 900)).toBe(true);
    expect(kdfCalls).toBe(20); expect(userLookups).toBe(20);
    const before = attempt(ipKey("192.0.2.1"));
    expect(before.failed_count).toBe(20);
    expect((await login("another-name")).status).toBe(429);
    expect(attempt(ipKey("192.0.2.1"))).toEqual(before);
    expect(kdfCalls).toBe(20); expect(userLookups).toBe(20);
  });

  it("atomically records five simultaneous failures for the same pair before blocking its sixth attempt", async () => {
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const allStarted = new Promise(resolve => { started = resolve; });
    intercept = async () => { if (kdfCalls === 5) started(); await gate; };
    const pending = Array.from({ length: 5 }, () => login("same-user"));
    await allStarted; release();
    expect((await Promise.all(pending)).map(reply => reply.status)).toEqual([401, 401, 401, 401, 401]);
    const saved = attempt(pairKey("same-user", "192.0.2.1"));
    expect(saved.failed_count).toBe(5); expect(saved.blocked_until).toBeTruthy();
    expect((await login("same-user")).status).toBe(429);
    expect(kdfCalls).toBe(5); expect(userLookups).toBe(5);
    expect((await login("different-user")).status).toBe(401);
  });

  it("opens a fresh fixed window after expiry and keeps unrelated IPs independent", async () => {
    for (let index = 0; index < 20; index++) await login(`missing-${index}`);
    expect((await login("blocked")).status).toBe(429);
    expect((await login("independent", "192.0.2.2")).status).toBe(401);
    sqlite.prepare("UPDATE auth_login_attempts SET window_started_at=datetime('now','-16 minutes'),blocked_until=datetime('now','-1 minute') WHERE attempt_key=?")
      .run(ipKey("192.0.2.1"));
    expect((await login("next-window")).status).toBe(401);
    expect(attempt(ipKey("192.0.2.1")).failed_count).toBe(1);
    expect(attempt(ipKey("192.0.2.2")).failed_count).toBe(1);
    expect(kdfCalls).toBe(22);
  });

  it("does not trust a client-selected forwarded IP when platform metadata is absent", async () => {
    for (let index = 0; index < 20; index++) {
      expect((await login(`missing-${index}`, null, { "X-Forwarded-For": `198.51.100.${index}` })).status).toBe(401);
    }
    expect((await login("rotated-forwarded", null, { "X-Forwarded-For": "203.0.113.42" })).status).toBe(429);
    expect(attempt(ipKey("unknown")).failed_count).toBe(20); expect(kdfCalls).toBe(20);
  });
});
