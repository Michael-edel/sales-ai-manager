import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accountCreatePayload, emptyAccountDraft, validateAccountDraft, validateNewPassword } from "./user-accounts.mjs";

describe("employee credential form contract", () => {
  it("enforces the same 8..256-character boundary for create and reset", () => {
    for (const mode of ["create", "reset"]) {
      for (const size of [0, 7, 257]) {
        const value = "x".repeat(size);
        assert.notEqual(validateAccountDraft({ ...emptyAccountDraft(), username: "manager1", password: value, confirmation: value }, mode), "");
      }
      for (const size of [8, 256]) {
        const value = "x".repeat(size);
        assert.equal(validateAccountDraft({ ...emptyAccountDraft(), username: "manager1", password: value, confirmation: value }, mode), "");
      }
    }
  });

  it("accepts Cyrillic, digits and exclamation marks at the eight-character boundary", () => {
    const password = "Ёжик!123";
    assert.equal(password.length, 8);
    for (const mode of ["create", "reset"])
      assert.equal(validateAccountDraft({ ...emptyAccountDraft(), username:"manager1", password, confirmation:password }, mode), "");
  });

  it("does not normalize or trim passwords and catches a visually small confirmation difference", () => {
    const password = "  пароль-тест-λ  ";
    assert.equal(validateNewPassword(password, password), "");
    assert.notEqual(validateNewPassword(password, password.trim()), "");
    const payload = accountCreatePayload({ ...emptyAccountDraft(), username: " Manager_1 ", password, confirmation: password });
    assert.equal(payload.password, password);
    assert.equal(payload.username, "manager_1");
    assert.equal(Object.hasOwn(payload, "confirmation"), false);
  });

  it("rejects unsupported login characters instead of silently creating a different login", () => {
    for (const username of ["Иван", "john doe", "user/name", "a".repeat(65)]) {
      assert.notEqual(validateAccountDraft({ ...emptyAccountDraft(), username, password: "fixture-password-12", confirmation: "fixture-password-12" }, "create"), "");
    }
  });

  it("allows an optional company email, validates the role, and starts a fresh dialog without secrets", () => {
    const draft = { ...emptyAccountDraft(), username: "manager1", password: "fixture-password-12", confirmation: "fixture-password-12" };
    assert.equal(validateAccountDraft(draft, "create"), "");
    assert.notEqual(validateAccountDraft({ ...draft, email_address: "user@example.test" }, "create"), "");
    assert.notEqual(validateAccountDraft({ ...draft, role: "superuser" }, "create"), "");
    assert.equal(validateAccountDraft({ ...draft, email_address: "Manager@edel.kz" }, "create"), "");
    const fresh = emptyAccountDraft();
    assert.equal(fresh.password, ""); assert.equal(fresh.confirmation, ""); assert.equal(fresh.role, "manager");
    assert.notEqual(fresh, emptyAccountDraft());
  });
});
