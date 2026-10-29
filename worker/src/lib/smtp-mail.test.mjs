import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { handleSmtpSettings, getSmtpSettingsStatus, sendCorporateMail, sendSmtpMessage } from "./smtp-mail";
import worker from "../index";

const origin = "https://ai.michael.kz", host = "mail-edel.edel.kz";
const actor = { id: 1, role: "admin", auth_version: 1 };
const config = { host, port: 587, username: "direktor@edel.kz", from_address: "direktor@edel.kz", password: "fixture-application-password" };
let db, env, fake;
function statement(sql, bindings = []) {
  const execute = () => {
    const query = db.prepare(sql);
    if (query.columns().length) return { results: query.all(...bindings), success: true, meta: {} };
    const result = query.run(...bindings); return { results: [], success: true, meta: { changes: Number(result.changes) } };
  };
  return { bind: (...values) => statement(sql, values), first: async () => execute().results[0] || null, all: async () => execute(), run: async () => execute() };
}
function smtp(options = {}) {
  const commands = [], messages = [], sockets = [], connections = [];
  let authBad = false, onAuth, onData;
  function socket(secure, greeting) {
    let controller, closed = false, resolveClosed, data = false, login = 0;
    const closedPromise = new Promise(resolve => { resolveClosed = resolve; });
    const answer = text => { if (!closed) controller.enqueue(new TextEncoder().encode(text)); };
    const item = {
      secure, closedFlag: false,
      readable: new ReadableStream({ start(value) { controller = value; if (greeting && !options.stall) answer("220 fixture mail\r\n"); } }),
      writable: new WritableStream({ write(bytes) {
        const value = new TextDecoder().decode(bytes); commands.push({ secure, value });
        if (options.stall) return;
        if (data) { messages.push(value); data = false; onData?.(); answer(options.rejectData ? "550 fixture rejected\r\n" : "250 accepted\r\n"); return; }
        if (login) { if (login === 1) { login = 2; answer("334 UGFzc3dvcmQ6\r\n"); } else { login = 0; onAuth?.(); answer(authBad ? "535 fixture password echo must stay private\r\n" : "235 authenticated\r\n"); } return; }
        if (value.startsWith("EHLO")) {
          if (options.oversized) { answer("250-" + "x".repeat(17000) + "\r\n250 done\r\n"); return; }
          answer(secure ? `250-fixture\r\n250 AUTH ${options.loginOnly ? "LOGIN" : "PLAIN LOGIN"}\r\n` : `250-fixture\r\n${options.noStartTls ? "" : "250-STARTTLS\r\n"}250 SIZE 100000\r\n`); return;
        }
        if (value === "STARTTLS\r\n") { answer("220 upgrade\r\n"); return; }
        if (value.startsWith("AUTH PLAIN ")) { onAuth?.(); answer(authBad ? "535 fixture password echo must stay private\r\n" : "235 authenticated\r\n"); return; }
        if (value === "AUTH LOGIN\r\n") { login = 1; answer("334 VXNlcm5hbWU6\r\n"); return; }
        if (value.startsWith("MAIL FROM") || value.startsWith("RCPT TO")) { answer("250 ok\r\n"); return; }
        if (value === "DATA\r\n") { data = true; answer("354 continue\r\n"); return; }
        if (value === "QUIT\r\n") { answer("221 bye\r\n"); return; }
        throw new Error("Unexpected fixture SMTP command");
      } }),
      opened: options.tlsFail && secure ? Promise.reject(new Error("fixture certificate failure")) : Promise.resolve({}),
      closed: closedPromise,
      async close() { if (!closed) { closed = true; item.closedFlag = true; controller.close(); resolveClosed(); } },
      startTls(tls) { expect(tls).toEqual({ expectedServerHostname: host }); void item.close(); return socket(true, false); },
    };
    sockets.push(item); return item;
  }
  return { commands, messages, sockets, connections,
    set bad(value) { authBad = value; }, set onAuth(value) { onAuth = value; }, set onData(value) { onData = value; },
    connect(address, settings) { connections.push({ address, settings }); return socket(settings.secureTransport === "on", true); },
  };
}
beforeEach(() => {
  db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON");
  const migrations = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(file, migrations), "utf8"));
  db.exec("INSERT INTO app_users(id,username,display_name,role,password_hash,password_salt,email_address) VALUES(1,'admin','Fixture','admin','fixture','fixture','direktor@edel.kz'),(2,'manager','Fixture manager','manager','fixture','fixture','manager@edel.kz')");
  for (const id of [1, 2]) db.prepare("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES(?,?,datetime('now','+1 day'))").run(id, createHash("sha256").update(`fixture-smtp-${id}`).digest("base64"));
  fake = smtp(); env = { DB: { prepare: sql => statement(sql) }, SMTP_SETTINGS_KEY: randomBytes(32).toString("base64"), SMTP_ALLOWED_HOSTS: host, SMTP_CONNECT: fake.connect };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); db.close(); });
