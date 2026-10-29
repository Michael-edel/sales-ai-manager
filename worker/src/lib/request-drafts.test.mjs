import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../index";

let sqlite, env, failTaskBatch, beforeBatch;
const tokens = { manager: "fixture-manager-session", viewer: "fixture-viewer-session", second: "fixture-second-session", accountant: "fixture-accountant-session" };
const key = "fixture-submission-key-0001";
const payload = () => ({ original_text: "Автомат Sirius C16 — 10 шт\nКабель ВВГнг 3х2,5 — 20 м", client_company: "Тестовая компания", michael_manager: "Тестовый менеджер", communication_channel: "Другое", priority: "low" });
function statement(sql, bindings = []) {
  const execute = () => {
    if (failTaskBatch && sql.includes("INSERT INTO request_tasks")) throw new Error("fixture transaction failure");
    const prepared = sqlite.prepare(sql);
    if (prepared.columns().length) return { results: prepared.all(...bindings), success: true, meta: {} };
    const meta = prepared.run(...bindings);
    return { results: [], success: true, meta: { changes: meta.changes, last_row_id: Number(meta.lastInsertRowid) } };
  };
  return { bind: (...values) => statement(sql, values), first: async () => execute().results[0] || null, all: async () => execute(), run: async () => execute(), execute };
}
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const migrations = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  Object.entries(tokens).forEach(([role, token], index) => {
    const actualRole = role === "second" ? "manager" : role;
    sqlite.prepare("INSERT INTO app_users(id,username,display_name,role,password_hash,password_salt) VALUES(?,?,?,?,?,?)").run(index + 1, role, role, actualRole, "fixture", "fixture");
    sqlite.prepare("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES(?,?,datetime('now','+1 day'))").run(index + 1, createHash("sha256").update(token).digest("base64"));
  });
  env = { DB: {
    prepare: sql => statement(sql),
    batch: async statements => {
      if (beforeBatch) { const callback = beforeBatch; beforeBatch = null; callback(); }
      sqlite.exec("BEGIN");
      try { const values = statements.map(entry => entry.execute()); sqlite.exec("COMMIT"); return values; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  }, ASSETS: { fetch: vi.fn() } };
  failTaskBatch = false; beforeBatch = null;
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected external request from draft save"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sqlite.close(); });
async function save(body = payload(), options = {}) {
  const headers = { "Content-Type": options.contentType || "application/json", "Idempotency-Key": options.key ?? key };
  if (options.origin !== null) headers.Origin = options.origin || "https://ai.michael.kz";
  if (options.role !== null) headers.Cookie = `sales_ai_session=${tokens[options.role || "manager"]}`;
  const response = await worker.fetch(new Request("https://ai.michael.kz/api/requests/text-draft", {
    method: "POST", headers, body: options.raw ?? JSON.stringify(body),
  }), env);
  return { status: response.status, data: await response.json() };
}
const count = table => sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;

describe("text requests saved without AI", () => {
  it("does not expose the experimental device endpoint without device credentials or admin controls to a manager", async () => {
    const device = await worker.fetch(new Request("https://ai.michael.kz/api/catalog-sync/device/status"),env);
    expect(device.status).toBe(401);
    const admin = await worker.fetch(new Request("https://ai.michael.kz/api/catalog-sync/admin/devices", {method:"POST",headers:{Origin:"https://ai.michael.kz","Content-Type":"application/json",Cookie:`sales_ai_session=${tokens.manager}`},body:"{}"}),env);
    expect(admin.status).toBe(403);
  });
  it("creates a normal pending request and internal selection tasks without external calls", async () => {
    const response = await save();
    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({ source_type: "text_draft", original_text: payload().original_text, ai_result: "", status: "new", priority: "low", client_company: payload().client_company, invoice_status: "not_required" });
    expect(response.data.client_id).toBeGreaterThan(0);
    expect(count("requests")).toBe(1);
    expect(sqlite.prepare("SELECT title FROM request_tasks ORDER BY id").all().map(row => row.title)).toEqual(["Проверить позиции и единицы заявки", "Подобрать товары, цены и сроки"]);
    const event = JSON.parse(sqlite.prepare("SELECT payload_json FROM request_events WHERE event_type='request.created'").get().payload_json);
    expect(event).toMatchObject({ analysis_status: "pending", creation_mode: "catalog_selection" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires a session, manager role, same Origin and JSON", async () => {
    expect((await save(payload(), { role: null })).status).toBe(401);
    expect((await save(payload(), { role: "viewer" })).status).toBe(403);
    expect((await save(payload(), { role: "accountant" })).status).toBe(403);
    expect((await save(payload(), { origin: null })).status).toBe(403);
    expect((await save(payload(), { origin: "https://other.example" })).status).toBe(403);
    expect((await save(payload(), { contentType: "text/plain" })).status).toBe(415);
    expect(count("requests")).toBe(0);
    expect(count("request_draft_submissions")).toBe(0);
  });
  it("rejects empty/oversized/malformed input and forged lifecycle fields", async () => {
    expect((await save({ ...payload(), original_text: "  " })).status).toBe(400);
    expect((await save(payload(), { key: "" })).status).toBe(400);
    expect((await save(payload(), { raw: "{broken" })).status).toBe(400);
    expect((await save(null)).status).toBe(400);
    expect((await save({ ...payload(), ai_result: "Pretend AI success" })).status).toBe(400);
    expect((await save({ ...payload(), status: "quote_sent" })).status).toBe(400);
    expect((await save({ ...payload(), original_text: "a".repeat(100001) })).status).toBe(400);
    expect((await save({ ...payload(), original_text: "я".repeat(150000) })).status).toBe(413);
    expect(count("requests")).toBe(0);
  });
  it("replays the same request without duplicating tasks or changing CRM", async () => {
    const first = await save();
    const before = sqlite.prepare("SELECT * FROM crm_clients").all();
    const replay = await save();
    expect(replay.status).toBe(200);
    expect(replay.data.id).toBe(first.data.id);
    expect(count("requests")).toBe(1);
    expect(count("request_tasks")).toBe(2);
    expect(count("request_events")).toBe(2);
    expect(sqlite.prepare("SELECT * FROM crm_clients").all()).toEqual(before);
    const conflict = await save({ ...payload(), client_company: "Другая компания" });
    expect(conflict.status).toBe(409);
    expect(sqlite.prepare("SELECT * FROM crm_clients").all()).toEqual(before);
    expect(count("request_tasks")).toBe(2);
  });
  it("prevents concurrent duplicate creation, then returns the winning request on retry", async () => {
    const responses = await Promise.all([save(), save(), save()]);
    expect(responses.some(response => response.status === 200)).toBe(true);
    expect(responses.every(response => [200, 409].includes(response.status))).toBe(true);
    expect(count("requests")).toBe(1);
    expect(count("request_tasks")).toBe(2);
    const retry = await save();
    expect(retry.status).toBe(200);
    expect(retry.data.id).toBe(responses.find(response => response.status === 200).data.id);
  });
  it("scopes the key to the authenticated user", async () => {
    const first = await save();
    const second = await save(payload(), { role: "second" });
    expect(second.status).toBe(200);
    expect(second.data.id).not.toBe(first.data.id);
    expect(count("request_draft_submissions")).toBe(2);
  });
  it("rolls back the request, key link and tasks together after a write failure", async () => {
    failTaskBatch = true;
    expect((await save()).status).toBe(500);
    expect(count("requests")).toBe(0);
    expect(count("request_tasks")).toBe(0);
    expect(count("request_events")).toBe(0);
    expect(sqlite.prepare("SELECT request_id FROM request_draft_submissions").get().request_id).toBeNull();
    failTaskBatch = false;
    sqlite.exec("UPDATE request_draft_submissions SET claimed_at=0");
    expect((await save()).status).toBe(200);
    expect(count("requests")).toBe(1);
    expect(count("request_tasks")).toBe(2);
  });
  it("does not let a stale lease owner insert after another attempt takes ownership", async () => {
    beforeBatch = () => sqlite.exec("UPDATE request_draft_submissions SET claim_token='new-owner'");
    expect((await save()).status).toBe(409);
    expect(count("requests")).toBe(0);
    expect(count("request_tasks")).toBe(0);
    sqlite.exec("UPDATE request_draft_submissions SET claimed_at=0");
    expect((await save()).status).toBe(200);
    expect(count("requests")).toBe(1);
  });
  it("does not recreate a deleted request when its original submission is retried", async () => {
    const first = await save();
    sqlite.prepare("DELETE FROM requests WHERE id=?").run(first.data.id);
    expect((await save()).status).toBe(409);
    expect(count("requests")).toBe(0);
  });
  it("preserves the existing AI text insertion path", async () => {
    env.AI_PROVIDER = "openai"; env.OPENAI_API_KEY = "fixture-only";
    fetch.mockResolvedValue(new Response(JSON.stringify({ output_text: "A. Анализ тестовой заявки выполнен" }), { headers: { "Content-Type": "application/json" } }));
    const response = await worker.fetch(new Request("https://ai.michael.kz/api/requests/text", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: `sales_ai_session=${tokens.manager}` }, body: JSON.stringify(payload()),
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source_type: "text", ai_result: "A. Анализ тестовой заявки выполнен\n\nОбщий каталог: позиции автоматически не распознаны; проверьте подбор вручную." });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(count("requests")).toBe(1);
    expect(count("request_draft_submissions")).toBe(0);
    expect(count("request_tasks")).toBe(2);
  });
  it("includes catalog candidates in AI review while keeping test warehouse provenance", async () => {
    env.AI_PROVIDER = "openai"; env.OPENAI_API_KEY = "fixture-only";
    const now = new Date().toISOString(), id = "11111111-1111-4111-8111-111111111111";
    const cable = {id:"fixture:cable",productId:"fixture:cable",name:"Кабель КГ 4*4",article:"КГ 4*4",brand:"",onecCode:"C1",unit:"м",sourceId:"warehouse:test",sourceName:"1С тестовая",sourceType:"warehouse",warehouseName:"Экибастуз",quantity:8,available:true,stockConfirmed:true,updatedAt:now,prices:{purchase:{amount:100,currency:"KZT",vatIncluded:true,vatRate:null,updatedAt:now},wholesale:null,retail:null},delivery:{type:"stock",timezone:"Asia/Almaty",windows:[],shippingCost:null,notes:""}};
    sqlite.prepare("INSERT INTO catalog_imports(id,source_system,exported_at,environment,expected_count,received_count,status,created_by,storage_version) VALUES(?,'michael-cabinet',?,'test',1,1,'complete',1,2)").run(id,now);
    sqlite.prepare("INSERT INTO catalog_state(id,active_snapshot_id) VALUES(1,?)").run(id);
    sqlite.prepare("INSERT INTO catalog_pages VALUES(?,?,?,?,?,?,?,?)").run(id,0,1,JSON.stringify([cable]),"кабель кг 4 4",JSON.stringify(["кг 4 4","c1"]),JSON.stringify([cable.id]),JSON.stringify([cable.productId]));
    const first="| № | Код | Наименование | Ед. изм. | Кол-во | Цена |\n|---|---|---|---|---|---|\n| 1 | уточняется | Кабель КГ 4х4 | м | 30 | уточняется |";
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({output_text:first}))).mockResolvedValueOnce(new Response(JSON.stringify({output_text:"Подбор требует подтверждения."})));
    const response = await worker.fetch(new Request("https://ai.michael.kz/api/requests/text", {method:"POST",headers:{"Content-Type":"application/json",Cookie:`sales_ai_session=${tokens.manager}`},body:JSON.stringify(payload())}),env);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.ai_result).toContain("Кабель КГ 4*4");
    expect(result.ai_result).toContain("остаток: 8 м");
    expect(result.ai_result).toContain("среда: test");
    const review = JSON.parse(fetch.mock.calls[1][1].body);
    expect(review.input).toContain('"quantity":8');
    expect(review.input).toContain("тестовой 1С");
    expect(count("requests")).toBe(1);
  });
});
