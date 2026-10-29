import { createPassword, LEGACY_ITERATIONS, PasswordHashUnavailableError, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH,
  type PasswordKdfEnv } from "./password-kdf";
import { getSmtpSettingsStatus, sendCorporateMail, type SmtpEnv } from "./smtp-mail";

export interface RegistrationEnv extends PasswordKdfEnv, SmtpEnv {
  DB: D1Database;
  EMAIL_BRIDGE_URL?: string;
  EMAIL_BRIDGE_TOKEN?: string;
  REGISTRATION_FROM_EMAIL?: string;
  REGISTRATION_APP_ORIGIN?: string;
}
const EMAIL = /^[a-z0-9][a-z0-9._%+-]{0,63}@edel\.kz$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ACCEPTED = { accepted: true, detail: "Если адрес подходит для регистрации, на него придёт письмо с дальнейшими действиями." };
class RegistrationError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "REGISTRATION_INPUT") { super(message); }
}
const response = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...headers },
});
async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
}
function randomToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function body(request: Request, fields: string[]): Promise<Record<string, unknown>> {
  if (request.headers.get("Origin") !== new URL(request.url).origin) throw new RegistrationError("Откройте форму на сайте ai.michael.kz.", 403);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) throw new RegistrationError("Передайте данные JSON.", 415);
  if (Number(request.headers.get("Content-Length")) > 4096) throw new RegistrationError("Слишком большой запрос.", 413);
  const reader = request.body?.getReader(); if (!reader) throw new RegistrationError("Заполните форму.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > 4096) { await reader.cancel(); throw new RegistrationError("Слишком большой запрос.", 413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new RegistrationError("Некорректные данные формы."); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new RegistrationError("Некорректные поля формы.");
  return value as Record<string, unknown>;
}
async function reserve(env: RegistrationEnv, bucket: string, limit: number): Promise<void> {
  const row = await env.DB.prepare(`INSERT INTO auth_registration_limits(bucket,attempts,window_started_at)
    VALUES (?,1,datetime('now')) ON CONFLICT(bucket) DO UPDATE SET
      attempts=CASE WHEN window_started_at<=datetime('now','-1 hour') THEN 1 ELSE attempts+1 END,
      window_started_at=CASE WHEN window_started_at<=datetime('now','-1 hour') THEN excluded.window_started_at ELSE window_started_at END
    WHERE window_started_at<=datetime('now','-1 hour') OR attempts<? RETURNING attempts`).bind(bucket, limit).first();
  if (!row) throw new RegistrationError("Слишком много попыток. Повторите регистрацию позже.", 429, "REGISTRATION_RATE_LIMIT");
}
function mailSettings(env: RegistrationEnv) {
  const sender = (env.REGISTRATION_FROM_EMAIL || "").trim().toLowerCase();
  if (!env.EMAIL_BRIDGE_URL || !env.EMAIL_BRIDGE_TOKEN || !EMAIL.test(sender)) return null;
  try {
    const url = new URL(env.EMAIL_BRIDGE_URL);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) return null;
    return { sender, url: url.toString().replace(/\/+$/, "") };
  } catch { return null; }
}
function appOrigin(env: RegistrationEnv): string {
  const url = new URL(env.REGISTRATION_APP_ORIGIN || "https://ai.michael.kz");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("Invalid registration origin");
  return url.origin;
}
async function deliveryConfigured(env: RegistrationEnv): Promise<boolean> {
  if ((await getSmtpSettingsStatus(env)).configured) return true;
  return Boolean(mailSettings(env));
}
async function send(env: RegistrationEnv, to: string, text: string): Promise<void> {
  if ((await getSmtpSettingsStatus(env)).configured) {
    try {
      await sendCorporateMail(env, { to, subject: "Регистрация сотрудника Michael", body: text });
      return;
    } catch {
      throw new RegistrationError("Не удалось отправить письмо подтверждения. Повторите позже или обратитесь к администратору.", 503, "REGISTRATION_MAIL_UNAVAILABLE");
    }
  }
  const settings = mailSettings(env);
  if (!settings) throw new RegistrationError("Регистрация по почте временно недоступна. Обратитесь к администратору.", 503, "REGISTRATION_MAIL_UNAVAILABLE");
  try {
    const sent = await fetch(settings.url + "/send", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Email-Bridge-Token": env.EMAIL_BRIDGE_TOKEN! },
      body: JSON.stringify({ to, from_address: settings.sender, subject: "Регистрация сотрудника Michael", body: text }),
      signal: AbortSignal.timeout(30_000), redirect: "manual",
    });
    const result = await sent.json().catch(() => null) as { sent?: boolean } | null;
    if (!sent.ok || result?.sent !== true) throw new Error("Mail was not accepted");
  } catch { throw new RegistrationError("Не удалось отправить письмо подтверждения. Повторите позже или обратитесь к администратору.", 503, "REGISTRATION_MAIL_UNAVAILABLE"); }
}

