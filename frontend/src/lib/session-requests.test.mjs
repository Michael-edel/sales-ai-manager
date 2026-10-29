import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSessionRequestGuard, isStaleSessionResponse } from "./session-requests.mjs";

describe("responses cannot cross an explicit account switch", () => {
  it("does not deliver a delayed previous-account response to its UI consumer", async () => {
    const guard = createSessionRequestGuard();
    let release, delivered = false;
    const oldFetch = new Promise(resolve => { release = resolve; });
    const assertCurrent = guard.capture();
    const pending = oldFetch.then(value => { assertCurrent(); delivered = true; return value; });
    guard.invalidate(); release({ privatePreviousAccount: true });
    await assert.rejects(pending, error => error.name === "AbortError" && isStaleSessionResponse(error));
    assert.equal(delivered, false);
  });

  it("keeps normal current-account responses and normal API errors intact", async () => {
    const guard = createSessionRequestGuard();
    const result = { id: 10 };
    const assertCurrent = guard.capture();
    assert.equal(await Promise.resolve(result).then(value => { assertCurrent(); return value; }), result);
    const currentFailure = new Error("fixture network failure");
    await assert.rejects(Promise.reject(currentFailure).catch(error => { assertCurrent(); throw error; }), error => error === currentFailure);
    guard.invalidate();
    const assertNext = guard.capture();
    assert.equal(await Promise.resolve(result).then(value => { assertNext(); return value; }), result);
  });

  it("converts a delayed old-account failure into a silent session abort, not a new-account error", async () => {
    const guard = createSessionRequestGuard();
    let rejectOld;
    const assertCurrent = guard.capture();
    const pending = new Promise((resolve, reject) => { rejectOld = reject; }).catch(error => { assertCurrent(); throw error; });
    guard.invalidate(); rejectOld(Object.assign(new Error("old forbidden"), { status: 403 }));
    await assert.rejects(pending, error => isStaleSessionResponse(error) && error.status === undefined);
  });
});
