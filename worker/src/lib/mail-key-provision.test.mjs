import { describe, expect, it } from "vitest";
import { ensureMailSettingsKey } from "../../scripts/ensure-mail-settings-key.mjs";
const configText = 'name = "sales-ai-manager"\naccount_id = "3e2a044cfaf01abb436adfe910297e5c"\n';
describe("SMTP encryption key provisioning", () => {
  it("preserves an existing key without generating or writing another", async () => {
    const calls = [];
    expect(await ensureMailSettingsKey({ configText, run: async (...args) => { calls.push(args); return '[{"name":"SMTP_SETTINGS_KEY"}]'; }, random: () => { throw new Error("Must not generate"); } })).toEqual({ created: false });
    expect(calls).toHaveLength(1);
  });
  it("uses the canonical account and sends a newly generated key only on stdin, then wipes the random buffer", async () => {
    const calls = [], buffer = Buffer.alloc(32, 7);
    expect(await ensureMailSettingsKey({ configText, random: () => buffer, run: async (...args) => { calls.push(args); return calls.length === 1 ? "[]" : '[{"name":"SMTP_SETTINGS_KEY"}]'; } })).toEqual({ created: true });
    expect(calls[1][0]).toContain("SMTP_SETTINGS_KEY"); expect(calls[1][0].join(" ")).not.toContain(Buffer.alloc(32, 7).toString("base64"));
    expect(calls[1][1]).toBe(Buffer.alloc(32, 7).toString("base64") + "\n"); expect(calls.every(call => call[2] === "3e2a044cfaf01abb436adfe910297e5c")).toBe(true); expect(buffer.every(value => value === 0)).toBe(true);
  });
  it("does not overwrite after a malformed secret-list response", async () => {
    await expect(ensureMailSettingsKey({ configText, run: async () => '{"unexpected":true}', random: () => { throw new Error("Must not generate"); } })).rejects.toThrow("Could not verify");
  });
});
