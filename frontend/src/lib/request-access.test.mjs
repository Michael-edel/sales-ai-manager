import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activeManagers, assigneeCaption, reconcileRequestSelection, requestIdForAccessError,
  requestVisibleToUser, validateAssignment, visibleRequests } from "./request-access.mjs";

const admin = { id: 1, role: "admin" }, manager = { id: 2, role: "manager" };
const own = { id: 10, assigned_user_id: 2, assigned_user_name: "Ирина", assigned_user_username: "irina" };
const foreign = { id: 11, assigned_user_id: 3 }, unassigned = { id: 12, assigned_user_id: null, michael_manager: "irina" };

describe("request ownership presentation follows server IDs", () => {
  it("keeps the admin queue visible while all nonadmins see only their own assigned IDs", () => {
    assert.deepEqual(visibleRequests([own, foreign, unassigned], admin), [own, foreign, unassigned]);
    for (const role of ["manager", "accountant", "viewer"])
      assert.deepEqual(visibleRequests([own, foreign, unassigned], { ...manager, role }), [own]);
    assert.equal(requestVisibleToUser(unassigned, manager), false);
    assert.equal(assigneeCaption(unassigned), "Без ответственного");
    assert.equal(assigneeCaption(own), "Ирина (irina)");
  });

  it("clears a transferred or deleted selection instead of retaining stale detail", () => {
    assert.equal(reconcileRequestSelection(own, [foreign], null, manager), null);
    assert.equal(reconcileRequestSelection(null, [foreign], own, manager), null);
    assert.deepEqual(reconcileRequestSelection(own, [{ ...own, status: "done" }], null, manager), { ...own, status: "done" });
  });

  it("allows only a different active manager and never grants access using a free-text name", () => {
    const items = [{ id: 2, role: "manager", is_active: 1 }, { id: 3, role: "manager", is_active: 0 },
      { id: 4, role: "admin", is_active: 1 }, { id: 5, role: "manager", is_active: 1 }];
    assert.deepEqual(activeManagers(items).map(item => item.id), [2, 5]);
    assert.ok(validateAssignment(own, 2, items)); assert.ok(validateAssignment(own, 3, items));
    assert.ok(validateAssignment(own, 4, items)); assert.ok(validateAssignment(own, "irina", items));
    assert.equal(validateAssignment(own, "5", items), "");
  });

  it("invalidates only a concrete request when its API reports forbidden or missing", () => {
    assert.equal(requestIdForAccessError("/requests/10/quotation/candidates", 404), 10);
    assert.equal(requestIdForAccessError("/requests/10/tasks/3", 403), 10);
    for (const [path, status] of [["/requests/assignees", 403], ["/requests", 404], ["/users/10", 403], ["/requests/10", 500]])
      assert.equal(requestIdForAccessError(path, status), null);
  });
});