async function requestRegistration(request: Request, env: RegistrationEnv): Promise<Response> {
  const value = await body(request, ["email", "display_name"]);
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  const name = typeof value.display_name === "string" ? value.display_name.trim() : "";
  if (!EMAIL.test(email)) throw new RegistrationError("Укажите корпоративный адрес @edel.kz.");
  if (!name || name.length > 200 || /[\x00-\x1f\x7f]/.test(name)) throw new RegistrationError("Укажите имя сотрудника, не более 200 символов.");
  if (!await deliveryConfigured(env)) throw new RegistrationError("Регистрация по почте временно недоступна. Обратитесь к администратору.", 503, "REGISTRATION_MAIL_UNAVAILABLE");
  await reserve(env, "request:ip:" + await digest(request.headers.get("CF-Connecting-IP") || "unknown"), 10);
  await reserve(env, "request:email:" + await digest(email), 3);
  const existing = await env.DB.prepare("SELECT id FROM app_users WHERE lower(email_address)=? OR lower(username)=? LIMIT 1").bind(email, email).first();
  if (existing) {
    await send(env, email, "Для этого адреса уже существует учётная запись Michael. Войдите на " + appOrigin(env) + ". Если забыли пароль или доступ отключён, обратитесь к администратору.\n\nЕсли вы не запрашивали регистрацию, проигнорируйте письмо.");
    return response(ACCEPTED, 202);
  }
  const token = randomToken(), hash = await digest(token);
  const reserved = await env.DB.prepare(`INSERT INTO auth_email_registrations(email,display_name,token_hash,expires_at,last_sent_at)
    VALUES (?,?,?,datetime('now','+24 hours'),datetime('now')) ON CONFLICT(email) DO UPDATE SET
      display_name=excluded.display_name,token_hash=excluded.token_hash,expires_at=excluded.expires_at,
      last_sent_at=excluded.last_sent_at,consumed_at=NULL,consumption_nonce=NULL
    WHERE last_sent_at<=datetime('now','-1 minute') OR token_hash IS NULL RETURNING email`).bind(email, name, hash).first();
  if (!reserved) return response(ACCEPTED, 202);
  const link = appOrigin(env) + "/?registration_token=" + encodeURIComponent(token);
  try {
    await send(env, email, "Подтвердите корпоративную почту для входа в Michael:\n\n" + link + "\n\nСсылка действует 24 часа и используется один раз. После перехода вы сами зададите пароль.\n\nЕсли вы не запрашивали регистрацию, проигнорируйте письмо. Не передавайте ссылку другим людям.");
  } catch (error) {
    await env.DB.prepare("UPDATE auth_email_registrations SET token_hash=NULL,expires_at=datetime('now') WHERE email=? AND token_hash=? AND consumed_at IS NULL").bind(email, hash).run();
    throw error;
  }
  return response(ACCEPTED, 202);
}

async function completeRegistration(request: Request, env: RegistrationEnv): Promise<Response> {
  const value = await body(request, ["token", "password"]);
  await reserve(env, "verify:ip:" + await digest(request.headers.get("CF-Connecting-IP") || "unknown"), 20);
  if (typeof value.token !== "string" || !TOKEN.test(value.token)) throw new RegistrationError("Ссылка недействительна или устарела. Запросите новое письмо.", 410, "REGISTRATION_LINK_INVALID");
  if (typeof value.password !== "string" || value.password.length < PASSWORD_MIN_LENGTH || value.password.length > PASSWORD_MAX_LENGTH) throw new RegistrationError(`Пароль должен содержать от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов.`);
  const hash = await digest(value.token);
  const pending = await env.DB.prepare("SELECT email FROM auth_email_registrations WHERE token_hash=? AND consumed_at IS NULL AND expires_at>datetime('now')").bind(hash).first<{ email: string }>();
  if (!pending) throw new RegistrationError("Ссылка недействительна или устарела. Запросите новое письмо.", 410, "REGISTRATION_LINK_INVALID");
  const password = await createPassword(env, value.password);
  const nonce = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE auth_email_registrations SET consumed_at=datetime('now'),consumption_nonce=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>datetime('now') RETURNING email").bind(nonce, hash),
    env.DB.prepare(`INSERT INTO app_users(username,display_name,role,email_address,password_hash,password_salt,password_iterations,password_scheme)
      SELECT email,display_name,'manager',email,?,?,?,? FROM auth_email_registrations r WHERE consumption_nonce=?
      AND NOT EXISTS(SELECT 1 FROM app_users u WHERE lower(u.email_address)=r.email OR lower(u.username)=r.email) RETURNING id`)
      .bind(password.hash, password.salt, LEGACY_ITERATIONS, password.scheme, nonce),
  ]);
  if (!results[0].results.length) throw new RegistrationError("Ссылка уже использована или устарела.", 410, "REGISTRATION_LINK_INVALID");
  if (!results[1].results.length) throw new RegistrationError("Учётная запись уже существует. Войдите или обратитесь к администратору.", 409, "REGISTRATION_ACCOUNT_EXISTS");
  return response({ registered: true, email: pending.email, detail: "Почта подтверждена. Войдите с корпоративным адресом и новым паролем." }, 201);
}

/** Public routes only; activation never depends on merely entering an @edel.kz string. */
export async function handleEmailRegistration(request: Request, env: RegistrationEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/auth/registration")) return null;
  try {
    if (path === "/api/auth/registration/status" && request.method === "GET") return response({ enabled: await deliveryConfigured(env) });
    if (path === "/api/auth/registration" && request.method === "POST") return await requestRegistration(request, env);
    if (path === "/api/auth/registration/verify" && request.method === "POST") return await completeRegistration(request, env);
    return response({ detail: "Метод регистрации не найден." }, 404);
  } catch (error) {
    if (error instanceof RegistrationError) return response({ detail: error.message, error_code: error.code }, error.status,
      error.status === 429 ? { "Retry-After": "3600" } : {});
    if (error instanceof PasswordHashUnavailableError) return response({ detail: "Сервис паролей временно недоступен. Повторите позже.", error_code: "AUTH_HASH_UNAVAILABLE" }, 503);
    // Do not log links, request bodies, bridge responses or credentials.
    return response({ detail: "Регистрация временно недоступна. Повторите позже.", error_code: "REGISTRATION_UNAVAILABLE" }, 503);
  }
}
