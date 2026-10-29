import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash, pbkdf2Sync, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../index";
import { PasswordKdf, SCRYPT_PROFILE } from "./password-kdf-object";

const origin = "https://ai.michael.kz";
const oldPassword = "fixture-old-password";
const newPassword = "fixture-new-password-2026";
const salt = Buffer.from("fixture-salt-123").toString("base64");
const legacyHash = (password = oldPassword, iterations = 100000) => pbkdf2Sync(password, Buffer.from(salt, "base64"), iterations, 32, "sha256").toString("base64");
let sqlite, env, adminCookie, intercept, kdfCalls;
function statement(sql, bindings = []) {
  const execute = () => {
    const prepared = sqlite.prepare(sql);
    if (prepared.columns().length) return { results: prepared.all(...bindings), success: true, meta: {} };
    const result = prepared.run(...bindings);
    return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  };
  return { bind: (...values) => statement(sql, values), first: async () => execute().results[0] || null,
    all: async () => execute(), run: async () => execute(), execute, sql };
}
const user = (id = 2) => sqlite.prepare("SELECT * FROM app_users WHERE id=?").get(id);
const sessionCount = (id = 2) => sqlite.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?").get(id).n;
function session(userId) {
  const token = randomBytes(32).toString("base64url"), version = user(userId).auth_version;
  sqlite.prepare("INSERT INTO auth_sessions(user_id,token_hash,expires_at,auth_version) VALUES(?,?,datetime('now','+1 day'),?)")
    .run(userId, createHash("sha256").update(token).digest("base64"), version);
  return `sales_ai_session=${token}`;
}
function installScrypt(password = oldPassword) {
  sqlite.prepare("UPDATE app_users SET password_scheme='scrypt-v1',password_hash=? WHERE id=2")
    .run(scryptSync(password, Buffer.from(salt, "base64"), 32, SCRYPT_PROFILE).toString("base64"));
}
async function call(path, method = "GET", data, cookie = adminCookie, options = {}) {
  const headers = { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...options.headers };
  for (const key of Object.keys(headers)) if (headers[key] === null) delete headers[key];
  const response = await worker.fetch(new Request(origin + "/api" + path, {
    method, headers, ...(data === undefined ? {} : { body: options.raw ? data : JSON.stringify(data) }),
  }), env);
  return { status: response.status, data: await response.json(), cookie: response.headers.get("Set-Cookie")?.split(";")[0] };
}
const login = (username = "staff", password = oldPassword) => call("/auth/login", "POST", { username, password }, null);

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  const folder = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(folder).filter(file => file.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, folder), "utf8"));
  const insert = sqlite.prepare("INSERT INTO app_users(id,username,display_name,role,password_hash,password_salt,password_iterations) VALUES(?,?,?,?,?,?,100000)");
  insert.run(1, "admin", "Fixture admin", "admin", legacyHash(), salt);
  insert.run(2, "staff", "Fixture staff", "accountant", legacyHash(), salt);
  const internal = new PasswordKdf(new Proxy({}, { get() { throw new Error("KDF must never use storage/state"); } }), {});
  intercept = null; kdfCalls = 0;
  env = { DB: { prepare: sql => statement(sql), batch: async entries => {
    sqlite.exec("BEGIN");
    try { const result = entries.map(entry => entry.execute()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } }, ASSETS: { fetch: vi.fn() }, PASSWORD_KDF: {
    idFromName: name => { expect(name).toBe("password-kdf-v1"); return "private-fixture"; },
    get: () => ({ fetch: async (input, init) => {
      kdfCalls++; const request = new Request(input, init);
      const run = () => internal.fetch(request);
      return intercept ? intercept(request, run) : run();
    } }),
  } };
  adminCookie = session(1);
  const actualDerive = crypto.subtle.deriveBits.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "deriveBits").mockImplementation((algorithm, ...args) => {
    if (algorithm.name === "PBKDF2" && algorithm.iterations > 100000) throw new DOMException("Production Workers cap", "NotSupportedError");
    return actualDerive(algorithm, ...args);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected external request"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sqlite.close(); });

describe("manager accounts with a real private KDF and transactional SQLite", () => {
  it("creates an independent manager, preserves the exact Unicode password, and refuses their admin operations", async () => {
    const password = "  пароль сотрудника 🔐  ";
    const created = await call("/users", "POST", { username: "  New.Manager  ", display_name: "Ирина", password });
    expect(created).toMatchObject({ status: 200, data: { username: "new.manager", display_name: "Ирина", role: "manager", is_active: 1 } });
    expect(Object.keys(created.data).some(key => /password|salt|hash|auth_version/.test(key))).toBe(false);
    const saved = user(created.data.id);
    expect(saved.password_scheme).toBe("scrypt-v1"); expect(saved.password_iterations).toBe(100000);
    expect(saved.password_hash).toBe(scryptSync(password, Buffer.from(saved.password_salt, "base64"), 32, SCRYPT_PROFILE).toString("base64"));
    const signed = await login("new.manager", password);
    expect(signed.status).toBe(200); expect(signed.cookie).toMatch(/^sales_ai_session=/);
    expect((await login("new.manager", password.trim())).status).toBe(401);
    expect((await call("/users", "GET", undefined, signed.cookie)).status).toBe(403);
    expect((await call("/users/1/password", "PATCH", { password: newPassword }, signed.cookie)).status).toBe(403);
  });

  it("resets only the selected account, preserves its role, revokes all sessions, and accepts only the new password", async () => {
    const first = session(2), second = session(2), before = user();
    const reset = await call("/users/2/password", "PATCH", { password: newPassword });
    expect(reset).toMatchObject({ status: 200, data: { id: 2, role: "accountant", sessions_revoked: true } });
    expect(user().auth_version).toBe(before.auth_version + 1); expect(user().password_scheme).toBe("scrypt-v1");
    expect(sessionCount()).toBe(0); expect(sessionCount(1)).toBe(1);
    expect((await call("/users", "GET", undefined, first)).status).toBe(401);
    expect((await call("/users", "GET", undefined, second)).status).toBe(401);
    expect((await login("staff", oldPassword)).status).toBe(401);
    expect((await login("staff", newPassword))).toMatchObject({ status: 200, data: { user: { id: 2, role: "accountant" } } });
  });

  it("invalidates the administrator's own session after self reset", async () => {
    expect((await call("/users/1/password", "PATCH", { password: newPassword })).status).toBe(200);
    expect((await call("/users", "GET")).status).toBe(401);
    expect((await login("admin", newPassword)).status).toBe(200);
  });

  it("upgrades a correct legacy password only after exact-cost verification, including legacy 600000", async () => {
    sqlite.prepare("UPDATE app_users SET password_hash=?,password_iterations=600000 WHERE id=2").run(legacyHash(oldPassword, 600000));
    expect((await login()).status).toBe(200);
    expect(user()).toMatchObject({ password_scheme: "scrypt-v1", password_iterations: 600000, auth_version: 1 });
    expect(kdfCalls).toBe(2); // Exact legacy verification, then new scrypt derivation.
  });

  it("keeps a correct legacy login usable when the optional KDF upgrade is temporarily unavailable", async () => {
    const before = user(); intercept = async () => new Response("unavailable", { status: 503 });
    expect((await login()).status).toBe(200); expect(user().password_hash).toBe(before.password_hash);
    expect(user().password_scheme).toBe("pbkdf2-sha256");
  });

  it("does not reset or create an account when the private KDF is unavailable", async () => {
    const before = user(); const cookie = session(2);
    intercept = async () => new Response("unavailable", { status: 503 });
    expect((await call("/users/2/password", "PATCH", { password: newPassword }))).toMatchObject({ status: 503, data: { error_code: "AUTH_HASH_UNAVAILABLE" } });
    expect((await call("/users", "POST", { username: "new", password: newPassword })).status).toBe(503);
    expect(user()).toEqual(before); expect(sqlite.prepare("SELECT count(*) AS n FROM app_users").get().n).toBe(2);
    expect((await call("/auth/me", "GET", undefined, cookie)).status).toBe(200);
  });

  it("rolls the password and version back if session revocation fails in the same batch", async () => {
    session(2); const before = user(), original = env.DB.batch;
    env.DB.batch = async entries => {
      if (entries.some(entry => entry.sql.includes("DELETE FROM auth_sessions"))) {
        entries[1] = statement("INSERT INTO fixture_missing_table VALUES (1)");
      }
      return original(entries);
    };
    expect((await call("/users/2/password", "PATCH", { password: newPassword })).status).toBe(500);
    expect(user()).toEqual(before); expect(sessionCount()).toBe(1);
  });

  it.each(["verify-scrypt", "derive-scrypt"])("cannot create an old-password session after a concurrent reset (%s)", async operation => {
    if (operation === "verify-scrypt") installScrypt();
    let release, signalStarted, held = false;
    const started = new Promise(resolve => { signalStarted = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    intercept = async (request, run) => {
      const payload = await request.clone().json();
      const response = await run();
      if (payload.operation === operation && payload.password === oldPassword && !held) {
        held = true; signalStarted(); await gate;
      }
      return response;
    };
    const pending = login(); await started;
    expect((await call("/users/2/password", "PATCH", { password: newPassword })).status).toBe(200);
    const afterReset = user(); release();
    const result = await pending;
    expect(result.status).toBe(401); expect(result.cookie).toBeUndefined(); expect(sessionCount()).toBe(0);
    expect(user().password_hash).toBe(afterReset.password_hash); expect(user().auth_version).toBe(afterReset.auth_version);
    expect((await login("staff", newPassword)).status).toBe(200);
  });

  it.each(["create", "reset"])("rechecks the administrator after hashing before %s", async operation => {
    const before = user();
    intercept = async (_request, run) => {
      const response = await run();
      sqlite.prepare("UPDATE app_users SET is_active=0,auth_version=auth_version+1 WHERE id=1").run();
      return response;
    };
    const response = operation === "reset"
      ? await call("/users/2/password", "PATCH", { password: newPassword })
      : await call("/users", "POST", { username: "new-staff", password: newPassword });
    expect(response.status).toBe(403); expect(user()).toEqual(before);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM app_users").get().n).toBe(2);
  });

  it("disables access atomically and never revives an older session on reactivation", async () => {
    const cookie = session(2), before = user().auth_version;
    expect((await call("/users/2/active", "PATCH", { is_active: false })).status).toBe(200);
    expect(user().auth_version).toBe(before + 1); expect(sessionCount()).toBe(0);
    expect((await call("/users", "GET", undefined, cookie)).status).toBe(401);
    expect((await call("/users/2/active", "PATCH", { is_active: true })).status).toBe(200);
    expect(user().auth_version).toBe(before + 2);
    expect((await call("/users", "GET", undefined, cookie)).status).toBe(401);
    // Version comparison also rejects a stale row if a failed cleanup had left it behind.
    const token = cookie.split("=")[1];
    sqlite.prepare("INSERT INTO auth_sessions(user_id,token_hash,expires_at,auth_version) VALUES(2,?,datetime('now','+1 day'),?)")
      .run(createHash("sha256").update(token).digest("base64"), before);
    expect((await call("/users", "GET", undefined, cookie)).status).toBe(401);
  });

  it("returns safe conflicts and rejects invalid usernames, roles, email and password boundaries before KDF", async () => {
    const invalid = [
      { username: "" }, { username: "bad login" }, { username: "a".repeat(65) }, { username: "кириллица" },
      { username: "new", role: "superuser" }, { username: "new", display_name: "a".repeat(201) },
      { username: "new", email_address: "person@outside.test" }, { username: "new", email_address: "a".repeat(255) },
      { username: "new", email_address: "Staff <staff@edel.kz>" },
      { username: "new", password: "a".repeat(11) }, { username: "new", password: "a".repeat(257) },
      { username: "new", auth_version: 1 },
    ];
    for (const fields of invalid) expect((await call("/users", "POST", { password: newPassword, ...fields })).status).toBe(400);
    expect((await call("/users", "POST", { username: "  STAFF ", password: newPassword }))).toMatchObject({ status: 409, data: { detail: expect.any(String) } });
    expect(kdfCalls).toBe(0);
  });

  it.each([12, 256])("accepts the exact %i-character boundary for a new password and can authenticate it", async length => {
    const password = "я".repeat(length), username = length === 12 ? "x" : "x".repeat(64);
    expect((await call("/users", "POST", { username, password })).status).toBe(200);
    expect((await login(username, password)).status).toBe(200);
  });

  it("returns a safe conflict if another admin creates the same normalized login during hashing", async () => {
    intercept = async (_request, run) => {
      const response = await run();
      sqlite.prepare("INSERT INTO app_users(username,display_name,role,password_hash,password_salt) VALUES('concurrent','Fixture','manager',?,?)")
        .run(legacyHash(), salt);
      return response;
    };
    expect((await call("/users", "POST", { username: "Concurrent", password: newPassword })))
      .toMatchObject({ status: 409, data: { detail: "Этот логин уже занят. Выберите другой." } });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM app_users WHERE username='concurrent'").get().n).toBe(1);
  });

  it.each(["/users", "/users/2/password", "/users/2/email", "/users/2/active"])("requires same-site JSON for %s and bounds streamed bodies", async path => {
    const method = path === "/users" ? "POST" : "PATCH";
    const data = path.endsWith("/active") ? { is_active: false } : path.endsWith("/email") ? { email_address: "staff@edel.kz" } : { username: "new", password: newPassword };
    expect((await call(path, method, data, adminCookie, { headers: { Origin: "https://foreign.test" } })).status).toBe(403);
    expect((await call(path, method, data, adminCookie, { headers: { Origin: null } })).status).toBe(403);
    expect((await call(path, method, data, adminCookie, { headers: { "Content-Type": "text/plain" } })).status).toBe(415);
    expect((await call(path, method, " ".repeat(8193), adminCookie, { raw: true })).status).toBe(413);
    expect(user().is_active).toBe(1); expect(kdfCalls).toBe(0);
  });

  it("requires browser Origin for login/logout, caps login JSON, and leaves server ingest unaffected", async () => {
    expect((await call("/auth/login", "POST", { username: "staff", password: oldPassword }, null, { headers: { Origin: null } })).status).toBe(403);
    expect((await call("/auth/login", "POST", " ".repeat(4097), null, { raw: true })).status).toBe(413);
    expect((await call("/auth/logout", "POST", undefined, adminCookie, { headers: { Origin: "https://foreign.test" } })).status).toBe(403);
    expect((await call("/users", "GET")).status).toBe(200);
    expect((await call("/auth/logout", "POST", undefined)).status).toBe(200);
    expect((await call("/users", "GET")).status).toBe(401);
  });
});

describe("private PasswordKdf protocol", () => {
  const internalRequest = (payload, overrides = {}) => new Request("https://password-kdf.internal/v1/password", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), ...overrides,
  });
  const instance = () => new PasswordKdf(new Proxy({}, { get() { throw new Error("No persistence allowed"); } }), {});
  it("uses the fixed native scrypt profile and constant-size comparison for correct and incorrect passwords", async () => {
    const object = instance(), payload = { operation: "derive-scrypt", password: newPassword, salt };
    const response = await object.fetch(internalRequest(payload)), result = await response.json();
    expect(response.status).toBe(200); expect(result.hash).toBe(scryptSync(newPassword, Buffer.from(salt, "base64"), 32, SCRYPT_PROFILE).toString("base64"));
    expect(await (await object.fetch(internalRequest({ ...payload, operation: "verify-scrypt", hash: result.hash }))).json()).toEqual({ matches: true });
    expect(await (await object.fetch(internalRequest({ ...payload, operation: "verify-scrypt", hash: result.hash, password: "wrong-fixture" }))).json()).toEqual({ matches: false });
  });
  it.each([100000, 600000])("matches the standard Node PBKDF2-SHA256 vector at exactly %i iterations", async iterations => {
    const object = instance(), hash = legacyHash(oldPassword, iterations);
    expect(await (await object.fetch(internalRequest({ operation: "verify-pbkdf2", password: oldPassword, salt, hash, iterations }))).json()).toEqual({ matches: true });
    expect(await (await object.fetch(internalRequest({ operation: "verify-pbkdf2", password: newPassword, salt, hash, iterations }))).json()).toEqual({ matches: false });
  });
  it("rejects unbounded profiles, unknown operations, invalid sizes and oversized JSON", async () => {
    const object = instance(), valid = { operation: "derive-scrypt", password: newPassword, salt };
    const invalid = [{ ...valid, N: 2 }, { ...valid, iterations: 1 }, { ...valid, operation: "store" },
      { ...valid, password: "a".repeat(257) }, { ...valid, salt: "bad" }, { ...valid, hash: legacyHash() },
      { ...valid, operation: "verify-pbkdf2", hash: legacyHash(), iterations: 100001 },
      { ...valid, operation: "verify-scrypt", hash: "bad" }, { ...valid, password: "a".repeat(4096) }];
    for (const payload of invalid) expect((await object.fetch(internalRequest(payload))).status).toBe(400);
    expect((await object.fetch(new Request("https://ai.michael.kz/v1/password"))).status).toBe(404);
  });
});
