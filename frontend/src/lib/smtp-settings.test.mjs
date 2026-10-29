import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { smtpConnectionChanged, smtpDraft, smtpError, smtpMetadata, smtpPayload, smtpProbePayload, validateSmtpDraft, validateSmtpProbe } from "./smtp-settings.mjs";

const metadata = { host: "mail-edel.edel.kz", port: 587, username: "fixture@edel.kz", from_address: "fixture@edel.kz",
  password_set: true, auth_verified_at: "2026-10-29T12:00:00Z", configured: true, allowed_hosts: ["mail-edel.edel.kz"] };

describe("SMTP administration form keeps the secret separate from metadata", () => {
  it("never carries a server-returned secret into metadata or a reopened draft", () => {
    const input = { ...metadata, password: "must-not-be-returned", encrypted_password: "also-private" };
    assert.equal(Object.hasOwn(smtpMetadata(input), "password"), false);
    assert.equal(Object.hasOwn(smtpMetadata(input), "encrypted_password"), false);
    assert.equal(smtpDraft(input).password, "");
  });

  it("allows an empty password only for an unchanged connection with a stored secret", () => {
    const unchanged = smtpDraft(metadata);
    assert.equal(validateSmtpDraft(unchanged, metadata), "");
    assert.ok(validateSmtpDraft(unchanged, { ...metadata, password_set: false }));
    for (const patch of [{ port: 465 }, { username: "other@edel.kz" }, { from_address: "other@edel.kz" }]) {
      assert.equal(smtpConnectionChanged({ ...unchanged, ...patch }, metadata), true);
      assert.ok(validateSmtpDraft({ ...unchanged, ...patch }, metadata));
    }
  });

  it("permits only the configured company host and TLS ports and preserves an exact password", () => {
    const draft = { ...smtpDraft(metadata), password: "  fixture-SMTP-app-secret!  " };
    assert.equal(validateSmtpDraft(draft, metadata), "");
    assert.equal(smtpPayload(draft).password, draft.password);
    for (const patch of [{ host: "attacker.test" }, { port: 25 }, { port: 2525 }, { from_address: "other@example.test" }, { password: "fixture\r\nsecret" }])
      assert.ok(validateSmtpDraft({ ...draft, ...patch }, metadata));
  });

  it("does not expose raw server authentication diagnostics or claim delivery", () => {
    const error = smtpError({ code: "SMTP_AUTH_FAILED", message: "raw server reply must remain private" });
    assert.match(error, /535/); assert.equal(error.includes("raw server reply"), false);
    assert.equal(smtpError(new Error("private socket detail")).includes("private socket"), false);
  });

  it("checks only the host and TLS port without even reading a password for a connection probe", () => {
    const input = { host: metadata.host, port: "587", get password() { throw new Error("Probe must not inspect the credential"); }, username: "ignored" };
    assert.deepEqual(smtpProbePayload(input), { host: metadata.host, port: 587 });
    assert.equal(validateSmtpProbe(input, metadata), "");
    assert.ok(validateSmtpProbe({ host: metadata.host, port: 25 }, metadata));
  });
});
