import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash, pbkdf2Sync } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../index";

const fixturePassword = "fixture-local-password-16";
const salt = Buffer.from("fixture-salt-123").toString("base64");
const hash = iterations => pbkdf2Sync(fixturePassword, Buffer.from(salt, "base64"), iterations, 32, "sha256").toString("base64");
let sqlite, env, derive, actualDerive;
function statement(sql, bindings = []) {
  const execute = () => {
    const prepared = sqlite.prepare(sql);
    if (prepared.columns().length) return { results: prepared.all(...bindings), success: true, meta: {} };
    const result = prepared.run(...bindings);
    return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  };
  return { bind: (...values) => statement(sql, values), first: async () => execute().results[0] || null,
    all: async () => execute(), run: async () => execute(), execute };
}
function savedPassword() {
  return sqlite.prepare("SELECT password_hash,password_salt,password_iterations FROM app_users WHERE id=1").get();
}
function count(table) { return sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  const folder = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(folder).filter(file => file.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(new URL(file, folder), "utf8"));
  sqlite.prepare("INSERT INTO app_users(id,username,display_name,role,password_hash,password_salt,password_iterations) VALUES(1,'manager','Fixture admin','admin',?,?,100000)")
    .run(hash(100000), salt);
  env = { DB: { prepare: sql => statement(sql), batch: async entries => {
    sqlite.exec("BEGIN");
    try { const result = entries.map(entry => entry.execute()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } }, ASSETS: { fetch: vi.fn() } };
  // Node and local Wrangler accept 600,000; emulate the production Workers cap.
  actualDerive = crypto.subtle.deriveBits.bind(crypto.subtle);
  derive = vi.spyOn(crypto.subtle, "deriveBits").mockImplementation(async (algorithm, ...args) => {
    if (algorithm.name === "PBKDF2" && algorithm.iterations > 100000)
      throw new DOMException(`Pbkdf2 failed: iteration counts above 100000 are not supported (requested ${algorithm.iterations})`, "NotSupportedError");
    return actualDerive(algorithm, ...args);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected external request from login"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sqlite.close(); });
async function call(path, method, data, cookie) {
  const response = await worker.fetch(new Request("https://ai.michael.kz/api" + path, {
    method, headers: { "Content-Type": "application/json", Origin: "https://ai.michael.kz", ...(cookie ? { Cookie: cookie } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), env);
  return { status: response.status, data: await response.json(), cookie: response.headers.get("Set-Cookie")?.split(";")[0] };
}
const login = (username = "manager", password = fixturePassword) => call("/auth/login", "POST", { username, password });

describe("login under the actual Workers PBKDF2 ceiling", () => {
  it("verifies a legacy password and opens a normal authenticated session without rewriting its hash", async () => {
    const before = savedPassword();
    const response = await login();
    expect(response.status).toBe(200); expect(response.data.user).toMatchObject({ username: "manager", role: "admin" });
    expect(response.cookie).toMatch(/^sales_ai_session=/);
    expect(savedPassword()).toEqual(before);
    expect(derive.mock.calls.map(([algorithm]) => algorithm.iterations)).toEqual([100000]);
    expect(count("auth_sessions")).toBe(1);
    const session = sqlite.prepare("SELECT token_hash FROM auth_sessions").get();
    expect(session.token_hash).toBe(createHash("sha256").update(response.cookie.split("=")[1]).digest("base64"));
    expect((await call("/health", "GET", undefined, response.cookie)).status).toBe(200);
  });

  it.each(["manager", "missing-user"])("returns JSON 401 for wrong credentials (%s), never an escaped runtime exception", async username => {
    const before = savedPassword();
    const response = await login(username, "fixture-wrong-password");
    expect(response).toMatchObject({ status: 401, data: { detail: "Неверное имя пользователя или пароль." } });
    expect(response.cookie).toBeUndefined(); expect(count("auth_sessions")).toBe(0);
    expect(savedPassword()).toEqual(before);
    expect(derive.mock.calls.map(([algorithm]) => algorithm.iterations)).toEqual([100000]);
    expect(count("auth_login_attempts")).toBe(2); // One reserved IP window and one failed username/IP pair.
  });

  it("keeps the five-failure throttling gate and does not bypass it with crypto fallback", async () => {
    for (let attempt = 0; attempt < 5; attempt++) expect((await login("manager", "wrong-fixture")).status).toBe(401);
    expect((await login()).status).toBe(429); expect(count("auth_sessions")).toBe(0);
    expect(derive).toHaveBeenCalledTimes(5);
  });

  it("refuses an unsupported stored stronger hash instead of lowering its work factor or creating a session", async () => {
    sqlite.prepare("UPDATE app_users SET password_hash=?,password_iterations=600000 WHERE id=1").run(hash(600000));
    const before = savedPassword();
    const response = await login();
    expect(response).toMatchObject({ status: 503, data: { error_code: "AUTH_HASH_UNAVAILABLE" } });
    expect(JSON.stringify(response.data)).not.toContain(fixturePassword);
    expect(savedPassword()).toEqual(before); expect(count("auth_sessions")).toBe(0);
    expect(count("auth_login_attempts")).toBe(1); // KDF failure still consumes its bounded IP reservation.
  });

  it("does not overwrite passwords, revoke sessions or create users when strong hashing is unavailable", async () => {
    const session = await login(), before = savedPassword();
    const reset = await call("/users/1/password", "PATCH", { password: "fixture-new-password-32" }, session.cookie);
    const create = await call("/users", "POST", { username: "newfixture", display_name: "Fixture", role: "manager", password: "fixture-new-password-32" }, session.cookie);
    expect(reset).toMatchObject({ status: 503, data: { error_code: "AUTH_HASH_UNAVAILABLE" } });
    expect(create).toMatchObject({ status: 503, data: { error_code: "AUTH_HASH_UNAVAILABLE" } });
    expect(savedPassword()).toEqual(before); expect(count("app_users")).toBe(1); expect(count("auth_sessions")).toBe(1);
    expect((await call("/health", "GET", undefined, session.cookie)).status).toBe(200);
  });

  it("fails closed when initial strong administrator hashing is unsupported", async () => {
    sqlite.exec("DELETE FROM app_users"); env.ACCESS_PASSWORD = fixturePassword;
    const response = await login();
    expect(response).toMatchObject({ status: 503, data: { error_code: "AUTH_HASH_UNAVAILABLE" } });
    expect(count("app_users")).toBe(0); expect(count("auth_sessions")).toBe(0);
  });

  it("does not swallow unrelated crypto verification failures", async () => {
    const before = savedPassword();
    derive.mockImplementation(async (algorithm, ...args) => {
      throw new Error("fixture crypto failure");
    });
    const response = await login();
    expect(response.status).toBe(500); expect(response.data.error_id).toEqual(expect.any(String));
    expect(response.cookie).toBeUndefined(); expect(count("auth_sessions")).toBe(0); expect(savedPassword()).toEqual(before);
  });

  it("awaits asynchronous login failures so database quota errors stay structured JSON", async () => {
    const prepare = env.DB.prepare;
    env.DB.prepare = sql => sql.includes("SELECT blocked_until")
      ? { bind: () => ({ first: async () => { throw new Error("Your account has exceeded D1's free tier daily row read limit."); } }) }
      : prepare(sql);
    const response = await login();
    expect(response).toMatchObject({ status: 503, data: { error_code: "D1_DAILY_LIMIT" } });
    expect(count("auth_sessions")).toBe(0);
  });

  it("awaits ingest failures so the backlog worker receives the daily-quota stop signal", async () => {
    env.EMAIL_INGEST_TOKEN = "fixture-ingest-token";
    env.DB.prepare = () => { throw new Error("Your account has exceeded D1's free tier daily row read limit."); };
    const response = await worker.fetch(new Request("https://ai.michael.kz/api/email/ingest", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer fixture-ingest-token" },
      body: JSON.stringify({ mailbox_email: "fixture@example.test", message_uid: "fixture-mail-1" }),
    }), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error_code: "D1_DAILY_LIMIT" });
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
