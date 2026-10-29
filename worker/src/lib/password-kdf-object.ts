import { scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

// OWASP's 32 MiB alternative; N*r*p=786432 is below workerd's 2^20 cap.
export const SCRYPT_PROFILE = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
const MAX_BODY_BYTES = 4096;
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
function bytes(value: unknown, length: number): Buffer | null {
  if (typeof value !== "string" || value.length !== Math.ceil(length / 3) * 4) return null;
  const result = Buffer.from(value, "base64");
  return result.length === length && result.toString("base64") === value ? result : null;
}
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const content = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder().decode(content));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

/** Private binding only; intentionally no storage, alarms, timers or credential logs. */
export class PasswordKdf {
  constructor(_state: DurableObjectState, _env: unknown) {}
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== "https://password-kdf.internal" || url.pathname !== "/v1/password" || request.method !== "POST")
      return reply({ error: "NOT_FOUND" }, 404);
    if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) return reply({ error: "BAD_REQUEST" }, 400);
    try {
      const value = await readBody(request);
      if (!value || Object.keys(value).some(key => !["operation", "password", "salt", "hash", "iterations"].includes(key))
        || typeof value.password !== "string" || !value.password.length || value.password.length > 256) return reply({ error: "BAD_REQUEST" }, 400);
      const salt = bytes(value.salt, 16); if (!salt) return reply({ error: "BAD_REQUEST" }, 400);
      const operation = value.operation;
      if (operation === "derive-scrypt" && value.hash === undefined && value.iterations === undefined) {
        const hash = scryptSync(value.password, salt, 32, SCRYPT_PROFILE);
        try { return reply({ hash: hash.toString("base64") }); } finally { hash.fill(0); }
      }
      const expected = bytes(value.hash, 32); if (!expected) return reply({ error: "BAD_REQUEST" }, 400);
      let actual: Uint8Array;
      if (operation === "verify-scrypt" && value.iterations === undefined) actual = scryptSync(value.password, salt, 32, SCRYPT_PROFILE);
      else if (operation === "verify-pbkdf2" && (value.iterations === 100000 || value.iterations === 600000)) {
        // Exact standard PBKDF2 compatibility, not a lowered work factor. Noble
        // avoids WebCrypto/Node's production 100k cap inside the DO's CPU budget.
        actual = pbkdf2(sha256, value.password, salt, { c: value.iterations, dkLen: 32 });
      } else return reply({ error: "BAD_REQUEST" }, 400);
      try { return reply({ matches: timingSafeEqual(actual, expected) }); } finally { actual.fill(0); expected.fill(0); }
    } catch { return reply({ error: "KDF_UNAVAILABLE" }, 503); }
  }
}
