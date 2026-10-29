import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../index";
import { zipSync, strToU8 } from "fflate";
import { handleCatalogRoutes } from "./catalog-api";

let sqlite, env, beforeBatch;
const accounts = { admin: 1, a: 2, b: 3, accountant: 4, viewer: 5, inactive: 6 };
const token = name => `fixture-acl-session-${name}`;
function statement(sql, bindings = []) {
  const execute = () => {
    const query = sqlite.prepare(sql);
    if (query.columns().length) return { results: query.all(...bindings), success: true, meta: {} };
    const meta = query.run(...bindings);
    return { results: [], success: true, meta: { changes: Number(meta.changes), last_row_id: Number(meta.lastInsertRowid) } };
  };
  return { bind: (...values) => statement(sql, values), first: async () => execute().results[0] || null,
    all: async () => execute(), run: async () => execute(), execute, sql };
}
const now = () => new Date().toISOString();
const offer = () => ({ id: "warehouse:acl", productId: "product:acl", name: "Автомат Sirius C16", article: "ABC16", brand: "Sirius", onecCode: "0016", unit: "шт", sourceId: "warehouse:onec", sourceName: "1С Экибастуз", sourceType: "warehouse", warehouseName: "Экибастуз", quantity: 10, available: true, stockConfirmed: true, updatedAt: now(), prices: { purchase: { amount: 580, currency: "KZT", vatIncluded: true, vatRate: 16, updatedAt: now() }, retail: null, wholesale: null }, delivery: { type: "stock", timezone: "Asia/Almaty", windows: [], shippingCost: 0, notes: "" } });
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  const folder = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(folder).filter(file => file.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, folder), "utf8"));
  for (const [name, id] of Object.entries(accounts)) {
    const role = ["a", "b", "inactive"].includes(name) ? "manager" : name;
    sqlite.prepare("INSERT INTO app_users(id,username,display_name,role,password_hash,password_salt,email_address,is_active) VALUES(?,?,?,?,?,?,?,?)")
      .run(id, name, "Fixture " + name, role, "fixture", "fixture", `${name}@edel.kz`, name === "inactive" ? 0 : 1);
    sqlite.prepare("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES(?,?,datetime('now','+1 day'))")
      .run(id, createHash("sha256").update(token(name)).digest("base64"));
  }
  for (const id of [10, 20, 30]) {
    sqlite.prepare("INSERT INTO crm_clients(id,display_name,normalized_name) VALUES(?,?,?)").run(id, `Client ${id}`, `client${id}`);
    sqlite.prepare("INSERT INTO crm_contacts(id,client_id,display_name,normalized_name) VALUES(?,?,?,?)").run(id, id, `Contact ${id}`, `contact${id}`);
  }
  // CRM manager ID 2 deliberately collides with authenticated manager A's ID.
  sqlite.prepare("INSERT INTO michael_managers(id,display_name,normalized_name) VALUES(2,'Fixture a','fixturea')").run();
  for (const [id, assigned, client] of [[1, null, 30], [2, 2, 10], [3, 3, 20], [4, 4, null], [5, 5, null]]) {
    sqlite.prepare("INSERT INTO requests(id,source_type,original_text,ai_result,client_company,client_id,contact_id,michael_manager,michael_manager_id,assigned_user_id,client_type) VALUES(?,'text_draft',?,'fixture analysis',?,?,?,?,?,?,?)")
      .run(id, `Private request ${id}: Sirius C16 — 5 шт`, `Private company ${id}`, client, client, "Fixture a", 2, assigned, id === 1 || id === 3 ? "vip" : "standard");
    sqlite.prepare("INSERT INTO request_tasks(id,request_id,title,status,due_date) VALUES(?,?,?,'open','2020-01-01')").run(id * 10, id, `Private task ${id}`);
    sqlite.prepare("INSERT INTO request_events(request_id,event_type,actor,payload_json) VALUES(?,'fixture.created','fixture',?)").run(id, JSON.stringify({ secret: `request-${id}` }));
  }
  sqlite.prepare("INSERT INTO email_messages(id,mailbox_email,message_uid,subject,body_text,processed_request_id) VALUES(1,'a@edel.kz','fixture-foreign','Foreign processed','private request 3',3),(2,'a@edel.kz','fixture-own','Own processed','private request 2',2),(3,'a@edel.kz','fixture-pending','Pending','Sirius C16 — 2 шт',NULL)").run();
  const snapshotId = "fixture-active-catalog";
  sqlite.prepare("INSERT INTO catalog_imports(id,source_system,exported_at,environment,expected_count,received_count,status,created_by,storage_version) VALUES(?,'michael-cabinet',?,'test',1,1,'complete',1,1)").run(snapshotId, now());
  sqlite.prepare("INSERT INTO catalog_state(id,active_snapshot_id) VALUES(1,?)").run(snapshotId);
  sqlite.prepare("INSERT INTO catalog_offers(snapshot_id,offer_id,product_id,article_key,onec_code_key,search_text,source_type,payload_json) VALUES(?,'warehouse:acl','product:acl','abc16','0016','автомат sirius c16 abc16 0016','warehouse',?)").run(snapshotId, JSON.stringify(offer()));
  env = { DB: { prepare: sql => statement(sql), batch: async entries => {
    if (beforeBatch) { const callback = beforeBatch; beforeBatch = null; callback(); }
    sqlite.exec("BEGIN");
    try { const result = entries.map(entry => entry.execute()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } }, ASSETS: { fetch: vi.fn() } };
  beforeBatch = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected external request from ACL test"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sqlite.close(); });
async function call(path, method = "GET", data, account = "a", extra = {}) {
  const response = await worker.fetch(new Request("https://ai.michael.kz/api" + path, {
    method, headers: { "Content-Type": "application/json", Origin: "https://ai.michael.kz", Cookie: `sales_ai_session=${token(account)}`, ...extra },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), env);
  return { status: response.status, data: await response.json() };
}
const stored = id => sqlite.prepare("SELECT * FROM requests WHERE id=?").get(id);
const quote = () => ({ catalogSnapshotId: "fixture-active-catalog", expectedRevision: 0, draft: { lines: [{ id: "line1", query: "Sirius C16", article: "ABC16", quantity: 5, unit: "шт", allocations: [{ offerId: "warehouse:acl", quantity: 5, unitSalePrice: 1000, saleVatIncluded: true, saleVatRate: 16, shippingCost: 0, confirmed: true }] }], notes: "Private quote A" } });

describe("request ownership across all authenticated HTTP routes", () => {
  it("keeps legacy rows admin-only despite matching CRM manager names/IDs and scopes list/dashboard/tasks", async () => {
    expect((await call("/requests")).data.map(row => row.id)).toEqual([2]);
    expect((await call("/requests", "GET", undefined, "b")).data.map(row => row.id)).toEqual([3]);
    expect((await call("/requests", "GET", undefined, "admin")).data).toHaveLength(5);
    expect((await call("/requests/1")).status).toBe(404);
    expect((await call("/requests/1", "GET", undefined, "admin")).data.assigned_user_id).toBeNull();
    expect((await call("/requests/2")).data).toMatchObject({ assigned_user_id: 2, assigned_user_name: "Fixture a", assigned_user_username: "a" });
    expect((await call("/tasks/open")).data.map(row => row.request_id)).toEqual([2]);
    const dashboard = (await call("/crm/summary")).data;
    expect(dashboard).toMatchObject({ open_requests: 1, vip_requests: 0, open_tasks: 1, overdue_tasks: 1 });
    expect(dashboard.clients.map(row => row.id)).toEqual([10]); expect(dashboard.contacts.map(row => row.id)).toEqual([10]);
    expect(dashboard.status_counts).toEqual([{ status: "new", count: 1 }]);
    expect((await call("/crm/summary", "GET", undefined, "admin")).data.open_requests).toBe(5);
  });

  it("returns the same 404 for every foreign request read/mutation/export/nested route without touching its data", async () => {
    const before = stored(3), events = sqlite.prepare("SELECT count(*) AS n FROM request_events WHERE request_id=3").get().n;
    const routes = [
      ["", "GET"], ["", "DELETE"], ["/status", "PATCH"], ["/deal-documents", "PATCH"], ["/contract-appendix", "POST"],
      ["/tasks", "GET"], ["/tasks", "POST"], ["/tasks/30", "PATCH"], ["/tasks/30", "DELETE"], ["/events", "GET"],
      ["/1c-products", "GET"], ["/1c-products", "POST"], ["/1c-products/1", "DELETE"], ["/1c-products/stock-prices", "GET"],
      ["/1c-context", "POST"], ["/reanalyze-1c", "POST"], ["/quotation", "GET"], ["/quotation", "PUT"],
      ["/quotation/prepare", "POST"], ["/quotation/candidates", "POST"], ["/quotation/evaluate", "POST"],
    ];
    for (const [suffix, method] of routes) {
      const response = await call("/requests/3" + suffix, method, method === "GET" ? undefined : {});
      expect(response, method + suffix).toEqual({ status: 404, data: { detail: "Заявка не найдена." } });
    }
    expect(stored(3)).toEqual(before); expect(sqlite.prepare("SELECT count(*) AS n FROM request_events WHERE request_id=3").get().n).toBe(events);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows owned workflow/task/document/1C-selection actions while keeping other managers isolated", async () => {
    expect((await call("/requests/2/status", "PATCH", { priority: "high", next_action: "Fixture own action" })).status).toBe(200);
    expect((await call("/requests/2/deal-documents", "PATCH", { invoice_number: "ACL-2", invoice_status: "prepared" })).status).toBe(200);
    const appendix = await call("/requests/2/contract-appendix", "POST", {});
    expect(appendix.status).toBe(200); expect(appendix.data.appendix_html).toEqual(expect.any(String)); expect(appendix.data.request.id).toBe(2);
    const task = await call("/requests/2/tasks", "POST", { title: "Own action" });
    expect(task.status).toBe(200);
    expect((await call(`/requests/2/tasks/${task.data.id}`, "PATCH", { status: "done" })).status).toBe(200);
    expect((await call(`/requests/2/tasks/${task.data.id}`, "DELETE")).status).toBe(200);
    const product = await call("/requests/2/1c-products", "POST", { code: "ACL-2", name: "Own product" });
    expect(product.status).toBe(200);
    expect((await call(`/requests/2/1c-products/${product.data.id}`, "DELETE")).status).toBe(200);
    expect((await call("/requests/2/events")).data.length).toBeGreaterThan(1);
    expect(stored(3).invoice_number).toBeNull(); expect(stored(3).priority).toBe("normal"); expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks foreign request_id through email, WhatsApp, CRM, client exports and 1C command before external side effects", async () => {
    for (const [path, method, body] of [
      ["/email/send", "POST", { request_id: 3, to: "fixture@example.test", subject: "Fixture", body: "Fixture" }],
      ["/whatsapp/send-template", "POST", { request_id: 3 }],
      ["/1c/command", "POST", { request_id: 3, command: "цены" }],
      ["/crm/clients/20/1c-counterparty", "PATCH", { request_id: 3, name: "Foreign" }],
      ["/crm/clients/10/1c-counterparty", "PATCH", { request_id: 3, name: "Own client but foreign request" }],
      ["/1c/clients/20/profile", "GET", undefined],
      ["/email/messages/1", "GET", undefined], ["/email/messages/1/process", "POST", {}],
      ["/email/messages/1", "PATCH", { folder: "done" }], ["/email/messages/1", "DELETE", undefined],
    ]) expect((await call(path, method, body)).status, path).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect((await call("/email/messages?folder=all")).data.items.map(item => item.id).sort()).toEqual([2, 3]);
    expect((await call("/email/messages/2")).status).toBe(200);
  });

  it("creates a draft for its authenticated actor and rejects owner spoofing or changing owner in ordinary mutations", async () => {
    const body = { original_text: "Sirius C16 — 2 шт", michael_manager: "Fixture b" };
    const created = await call("/requests/text-draft", "POST", body, "a", { "Idempotency-Key": "fixture-acl-creation-0001" });
    expect(created.status).toBe(200); expect(created.data.assigned_user_id).toBe(2); expect(created.data.michael_manager).toBe("Fixture b");
    expect((await call("/requests/text-draft", "POST", { ...body, assigned_user_id: 3 }, "a", { "Idempotency-Key": "fixture-acl-creation-0002" })).status).toBe(400);
    expect((await call("/requests/text", "POST", { ...body, assigned_user_id: 3 })).status).toBe(400);
    expect((await call("/requests/2/status", "PATCH", { assigned_user_id: 3 })).status).toBe(400);
    expect((await call("/requests/2/deal-documents", "PATCH", { assigned_user_id: 3 })).status).toBe(400);
    expect(stored(2).assigned_user_id).toBe(2); expect(fetch).not.toHaveBeenCalled();
    expect((await call(`/requests/${created.data.id}`, "GET", undefined, "b")).status).toBe(404);
  });

  it("assigns AI text and email-created requests to the actual actor, rather than free-text manager metadata", async () => {
    env.OPENAI_API_KEY = "fixture-key";
    fetch.mockImplementation(async url => {
      expect(url).toBe("https://api.openai.com/v1/responses");
      return new Response(JSON.stringify({ output_text: "Fixture A-F result" }), { headers: { "Content-Type": "application/json" } });
    });
    const text = await call("/requests/text", "POST", { original_text: "Sirius C16 — 2 шт", michael_manager: "Fixture b" });
    expect(text.status).toBe(200); expect(text.data.assigned_user_id).toBe(2);
    const email = await call("/email/messages/3/process", "POST", {});
    expect(email.status).toBe(200); expect(email.data.assigned_user_id).toBe(2);
    expect((await call(`/requests/${email.data.id}`, "GET", undefined, "b")).status).toBe(404);
  });

  it("assigns an uploaded request to the authenticated actor and rejects an owner hidden in multipart input", async () => {
    env.OPENAI_API_KEY = "fixture-key";
    fetch.mockImplementation(async () => new Response(JSON.stringify({ output_text: "Fixture upload result" })));
    const upload = async spoof => {
      const body = new FormData(); body.set("michael_manager", "Fixture b");
      body.set("file", new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], "fixture.png", { type: "image/png" }));
      if (spoof) body.set("assigned_user_id", "3");
      const response = await worker.fetch(new Request("https://ai.michael.kz/api/requests/upload", {
        method: "POST", headers: { Origin: "https://ai.michael.kz", Cookie: `sales_ai_session=${token("a")}` }, body,
      }), env);
      return { status: response.status, data: await response.json() };
    };
    expect((await upload(true)).status).toBe(400);
    const created = await upload(false);
    expect(created.status).toBe(200); expect(created.data).toMatchObject({ assigned_user_id: 2, uploaded_file_name: "fixture.png", source_type: "image" });
  });

  it("lets every active employee upload XLSX into their own requests without granting other upload rights", async () => {
    env.OPENAI_API_KEY = "fixture-key";
    fetch.mockImplementation(async () => new Response(JSON.stringify({ output_text: "Fixture upload result" })));
    const bytes = zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Fixture" r:id="r1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Fixture item</t></is></c><c r="B1"><v>5</v></c></row></sheetData></worksheet>'),
    });
    async function upload(account, file) {
      const body = new FormData(); body.set("file", file);
      const response = await worker.fetch(new Request("https://ai.michael.kz/api/requests/upload", {
        method: "POST", headers: { Origin: "https://ai.michael.kz", Cookie: `sales_ai_session=${token(account)}` }, body,
      }), env);
      return { status: response.status, data: await response.json() };
    }
    for (const role of ["admin", "a", "accountant", "viewer"]) {
      const result = await upload(role, new File([bytes], "request.xlsx"));
      expect(result.status).toBe(200); expect(result.data.assigned_user_id).toBe(accounts[role]);
      expect(result.data.original_text).toContain("Fixture item | 5");
      if (role !== "admin") expect((await call(`/requests/${result.data.id}`, "GET", undefined, "b")).status).toBe(404);
    }
    const document = zipSync({"word/document.xml":strToU8('<w:document><w:body><w:p><w:r><w:t>DOCX fixture</w:t></w:r></w:p></w:body></w:document>')});
    for (const role of ["admin", "a", "accountant", "viewer"]) {
      const result = await upload(role, new File([document], "request.docx"));
      expect(result.status).toBe(200); expect(result.data.assigned_user_id).toBe(accounts[role]);
      expect(result.data.original_text).toContain("DOCX fixture");
      if (role !== "admin") expect((await call(`/requests/${result.data.id}`, "GET", undefined, "b")).status).toBe(404);
    }
    expect((await upload("viewer", new File(["image"], "request.png"))).status).toBe(403);
    expect((await upload("inactive", new File([bytes], "request.xlsx"))).status).toBe(401);
  });

  it("only admin transfers to active managers, audits the exact prior owner and immediately revokes old-manager access", async () => {
    expect((await call("/requests/assignees")).status).toBe(403);
    expect((await call("/requests/assignees", "GET", undefined, "admin")).data.map(user => user.id)).toEqual([2, 3]);
    expect((await call("/requests/2/assignee", "PATCH", { assigned_user_id: 3 })).status).toBe(403);
    for (const target of [1, 4, 5, 6, 999, "3", null]) expect((await call("/requests/2/assignee", "PATCH", { assigned_user_id: target }, "admin")).status).toBe(400);
    expect((await call("/requests/2/quotation", "PUT", quote())).status).toBe(200);
    const changed = await call("/requests/2/assignee", "PATCH", { assigned_user_id: 3 }, "admin");
    expect(changed.status).toBe(200); expect(changed.data).toMatchObject({ id: 2, assigned_user_id: 3, assigned_user_name: "Fixture b", assigned_user_username: "b" });
    for (const path of ["/requests/2", "/requests/2/tasks", "/requests/2/events", "/requests/2/quotation"]) expect((await call(path)).status).toBe(404);
    expect((await call("/requests/2", "GET", undefined, "b")).status).toBe(200);
    expect((await call("/requests/2/quotation", "GET", undefined, "b")).data).toMatchObject({ revision: 1, draft: { notes: "Private quote A" } });
    expect((await call("/requests")).data).toEqual([]);
    expect((await call("/requests", "GET", undefined, "b")).data.map(row => row.id).sort()).toEqual([2, 3]);
    const event = sqlite.prepare("SELECT * FROM request_events WHERE request_id=2 AND event_type='request.assigned'").get();
    expect(JSON.parse(event.payload_json)).toEqual({ actor_user_id: 1, previous_assigned_user_id: 2, assigned_user_id: 3 });
    expect((await call("/email/messages?folder=all")).data.items.map(item => item.id)).toEqual([3]);
  });

  it("can explicitly assign a legacy request, without altering its CRM reference or content", async () => {
    const before = stored(1);
    expect((await call("/requests/1/assignee", "PATCH", { assigned_user_id: 2 }, "admin")).status).toBe(200);
    expect((await call("/requests/1")).status).toBe(200);
    expect(stored(1)).toMatchObject({ original_text: before.original_text, ai_result: before.ai_result, michael_manager_id: 2, assigned_user_id: 2 });
  });

  it("checks active manager status again at transfer commit and does not record a misleading audit event", async () => {
    beforeBatch = () => sqlite.prepare("UPDATE app_users SET is_active=0 WHERE id=3").run();
    expect((await call("/requests/2/assignee", "PATCH", { assigned_user_id: 3 }, "admin")).status).toBe(409);
    expect(stored(2).assigned_user_id).toBe(2);
    expect(sqlite.prepare("SELECT count(*) AS n FROM request_events WHERE event_type='request.assigned'").get().n).toBe(0);
  });

  it("blocks a quotation save if the request was transferred during evaluation", async () => {
    beforeBatch = () => sqlite.prepare("UPDATE requests SET assigned_user_id=3 WHERE id=2").run();
    expect((await call("/requests/2/quotation", "PUT", quote())).status).toBe(404);
    expect(sqlite.prepare("SELECT count(*) AS n FROM request_quotations WHERE request_id=2").get().n).toBe(0);
  });

  it("does not commit a slow AI result after ownership changes while the service is responding", async () => {
    env.OPENAI_API_KEY = "fixture-key";
    fetch.mockImplementation(async () => {
      sqlite.prepare("UPDATE requests SET assigned_user_id=3 WHERE id=2").run();
      return new Response(JSON.stringify({ output_text: "Must not overwrite the new owner's request" }));
    });
    expect((await call("/requests/2/reanalyze-1c", "POST", {})).status).toBe(404);
    expect(stored(2).ai_result).toBe("fixture analysis");
    expect(sqlite.prepare("SELECT count(*) AS n FROM request_events WHERE event_type='request.reanalyzed_with_1c'").get().n).toBe(0);
  });

  it("does not delete a request or its children if ownership changes before the atomic delete", async () => {
    beforeBatch = () => sqlite.prepare("UPDATE requests SET assigned_user_id=3 WHERE id=2").run();
    expect((await call("/requests/2", "DELETE")).status).toBe(404);
    expect(stored(2)).toBeDefined(); expect(sqlite.prepare("SELECT count(*) AS n FROM request_tasks WHERE request_id=2").get().n).toBe(1);
    expect(sqlite.prepare("SELECT processed_request_id FROM email_messages WHERE id=2").get().processed_request_id).toBe(2);
  });

  it.each(["accountant", "viewer"])("gives %s only owned requests and the same read-only common catalog", async account => {
    const own = accounts[account];
    expect((await call("/requests", "GET", undefined, account)).data.map(row => row.id)).toEqual([own]);
    expect((await call("/requests/2", "GET", undefined, account)).status).toBe(404);
    expect((await call("/catalog/status", "GET", undefined, account)).status).toBe(200);
    const found = await call("/catalog/search?q=Sirius", "GET", undefined, account);
    expect(found.status).toBe(200); expect(found.data.candidates[0].offer).toMatchObject({ article: "ABC16", quantity: 10, unit: "шт", prices: { purchase: { amount: 580, vatIncluded: true } } });
    expect((await call("/catalog/imports", "POST", {}, account)).status).toBe(403);
    expect((await call(`/requests/${own}/quotation`, "PUT", quote(), account)).status).toBe(403);
  });

  it("does not rely on the outer router to protect direct catalog quotation calls", async () => {
    const response = await handleCatalogRoutes(new Request("https://ai.michael.kz/api/requests/3/quotation"), env, { id: 2, username: "a", role: "manager" });
    expect(response.status).toBe(404);
  });

  it("never keeps one caller's ownership context on the shared runtime environment", async () => {
    const [a, b] = await Promise.all([call("/requests"), call("/requests", "GET", undefined, "b")]);
    expect(a.data.map(row => row.id)).toEqual([2]); expect(b.data.map(row => row.id)).toEqual([3]);
    expect(env.REQUEST_USER).toBeUndefined();
  });
});
