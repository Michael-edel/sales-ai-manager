import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registrationLinkState, registrationRequestPayload, validateRegistrationRequest, validRegistrationToken } from "./email-registration.mjs";
import { validateNewPassword } from "./user-accounts.mjs";

describe("corporate email registration form", () => {
  it("accepts only the supported corporate mailbox and a bounded real name, with no password in the request", () => {
    const draft = { email: "  Manager.Name@EDEL.KZ  ", display_name: "  Анна  ", password: "must-never-be-submitted" };
    assert.equal(validateRegistrationRequest(draft), "");
    assert.deepEqual(registrationRequestPayload(draft), { email: "manager.name@edel.kz", display_name: "Анна" });
    for (const email of ["person@example.test", "person@edel.kz.attacker.test", "person @edel.kz", "@edel.kz", "a".repeat(65) + "@edel.kz"])
      assert.ok(validateRegistrationRequest({ email, display_name: "Анна" }));
    for (const display_name of ["", " ", "а".repeat(201), "Имя\u0000Фамилия"])
      assert.ok(validateRegistrationRequest({ email: "anna@edel.kz", display_name }));
  });

  it("extracts a single URL-safe link token and removes it while retaining unrelated navigation", () => {
    const token = "A".repeat(43);
    assert.deepEqual(registrationLinkState(`https://ai.michael.kz/?view=home&registration_token=${token}#top`),
      { hasLink: true, token, cleanPath: "/?view=home#top" });
    assert.deepEqual(registrationLinkState("https://ai.michael.kz/"), { hasLink: false, token: "", cleanPath: null });
    for (const query of ["bad", "", `${token}&registration_token=${token}`]) {
      const result = registrationLinkState("https://ai.michael.kz/?registration_token=" + query);
      assert.equal(result.hasLink, true); assert.equal(result.token, ""); assert.equal(result.cleanPath, "/");
    }
    assert.equal(validRegistrationToken(token), true); assert.equal(validRegistrationToken("A".repeat(42)), false);
  });

  it("uses the same exact password confirmation and 8..256 boundary as administrator-created accounts", () => {
    assert.ok(validateNewPassword("x".repeat(7), "x".repeat(7)));
    assert.equal(validateNewPassword("Ёжик!123", "Ёжик!123"), "");
    assert.equal(validateNewPassword("x".repeat(256), "x".repeat(256)), "");
    assert.ok(validateNewPassword("x".repeat(257), "x".repeat(257)));
    assert.ok(validateNewPassword("  пароль сотрудника  ", "пароль сотрудника"));
  });
});
