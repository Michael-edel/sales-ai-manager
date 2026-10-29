export interface SmtpSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  closed: Promise<unknown>;
  close(): Promise<void>;
  startTls(options?: { expectedServerHostname?: string }): SmtpSocket;
}
export type SmtpConnect = (address: { hostname: string; port: number }, options: {
  secureTransport: "on" | "starttls"; allowHalfOpen: boolean;
}) => SmtpSocket;
export interface SmtpEnv {
  DB: D1Database;
  SMTP_CONNECT?: SmtpConnect;
  SMTP_SETTINGS_KEY?: string;
  SMTP_ALLOWED_HOSTS?: string;
}
type Actor = { id: number; role: string; auth_version: number };
type Config = { host: string; port: 465 | 587; username: string; from_address: string; password: string };
type Saved = { ciphertext: string; nonce: string; auth_verified_at: string };
const encoder = new TextEncoder();
const AAD = encoder.encode("michael.smtp-settings:v1:id=1");
const EMAIL = /^[a-z0-9][a-z0-9._%+-]{0,63}@edel\.kz$/;
const TIMEOUT = 25_000;
const MAX_REPLY = 16 * 1024;
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
export class SmtpError extends Error {
  constructor(readonly code: string, message: string, readonly status = 502) { super(message); }
}
const unavailable = () => new SmtpError("SMTP_SETTINGS_UNAVAILABLE", "Настройки почты временно недоступны. Обратитесь к администратору.", 503);
const connectionError = () => new SmtpError("SMTP_CONNECTION_FAILED", "Не удалось установить защищённое соединение с почтовым сервером.");
const authError = () => new SmtpError("SMTP_AUTH_FAILED", "Почтовый сервер отклонил вход. Проверьте адрес и пароль приложения.");
function encode(bytes: Uint8Array): string {
  let text = ""; for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
function decode(value: string): Uint8Array { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
function b64(value: string): string { return encode(encoder.encode(value)); }
function hostName(value: unknown): string {
  const host = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    || /\.(?:localhost|local|internal|lan|home|test|invalid)$/.test(host)) throw new SmtpError("SMTP_INPUT", "Выберите разрешённый почтовый сервер.", 400);
  return host;
}
function allowedHosts(env: SmtpEnv): string[] {
  try { return [...new Set((env.SMTP_ALLOWED_HOSTS || "").split(",").filter(Boolean).map(hostName))]; }
  catch { throw unavailable(); }
}
function address(value: unknown): string {
  const result = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!EMAIL.test(result)) throw new SmtpError("SMTP_INPUT", "Укажите корпоративный адрес @edel.kz.", 400);
  return result;
}
function endpoint(env: SmtpEnv, value: Record<string, unknown>): Pick<Config, "host" | "port"> {
  const host = hostName(value.host);
  if (!allowedHosts(env).includes(host) || (value.port !== 465 && value.port !== 587)) {
    throw new SmtpError("SMTP_INPUT", "Разрешён подтверждённый сервер и порт 587 (STARTTLS) или 465 (TLS).", 400);
  }
  return { host, port: value.port };
}
function configuration(env: SmtpEnv, value: Record<string, unknown>): Config {
  const target = endpoint(env, value);
  const username = address(value.username), from_address = address(value.from_address);
  const password = value.password;
  if (typeof password !== "string" || !password.length || password.length > 1024 || encoder.encode(password).length > 4096 || /[\x00-\x1f\x7f]/.test(password)) {
    throw new SmtpError("SMTP_INPUT", "Введите пароль приложения, не более 1024 символов, без управляющих символов.", 400);
  }
  return { ...target, username, from_address, password };
}
async function key(env: SmtpEnv): Promise<CryptoKey> {
  try {
    const raw = decode(env.SMTP_SETTINGS_KEY || "");
    if (raw.length !== 32 || encode(raw) !== env.SMTP_SETTINGS_KEY) throw unavailable();
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch { throw unavailable(); }
}
async function saved(env: SmtpEnv): Promise<Saved | null> {
  return env.DB.prepare("SELECT ciphertext,nonce,auth_verified_at FROM smtp_settings WHERE id=1").first<Saved>();
}
async function decrypt(env: SmtpEnv, value: Saved): Promise<Config> {
  try {
    const iv = decode(value.nonce); if (iv.length !== 12) throw unavailable();
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD, tagLength: 128 }, await key(env), decode(value.ciphertext));
    const decoded = JSON.parse(new TextDecoder().decode(plaintext));
    return configuration(env, decoded);
  } catch { throw unavailable(); }
}
export async function getSmtpSettingsStatus(env: SmtpEnv) {
  const record = await saved(env), hosts = allowedHosts(env);
  if (!record) return { configured: false, host: hosts[0] || "", port: 587, username: "direktor@edel.kz", from_address: "direktor@edel.kz", password_set: false, auth_verified_at: null, allowed_hosts: hosts };
  const config = await decrypt(env, record);
  return { configured: true, host: config.host, port: config.port, username: config.username, from_address: config.from_address,
    password_set: true, auth_verified_at: record.auth_verified_at, allowed_hosts: hosts };
}
export async function checkSmtpAuthentication(env: SmtpEnv) {
  const current = await saved(env); if (!current) throw unavailable();
  await exchange(env, await decrypt(env, current), "check");
  await env.DB.prepare("UPDATE smtp_settings SET auth_verified_at=? WHERE id=1 AND nonce=?").bind(new Date().toISOString(), current.nonce).run();
  return getSmtpSettingsStatus(env);
}

