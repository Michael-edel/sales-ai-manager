import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { scryptSync } from 'node:crypto';
import { handleEmailRegistration } from './email-registration';
import { PasswordKdf, SCRYPT_PROFILE } from './password-kdf-object';
let sqlite, env, delivered, calls;
const origin = 'https://ai.michael.kz';
function statement(sql, bindings = []) {
  const execute = () => {
    const p = sqlite.prepare(sql);
    if (p.columns().length) return { success: true, results: p.all(...bindings), meta: {} };
    const result = p.run(...bindings); return { success: true, results: [], meta: { changes: Number(result.changes) } };
  };
  return { bind: (...values) => statement(sql, values), first: async () => execute().results[0] || null,
    all: async () => execute(), run: async () => execute(), execute };
}
async function call(path = '', data = { email: 'anna@edel.kz', display_name: 'Анна' }, extra = {}) {
  const request = new Request(origin + '/api/auth/registration' + path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.15', ...extra.headers }, body: JSON.stringify(data),
  });
  const r = await handleEmailRegistration(request, env);
  return { status: r.status, data: await r.json() };
}
const token = () => new URL(delivered.at(-1).body.match(/https:\/\/[^\s]+/)[0]).searchParams.get('registration_token');
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = new URL('../../migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(name, dir), 'utf8'));
  delivered = []; calls = 0;
  const kdf = new PasswordKdf({}, {});
  env = { DB: { prepare: sql => statement(sql), batch: async statements => {
    sqlite.exec('BEGIN'); try { const values = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return values; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } }, EMAIL_BRIDGE_URL: 'https://mail-bridge.example', EMAIL_BRIDGE_TOKEN: 'test-only-bridge-token', REGISTRATION_FROM_EMAIL: 'sender@edel.kz',
    PASSWORD_KDF: { idFromName: x => x, get: () => ({ fetch: (url, options) => { calls++; return kdf.fetch(new Request(url, options)); } }) } };
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => { delivered.push(JSON.parse(options.body)); return Response.json({ sent: true }); }));
});
afterEach(() => { vi.unstubAllGlobals(); sqlite.close(); });