async function call(path = "", method = "GET", value, user = actor, headers = {}) {
  const response = await handleSmtpSettings(new Request(origin + "/api/settings/smtp" + path, {
    method, headers: { Origin: origin, "Content-Type": "application/json", ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  }), env, user);
  return { status: response.status, data: await response.json() };
}
const row = () => db.prepare("SELECT * FROM smtp_settings WHERE id=1").get();
describe("encrypted SMTP settings and private TLS transport", () => {
  it("saves only after STARTTLS, post-TLS EHLO, AUTH and QUIT; returns metadata and encrypts every credential field", async () => {
    const response = await call("", "PUT", config);
    expect(response.status).toBe(200); expect(response.data).toMatchObject({ configured: true, password_set: true, host, port: 587, username: config.username });
    expect(response.data.password).toBeUndefined(); expect(JSON.stringify(row())).not.toContain(config.password); expect(JSON.stringify(row())).not.toContain(host);
    expect(fake.commands.filter(command => command.value.startsWith("AUTH")).every(command => command.secure)).toBe(true);
    expect(fake.commands.map(command => command.value.split(" ")[0].trim())).toEqual(["EHLO", "STARTTLS", "EHLO", "AUTH", "QUIT"]);
    expect(fake.messages).toEqual([]); expect(fake.sockets.every(socket => socket.closedFlag)).toBe(true);
  });
  it("probes TLS without any credentials, storage write, AUTH or message", async () => {
    expect(await call("/probe", "POST", { host, port: 587 })).toEqual({ status: 200, data: { reachable: true, tls_verified: true, authenticated: false } });
    expect(row()).toBeUndefined(); expect(fake.commands.some(command => /AUTH|MAIL|RCPT|DATA/.test(command.value))).toBe(false);
  });
  it("supports implicit TLS and LOGIN after encryption without STARTTLS downgrade", async () => {
    fake = smtp({ loginOnly: true }); env.SMTP_CONNECT = fake.connect;
    expect((await call("", "PUT", { ...config, port: 465 })).status).toBe(200);
    expect(fake.connections[0].settings).toEqual({ secureTransport: "on", allowHalfOpen: false });
    expect(fake.commands.every(command => command.secure)).toBe(true); expect(fake.commands.some(command => command.value === "STARTTLS\r\n")).toBe(false);
  });
  it("refuses failed AUTH without overwriting existing settings or returning server diagnostics", async () => {
    expect((await call("", "PUT", config)).status).toBe(200); const before = row(); fake.bad = true;
    const response = await call("", "PUT", { ...config, password: "fixture-new-secret" });
    expect(response).toMatchObject({ status: 502, data: { error_code: "SMTP_AUTH_FAILED" } });
    expect(JSON.stringify(response)).not.toMatch(/535|echo|fixture-new-secret/); expect(row()).toEqual(before);
  });
  it("keeps an unchanged stored password on blank input, but requires it again for any changed identity", async () => {
    await call("", "PUT", config); const before = row();
    expect((await call("", "PUT", { ...config, password: "" })).status).toBe(200); expect(row().nonce).not.toBe(before.nonce);
    expect((await call("", "PUT", { ...config, username: "other@edel.kz", password: "" })).status).toBe(400);
    expect((await call("", "PUT", { ...config, port: 465, password: "" })).status).toBe(400);
  });
  it("fails before AUTH when encryption key is missing, and fails closed on ciphertext corruption or a changed key", async () => {
    delete env.SMTP_SETTINGS_KEY;
    expect((await call("", "PUT", config)).status).toBe(503); expect(fake.commands).toEqual([]);
    env.SMTP_SETTINGS_KEY = randomBytes(32).toString("base64"); await call("", "PUT", config);
    env.SMTP_SETTINGS_KEY = randomBytes(32).toString("base64"); expect((await call()).status).toBe(503);
  });
  it.each([{ noStartTls: true }, { tlsFail: true }, { oversized: true }])("closes sockets and fails on unsafe TLS/protocol responses %o", async options => {
    fake = smtp(options); env.SMTP_CONNECT = fake.connect;
    expect((await call("", "PUT", config)).status).toBe(502); expect(row()).toBeUndefined(); expect(fake.messages).toEqual([]);
    expect(fake.commands.some(command => command.value.startsWith("AUTH"))).toBe(false); expect(fake.sockets.every(socket => socket.closedFlag)).toBe(true);
  });
  it("times out stalled SMTP reads and closes the connection", async () => {
    vi.useFakeTimers(); fake = smtp({ stall: true }); env.SMTP_CONNECT = fake.connect;
    const pending = call("/probe", "POST", { host, port: 587 });
    await vi.advanceTimersByTimeAsync(25001);
    expect(await pending).toMatchObject({ status: 504, data: { error_code: "SMTP_TIMEOUT" } }); expect(fake.sockets.every(socket => socket.closedFlag)).toBe(true);
  });
  it("checks admin role, same Origin, JSON and exact public host/port allowlist before connecting", async () => {
    expect((await call("", "PUT", config, { ...actor, role: "manager" })).status).toBe(403);
    expect((await call("", "PUT", config, actor, { Origin: "https://other.example" })).status).toBe(403);
    expect((await call("", "PUT", config, actor, { "Content-Type": "text/plain" })).status).toBe(415);
    for (const target of ["127.0.0.1", "localhost", "10.0.0.1", "smtp.other.kz", "https://mail-edel.edel.kz", "user@mail-edel.edel.kz"]) expect((await call("", "PUT", { ...config, host: target })).status).toBe(400);
    expect((await call("", "PUT", { ...config, port: 25 })).status).toBe(400);
    expect((await call("", "PUT", { ...config, password: "x".repeat(8193) })).status).toBe(413); expect(fake.connections).toEqual([]);
  });
  it("rechecks administrator access after SMTP authentication before persisting a configuration", async () => {
    fake.onAuth = () => db.prepare("UPDATE app_users SET is_active=0,auth_version=2 WHERE id=1").run();
    expect((await call("", "PUT", config)).status).toBe(409); expect(row()).toBeUndefined();
  });
  it("encodes UTF-8 mail safely, uses the fixed sender, and blocks noncorporate recipients from registration transport", async () => {
    await call("", "PUT", config);
    await expect(sendCorporateMail(env, { to: "outside@example.com", subject: "Fixture", body: "Fixture" })).rejects.toMatchObject({ code: "SMTP_INPUT" });
    expect(await sendCorporateMail(env, { to: "staff@edel.kz", subject: "Подтверждение 🔐", body: "Привет\n.строка\nПисьмо" })).toEqual({ sent: true, from_address: config.from_address });
    const message = fake.messages[0]; expect(message).toContain("From: <direktor@edel.kz>"); expect(message).toContain("Content-Transfer-Encoding: base64");
    const encoded = message.split("\r\n\r\n")[1].replace(/\r\n\.\r\n$/, "").replaceAll("\r\n", "");
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("Привет\n.строка\nПисьмо");
    await expect(sendSmtpMessage(env, { to: "staff@edel.kz\r\nBCC: bad@example.com", subject: "Fixture", body: "Fixture" })).rejects.toMatchObject({ code: "SMTP_INPUT" });
  });
  it("never reports SMTP message acceptance when DATA is rejected", async () => {
    await call("", "PUT", config); fake = smtp({ rejectData: true }); env.SMTP_CONNECT = fake.connect;
    await expect(sendCorporateMail(env, { to: "staff@edel.kz", subject: "Fixture", body: "Fixture" })).rejects.toMatchObject({ code: "SMTP_SEND_FAILED" });
  });
  it("uses native SMTP only for the authenticated configured sender, leaving another mailbox on the honest legacy path", async () => {
    await call("", "PUT", config); const before = fake.commands.length;
    const health = async id => worker.fetch(new Request(origin + "/api/email/smtp/health", { headers: { Cookie: `sales_ai_session=fixture-smtp-${id}` } }), env);
    const own = await health(1); expect((await own.json()).transport).toBe("cloudflare-smtp"); expect(fake.commands.length).toBeGreaterThan(before);
    const other = await health(2); expect(await other.json()).toMatchObject({ configured: false, reachable: false, status: "not_configured" });
    expect(fake.messages).toEqual([]);
  });
  it("does not send a reply from a changed mailbox when settings change between status lookup and actual send", async () => {
    await call("", "PUT", config); const prior = row();
    await call("", "PUT", { ...config, username: "other@edel.kz", from_address: "other@edel.kz" }); const changed = row();
    db.prepare("UPDATE smtp_settings SET ciphertext=?,nonce=? WHERE id=1").run(prior.ciphertext, prior.nonce);
    const prepare = env.DB.prepare; let swapped = false;
    env.DB.prepare = sql => {
      const query = prepare(sql);
      if (!sql.startsWith("SELECT ciphertext,nonce")) return query;
      return { ...query, first: async () => {
        const captured = await query.first();
        if (!swapped) { swapped = true; db.prepare("UPDATE smtp_settings SET ciphertext=?,nonce=? WHERE id=1").run(changed.ciphertext, changed.nonce); }
        return captured;
      } };
    };
    const before = fake.commands.length;
    const response = await worker.fetch(new Request(origin + "/api/email/send", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: "sales_ai_session=fixture-smtp-1" },
      body: JSON.stringify({ to: "customer@example.com", subject: "Fixture", body: "Must not send from another sender" }),
    }), env);
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error_code: "SMTP_SENDER_CHANGED" });
    expect(fake.commands.length).toBe(before); expect(fake.messages).toEqual([]);
  });
  it.each(["before-mail", "during-data"])("handles a request transfer %s without unauthorized commands or false failed-send responses", async phase => {
    await call("", "PUT", config);
    db.exec("UPDATE app_users SET email_address='admin@edel.kz' WHERE id=1; UPDATE app_users SET email_address='direktor@edel.kz' WHERE id=2; INSERT INTO requests(id,source_type,original_text,ai_result,assigned_user_id) VALUES(22,'text_draft','Fixture','',2)");
    const transfer = () => db.prepare("UPDATE requests SET assigned_user_id=1 WHERE id=22").run();
    if (phase === "before-mail") fake.onAuth = transfer; else fake.onData = transfer;
    const response = await worker.fetch(new Request(origin + "/api/email/send", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: "sales_ai_session=fixture-smtp-2" },
      body: JSON.stringify({ request_id: 22, to: "customer@example.com", subject: "Fixture", body: "Fixture reply" }),
    }), env);
    if (phase === "before-mail") {
      expect(response.status).toBe(404); expect(fake.messages).toEqual([]);
      expect(fake.commands.some(command => command.value.startsWith("MAIL FROM"))).toBe(false);
    } else {
      expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ sent: true, audit_recorded: false }); expect(fake.messages).toHaveLength(1);
    }
    expect(db.prepare("SELECT count(*) AS n FROM request_events WHERE request_id=22").get().n).toBe(0);
  });
  it("rejects cross-origin and non-JSON authenticated reply requests before SMTP work", async () => {
    await call("", "PUT", config); const before = fake.commands.length;
    for (const [requestOrigin, contentType, status] of [["https://evil.michael.kz", "text/plain", 403], [origin, "text/plain", 415]]) {
      const response = await worker.fetch(new Request(origin + "/api/email/send", {
        method: "POST", headers: { "Content-Type": contentType, Origin: requestOrigin, Cookie: "sales_ai_session=fixture-smtp-1" },
        body: JSON.stringify({ to: "customer@example.com", subject: "Fixture", body: "Must not send" }),
      }), env);
      expect(response.status).toBe(status);
    }
    expect(fake.commands.length).toBe(before); expect(fake.messages).toEqual([]);
  });
});
