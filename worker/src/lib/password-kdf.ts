/** No credential data is persisted by the internal KDF service. */
export const SCRYPT_SCHEME = "scrypt-v1";
export const LEGACY_SCHEME = "pbkdf2-sha256";
export const LEGACY_ITERATIONS = 100_000;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
const KDF_URL = "https://password-kdf.internal/v1/password";
export interface StoredPassword {
  password_hash: string;
  password_salt: string;
  password_scheme: string;
  password_iterations: number;
}
export type NewPassword = { hash: string; salt: string; scheme: typeof SCRYPT_SCHEME };
export interface PasswordKdfEnv { PASSWORD_KDF?: DurableObjectNamespace }
export class PasswordHashUnavailableError extends Error {
  constructor() { super("The private password service is unavailable."); }
}
function encode(bytes: Uint8Array): string {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function canonicalBase64(value: unknown, bytes: number): value is string {
  if (typeof value !== "string" || value.length !== Math.ceil(bytes / 3) * 4) return false;
  try { return atob(value).length === bytes && btoa(atob(value)) === value; } catch { return false; }
}
async function invoke(env: PasswordKdfEnv, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!env.PASSWORD_KDF) throw new PasswordHashUnavailableError();
  try {
    const stub = env.PASSWORD_KDF.get(env.PASSWORD_KDF.idFromName("password-kdf-v1"));
    const response = await stub.fetch(KDF_URL, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new PasswordHashUnavailableError();
    const result = await response.json() as Record<string, unknown>;
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new PasswordHashUnavailableError();
    return result;
  } catch { throw new PasswordHashUnavailableError(); }
}
export async function createPassword(env: PasswordKdfEnv, password: string): Promise<NewPassword> {
  const salt = encode(crypto.getRandomValues(new Uint8Array(16)));
  const result = await invoke(env, { operation: "derive-scrypt", password, salt });
  if (!canonicalBase64(result.hash, 32)) throw new PasswordHashUnavailableError();
  return { hash: result.hash, salt, scheme: SCRYPT_SCHEME };
}
export async function verifyStoredPassword(env: PasswordKdfEnv, password: string, record: StoredPassword): Promise<boolean> {
  if (!canonicalBase64(record.password_salt, 16) || !canonicalBase64(record.password_hash, 32))
    throw new PasswordHashUnavailableError();
  if (record.password_scheme === SCRYPT_SCHEME) {
    const result = await invoke(env, { operation: "verify-scrypt", password, salt: record.password_salt, hash: record.password_hash });
    if (typeof result.matches !== "boolean") throw new PasswordHashUnavailableError();
    return result.matches;
  }
  if (record.password_scheme !== LEGACY_SCHEME || ![100_000, 600_000].includes(record.password_iterations))
    throw new PasswordHashUnavailableError();
  if (record.password_iterations > LEGACY_ITERATIONS) {
    const result = await invoke(env, { operation: "verify-pbkdf2", password, salt: record.password_salt,
      hash: record.password_hash, iterations: record.password_iterations });
    if (typeof result.matches !== "boolean") throw new PasswordHashUnavailableError();
    return result.matches;
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(atob(record.password_salt), char => char.charCodeAt(0));
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: record.password_iterations }, key, 256));
  const expected = Uint8Array.from(atob(record.password_hash), char => char.charCodeAt(0));
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < Math.max(actual.length, expected.length); index++) difference |= (actual[index] || 0) ^ (expected[index] || 0);
  return difference === 0;
}
export async function dummyPasswordCheck(env: PasswordKdfEnv, password: string): Promise<void> {
  if (env.PASSWORD_KDF) {
    await verifyStoredPassword(env, password, { password_scheme: SCRYPT_SCHEME, password_iterations: LEGACY_ITERATIONS,
      password_salt: "AAAAAAAAAAAAAAAAAAAAAA==", password_hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" });
  } else {
    // Preserve safe legacy sign-in during a missing-binding rollout; writes fail closed.
    await verifyStoredPassword(env, password, { password_scheme: LEGACY_SCHEME, password_iterations: LEGACY_ITERATIONS,
      password_salt: "AAAAAAAAAAAAAAAAAAAAAA==", password_hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" });
  }
}