describe('email ownership before employee account activation', () => {
  it('sends a one-time corporate link without creating any user or accepting a password upfront', async () => {
    expect(await call()).toMatchObject({ status: 202, data: { accepted: true } });
    expect(delivered).toHaveLength(1); expect(delivered[0].to).toBe('anna@edel.kz');
    expect(sqlite.prepare('SELECT COUNT(*) n FROM app_users').get().n).toBe(0);
    const raw = token(), row = sqlite.prepare('SELECT * FROM auth_email_registrations').get();
    expect(raw).toMatch(/^[\w-]{43}$/); expect(JSON.stringify(row)).not.toContain(raw); expect(row.token_hash).toHaveLength(64);
    expect(calls).toBe(0);
    expect(await call('', { email: 'other@edel.kz', display_name: 'Другой', password: 'not-accepted-upfront' })).toMatchObject({ status: 400 });
  });
  it('activates only a manager after proof, preserves the exact chosen password, and refuses token replay', async () => {
    await call(); const raw = token(), password = '  Пароль Анны 🔐  ';
    expect(await call('/verify', { token: raw, password })).toMatchObject({ status: 201, data: { registered: true, email: 'anna@edel.kz' } });
    const user = sqlite.prepare('SELECT * FROM app_users').get();
    expect(user).toMatchObject({ username: 'anna@edel.kz', role: 'manager', email_address: 'anna@edel.kz', password_scheme: 'scrypt-v1', is_active: 1 });
    expect(user.password_hash).toBe(scryptSync(password, Buffer.from(user.password_salt, 'base64'), 32, SCRYPT_PROFILE).toString('base64'));
    expect(sqlite.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n).toBe(0);
    expect(await call('/verify', { token: raw, password: 'another-password-2026' })).toMatchObject({ status: 410 });
    expect(calls).toBe(1);
  });
  it('rejects expired links before doing a KDF and does not consume a link for malformed passwords', async () => {
    await call(); const raw = token();
    expect(await call('/verify', { token: raw, password: 'short' })).toMatchObject({ status: 400 });
    expect(sqlite.prepare('SELECT consumed_at FROM auth_email_registrations').get().consumed_at).toBe(null);
    sqlite.exec("UPDATE auth_email_registrations SET expires_at=datetime('now','-1 second')");
    expect(await call('/verify', { token: raw, password: 'valid-long-password' })).toMatchObject({ status: 410 }); expect(calls).toBe(0);
  });
  it('enforces the corporate domain, origin and fixed manager role', async () => {
    for (const email of ['a@gmail.com', 'a@edel.kz.evil', 'a@еdel.kz', 'a\r\n@edel.kz'])
      expect(await call('', { email, display_name: 'Test' })).toMatchObject({ status: 400 });
    expect(await call('', { email: 'anna@edel.kz', display_name: 'Анна' }, { headers: { Origin: 'https://evil.example' } })).toMatchObject({ status: 403 });
    await call(); expect(await call('/verify', { token: token(), password: 'long-enough-password', role: 'admin' })).toMatchObject({ status: 400 });
    expect(delivered).toHaveLength(1);
  });
  it('fails honestly when SMTP is missing or rejects a message and invalidates an undelivered link', async () => {
    env.EMAIL_BRIDGE_URL = ''; expect(await call()).toMatchObject({ status: 503, data: { error_code: 'REGISTRATION_MAIL_UNAVAILABLE' } });
    env.EMAIL_BRIDGE_URL = 'https://mail-bridge.example'; vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sent: false }, { status: 502 })));
    expect(await call()).toMatchObject({ status: 503 });
    expect(sqlite.prepare('SELECT token_hash FROM auth_email_registrations').get().token_hash).toBe(null);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM app_users').get().n).toBe(0);
  });
  it('uses Workers-compatible manual redirects and refuses a mail-service redirect', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      expect(options.redirect).toBe('manual');
      return Response.json({ sent:true }, { status:302, headers:{Location:'https://untrusted.example'} });
    }));
    expect(await call()).toMatchObject({status:503,data:{error_code:'REGISTRATION_MAIL_UNAVAILABLE'}});
    expect(sqlite.prepare('SELECT token_hash FROM auth_email_registrations').get().token_hash).toBe(null);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM app_users').get().n).toBe(0);
  });
  it('does not change an existing account or tell the public whether it exists', async () => {
    await call(); await call('/verify', { token: token(), password: 'my-existing-password' });
    const before = sqlite.prepare('SELECT password_hash,role,auth_version FROM app_users').get();
    const again = await call(); expect(again).toMatchObject({ status: 202 });
    expect(delivered.at(-1).body).not.toContain('registration_token=');
    expect(sqlite.prepare('SELECT password_hash,role,auth_version FROM app_users').get()).toEqual(before);
  });
  it('rate-limits concurrent rotated emails before sending and ignores spoofed X-Forwarded-For', async () => {
    const results = await Promise.all(Array.from({ length: 13 }, (_, i) => call('', { email: 'staff' + i + '@edel.kz', display_name: 'Staff' }, { headers: { 'X-Forwarded-For': String(i) } })));
    expect(results.filter(x => x.status === 202)).toHaveLength(10); expect(results.filter(x => x.status === 429)).toHaveLength(3); expect(delivered).toHaveLength(10);
  });
  it('ignores link previews and status checks and cannot be activated with a fabricated token', async () => {
    const get = await handleEmailRegistration(new Request(origin + '/api/auth/registration/status'), env);
    expect(await get.json()).toEqual({ enabled: true });
    const preview = await handleEmailRegistration(new Request(origin + '/api/auth/registration/verify?token=' + 'a'.repeat(43)), env);
    expect(preview.status).toBe(404);
    expect(await call('/verify', { token: 'a'.repeat(43), password: 'long-enough-password' })).toMatchObject({ status: 410 }); expect(calls).toBe(0);
  });
  it('consumes a link exactly once under concurrent confirmations', async () => {
    await call(); const raw = token();
    const replies = await Promise.all([call('/verify', { token: raw, password: 'first-valid-password' }), call('/verify', { token: raw, password: 'second-valid-password' })]);
    expect(replies.map(x => x.status).sort()).toEqual([201, 410]);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM app_users').get().n).toBe(1);
  });
  it('accepts an eight-character Cyrillic password with ! after email ownership is proved', async () => {
    await call(); const raw = token();
    expect(await call('/verify', { token:raw, password:'Ёжик!12' })).toMatchObject({ status:400 });
    expect(await call('/verify', { token:raw, password:'Ёжик!123' })).toMatchObject({ status:201 });
    expect(sqlite.prepare('SELECT role FROM app_users').get().role).toBe('manager');
  });
});