class Session {
  socket: SmtpSocket;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";
  private decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  constructor(socket: SmtpSocket, private wait: <T>(value: Promise<T>) => Promise<T>) {
    this.socket = socket; this.reader = socket.readable.getReader(); this.writer = socket.writable.getWriter();
    void socket.closed.catch(() => {});
  }
  release() { try { this.reader.releaseLock(); } catch {} try { this.writer.releaseLock(); } catch {} }
  async write(value: string) { await this.wait(this.writer.write(encoder.encode(value))); }
  async response(): Promise<{ code: number; lines: string[] }> {
    let code = 0, total = 0; const lines: string[] = [];
    while (true) {
      let end = this.buffer.indexOf("\r\n");
      while (end < 0) {
        const part = await this.wait(this.reader.read());
        if (part.done || !part.value || part.value.byteLength + encoder.encode(this.buffer).length > MAX_REPLY) throw connectionError();
        this.buffer += this.decoder.decode(part.value, { stream: true });
        end = this.buffer.indexOf("\r\n");
      }
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 2);
      total += encoder.encode(line).length + 2;
      if (total > MAX_REPLY || lines.length > 100) throw connectionError();
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match || (code && code !== Number(match[1]))) throw connectionError();
      code = Number(match[1]); lines.push(match[3]);
      if (match[2] === " ") return { code, lines };
    }
  }
  async command(value: string, expected: number[]): Promise<{ code: number; lines: string[] }> {
    await this.write(value + "\r\n");
    const response = await this.response();
    if (!expected.includes(response.code)) throw connectionError();
    return response;
  }
  canUpgrade() { return this.buffer.length === 0; }
}
type Message = { to: string; subject: string; body: string };
function subjectHeader(value: string): string {
  const words: string[] = []; let chunk = "";
  for (const character of value) {
    if (encoder.encode(chunk + character).length > 42) { words.push(`=?UTF-8?B?${b64(chunk)}?=`); chunk = ""; }
    chunk += character;
  }
  if (chunk) words.push(`=?UTF-8?B?${b64(chunk)}?=`);
  return words.join("\r\n ");
}
function mime(config: Config, message: Message): string {
  const body = b64(message.body).match(/.{1,76}/g)?.join("\r\n") || "";
  const text = [`From: <${config.from_address}>`, `To: <${message.to}>`, `Subject: ${subjectHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@edel.kz>`, "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body].join("\r\n");
  return text.replace(/^\./gm, "..");
}
/** TLS is mandatory. Probe/auth-only paths never execute MAIL, RCPT or DATA. */
async function exchange(env: SmtpEnv, config: Pick<Config, "host" | "port"> & Partial<Config>, mode: "probe" | "check" | "send", message?: Message, authorizeSend?: () => Promise<boolean>): Promise<void> {
  if (!env.SMTP_CONNECT) throw unavailable();
  let session: Session | undefined, socket: SmtpSocket | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => { reject(new SmtpError("SMTP_TIMEOUT", "Почтовый сервер не ответил вовремя. Повторите позже.", 504)); void socket?.close().catch(() => {}); }, TIMEOUT);
  });
  const wait = <T>(value: Promise<T>) => Promise.race([value, expired]);
  try {
    socket = env.SMTP_CONNECT({ hostname: config.host, port: config.port }, { secureTransport: config.port === 465 ? "on" : "starttls", allowHalfOpen: false });
    void socket.closed.catch(() => {}); await wait(socket.opened);
    session = new Session(socket, wait);
    if ((await session.response()).code !== 220) throw connectionError();
    let greeting = await session.command("EHLO ai.michael.kz", [250]);
    if (config.port === 587) {
      if (!greeting.lines.some(line => /^STARTTLS(?:\s|$)/i.test(line))) throw new SmtpError("SMTP_TLS_FAILED", "Почтовый сервер не подтвердил обязательный STARTTLS.");
      await session.command("STARTTLS", [220]);
      if (!session.canUpgrade()) throw connectionError();
      session.release(); socket = socket.startTls({ expectedServerHostname: config.host });
      void socket.closed.catch(() => {}); await wait(socket.opened);
      session = new Session(socket, wait); greeting = await session.command("EHLO ai.michael.kz", [250]);
    }
    if (mode !== "probe") {
      const auth = greeting.lines.find(line => /^AUTH(?:[ =]|$)/i.test(line))?.replace(/^AUTH[ =]*/i, "").toUpperCase().split(/\s+/) || [];
      let response;
      if (auth.includes("PLAIN")) {
        const credentials = b64(`\0${config.username}\0${config.password}`);
        await session.write("AUTH PLAIN " + credentials + "\r\n"); response = await session.response();
        if (response.code === 334) { await session.write(credentials + "\r\n"); response = await session.response(); }
      } else if (auth.includes("LOGIN")) {
        await session.write("AUTH LOGIN\r\n"); response = await session.response();
        if (response.code !== 334) throw authError();
        await session.write(b64(config.username!) + "\r\n"); response = await session.response();
        if (response.code !== 334) throw authError();
        await session.write(b64(config.password!) + "\r\n"); response = await session.response();
      } else throw new SmtpError("SMTP_AUTH_UNSUPPORTED", "Почтовый сервер не предложил поддерживаемую защищённую авторизацию.");
      if (response.code !== 235) throw authError();
    }
    if (mode === "send" && message) {
      if (authorizeSend && !await authorizeSend()) throw new SmtpError("SMTP_REQUEST_ACCESS_CHANGED", "Заявка не найдена.", 404);
      await session.command(`MAIL FROM:<${config.from_address}>`, [250]);
      await session.command(`RCPT TO:<${message.to}>`, [250, 251]);
      await session.command("DATA", [354]);
      await session.write(mime(config as Config, message) + "\r\n.\r\n");
      if ((await session.response()).code !== 250) throw new SmtpError("SMTP_SEND_FAILED", "Почтовый сервер не принял письмо. Повторите позже.");
      // The final 250 already accepted the message. A lost QUIT response must
      // not turn a successful enqueue into an automatic duplicate send.
      try { await session.command("QUIT", [221]); } catch {}
    } else await session.command("QUIT", [221]);
  } catch (error) { if (error instanceof SmtpError) throw error; throw connectionError(); }
  finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    session?.release(); void socket?.close().catch(() => {});
  }
}
export async function sendCorporateMail(env: SmtpEnv, value: Message): Promise<{ sent: true; from_address: string }> {
  address(value.to); // Registration is restricted to corporate recipients.
  return sendSmtpMessage(env, value);
}
/** Internal transport only. The authenticated reply route enforces request ACL and sender identity. */
export async function sendSmtpMessage(env: SmtpEnv, value: Message, expectedFrom?: string, authorizeSend?: () => Promise<boolean>): Promise<{ sent: true; from_address: string }> {
  const to = typeof value.to === "string" ? value.to.trim().toLowerCase() : "";
  if (to.length > 254 || !/^[a-z0-9._%+-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(to)) throw new SmtpError("SMTP_INPUT", "Укажите корректный email получателя.", 400);
  if (typeof value.subject !== "string" || !value.subject.trim() || value.subject.length > 300 || /[\x00-\x1f\x7f]/.test(value.subject)
    || typeof value.body !== "string" || !value.body.length || encoder.encode(value.body).length > 128 * 1024) throw new SmtpError("SMTP_INPUT", "Некорректное письмо.", 400);
  const record = await saved(env); if (!record) throw unavailable();
  const config = await decrypt(env, record);
  if (expectedFrom !== undefined && config.from_address !== address(expectedFrom)) {
    throw new SmtpError("SMTP_SENDER_CHANGED", "Отправитель SMTP изменился. Обновите страницу и повторите действие.", 409);
  }
  await exchange(env, config, "send", { to, subject: value.subject, body: value.body }, authorizeSend);
  return { sent: true, from_address: config.from_address };
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("Origin") !== new URL(request.url).origin) throw new SmtpError("SMTP_INPUT", "Откройте настройки на сайте.", 403);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) throw new SmtpError("SMTP_INPUT", "Передайте JSON.", 415);
  if (Number(request.headers.get("Content-Length")) > 8192) throw new SmtpError("SMTP_INPUT", "Слишком большой запрос.", 413);
  const reader = request.body?.getReader(); if (!reader) throw new SmtpError("SMTP_INPUT", "Заполните настройки.", 400);
  let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
    if (size > 8192) { await reader.cancel(); throw new SmtpError("SMTP_INPUT", "Слишком большой запрос.", 413); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  const content = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; }
  try { const value = JSON.parse(new TextDecoder().decode(content)); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new SmtpError("SMTP_INPUT", "Некорректные настройки.", 400); }
}
export async function handleSmtpSettings(request: Request, env: SmtpEnv, actor: Actor): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!/^\/api\/settings\/smtp(?:\/|$)/.test(path)) return null;
  try {
    if (actor.role !== "admin") throw new SmtpError("SMTP_FORBIDDEN", "Настройки почты доступны администратору.", 403);
    if (path === "/api/settings/smtp" && request.method === "GET") return reply(await getSmtpSettingsStatus(env));
    const value = await body(request);
    const fields = path.endsWith("/probe") ? ["host", "port"] : ["host", "port", "username", "from_address", "password"];
    if (Object.keys(value).some(field => !fields.includes(field))) throw new SmtpError("SMTP_INPUT", "Неизвестное поле настройки.", 400);
    if (path === "/api/settings/smtp/probe" && request.method === "POST") {
      await exchange(env, endpoint(env, value), "probe"); return reply({ reachable: true, tls_verified: true, authenticated: false });
    }
    const current = await saved(env);
    if (path === "/api/settings/smtp/check" && request.method === "POST") {
      return reply(await checkSmtpAuthentication(env));
    }
    if (path === "/api/settings/smtp" && request.method === "PUT") {
      const metadata = { ...endpoint(env, value), username: address(value.username), from_address: address(value.from_address) };
      const retained = value.password === undefined || value.password === "";
      let password = value.password;
      if (retained) {
        if (!current) throw new SmtpError("SMTP_INPUT", "Введите пароль приложения.", 400);
        const prior = await decrypt(env, current);
        if (Object.keys(metadata).some(field => metadata[field as keyof typeof metadata] !== prior[field as keyof typeof metadata])) throw new SmtpError("SMTP_INPUT", "При изменении сервера или учётной записи введите пароль приложения заново.", 400);
        password = prior.password;
      }
      const config = configuration(env, { ...metadata, password });
      const aes = await key(env); // Fail before transmitting credentials if durable encryption is unavailable.
      await exchange(env, config, "check");
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: AAD, tagLength: 128 }, aes, encoder.encode(JSON.stringify(config)));
      const verified = new Date().toISOString();
      const result = await env.DB.prepare(`INSERT INTO smtp_settings(id,ciphertext,nonce,updated_by,updated_at,auth_verified_at)
        SELECT 1,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM app_users WHERE id=? AND role='admin' AND is_active=1 AND auth_version=?)
        ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,nonce=excluded.nonce,updated_by=excluded.updated_by,updated_at=excluded.updated_at,auth_verified_at=excluded.auth_verified_at
        WHERE EXISTS(SELECT 1 FROM app_users WHERE id=? AND role='admin' AND is_active=1 AND auth_version=?) AND (?=0 OR smtp_settings.nonce=?) RETURNING id`)
        .bind(encode(new Uint8Array(ciphertext)), encode(nonce), actor.id, verified, verified, actor.id, actor.auth_version, actor.id, actor.auth_version, retained ? 1 : 0, current?.nonce || "").all();
      if (!result.results.length) throw new SmtpError("SMTP_SETTINGS_CONFLICT", "Доступ или настройки изменились. Обновите страницу и повторите.", 409);
      return reply(await getSmtpSettingsStatus(env));
    }
    return reply({ detail: "Метод настройки почты не найден." }, 404);
  } catch (error) {
    const safe = error instanceof SmtpError ? error : unavailable();
    return reply({ detail: safe.message, error_code: safe.code }, safe.status);
  }
}
