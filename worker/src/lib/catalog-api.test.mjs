import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleCatalogRoutes } from "./catalog-api";

// Real SQLite executes the shipped migration/queries; the adapter only exposes D1's call shape.
let sqlite, env, queries;
const admin = { id: 1, username: "fixture-admin", role: "admin" };
const manager = { id: 2, username: "fixture-manager", role: "manager" };
function statement(sql, bindings = []) {
  queries.push(sql);
  const execute = () => {
    const prepared = sqlite.prepare(sql);
    if (prepared.columns().length) return { results: prepared.all(...bindings), success: true, meta: {} };
    const meta = prepared.run(...bindings);
    return { results: [], success: true, meta: { changes: Number(meta.changes) } };
  };
  return {
    bind: (...values) => statement(sql, values),
    first: async () => execute().results[0] || null,
    all: async () => execute(),
    run: async () => execute(),
    execute,
  };
}
beforeEach(() => {
  queries = [];
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE requests(id INTEGER PRIMARY KEY,original_text TEXT NOT NULL,source_type TEXT NOT NULL DEFAULT 'text',assigned_user_id INTEGER DEFAULT 2); CREATE TABLE request_events(id INTEGER PRIMARY KEY,request_id INTEGER,event_type TEXT,actor TEXT,payload_json TEXT); INSERT INTO requests(id,original_text) VALUES(1,'Автомат Sirius C16 — 5 шт');");
  sqlite.exec(readFileSync(new URL("../../migrations/0020_catalog_quotations.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../../migrations/0022_catalog_pages.sql", import.meta.url), "utf8"));
  env = { DB: {
    prepare: sql => statement(sql),
    batch: async entries => {
      sqlite.exec("BEGIN");
      try { const values = entries.map(entry => entry.execute()); sqlite.exec("COMMIT"); return values; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } };
});
afterEach(() => sqlite.close());
const now = () => new Date().toISOString();
const offer = (id = "warehouse:1") => ({
  id, productId: id, name: "Автомат Sirius C16 1P", article: "ABC16", brand: "Sirius", onecCode: "0001",
  unit: "шт", sourceId: "warehouse:onec", sourceName: "1С Экибастуз", sourceType: "warehouse",
  warehouseName: "Экибастуз", quantity: 10, available: true, stockConfirmed: true, updatedAt: now(),
  prices: {
    purchase: { amount: 580, currency: "KZT", vatIncluded: true, vatRate: 16, updatedAt: now() },
    retail: { amount: 1160, currency: "KZT", vatIncluded: true, vatRate: 16, updatedAt: now() }, wholesale: null,
  },
  delivery: { type: "stock", timezone: "Asia/Almaty", windows: [], shippingCost: 0, notes: "Самовывоз" },
});
async function call(path, method = "GET", data, user = admin, origin = "https://ai.michael.kz") {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  const response = await handleCatalogRoutes(new Request("https://ai.michael.kz/api" + path, {
    method, headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), env, user);
  return { status: response.status, data: await response.json() };
}
async function begin(count = 1, exportedAt = now()) {
  const response = await call("/catalog/imports", "POST", {
    schemaVersion: 1, sourceSystem: "michael-cabinet", environment: "live", exportedAt, offerCount: count,
  });
  expect(response.status).toBe(201);
  // These are the historical row-storage regression scenarios. New imports use
  // pages by default and are covered by catalog-pages.test.mjs.
  sqlite.prepare("UPDATE catalog_imports SET storage_version=1 WHERE id=?").run(response.data.id);
  return response.data.id;
}
async function load(offers = [offer()], exportedAt = now()) {
  const id = await begin(offers.length, exportedAt);
  await call("/catalog/imports/" + id + "/batches/0", "PUT", { offers });
  expect((await call("/catalog/imports/" + id + "/commit", "POST", {})).status).toBe(200);
  return id;
}
const draft = () => ({ lines: [{
  id: "line1", query: "Автомат Sirius C16", quantity: 5, unit: "шт", allocations: [{
    offerId: "warehouse:1", quantity: 5, unitSalePrice: 1160, saleVatIncluded: true, saleVatRate: 16,
    shippingCost: 0, confirmed: true,
  }],
}], notes: "" });

function raceNextTwoBatches() {
  const batch = env.DB.batch;
  let arrived = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  env.DB.batch = async entries => {
    arrived += 1;
    if (arrived === 2) release();
    await ready;
    return batch(entries);
  };
}

describe("catalog integration API", () => {
  it("restricts purchase data and imports by role and rejects cross-site mutations", async () => {
    expect((await call("/catalog/status", "GET", undefined, { ...manager, role: "viewer" })).status).toBe(200);
    expect((await call("/catalog/imports", "POST", {}, manager)).status).toBe(403);
    expect((await call("/catalog/imports", "POST", {}, admin, "https://other.example")).status).toBe(403);
    expect((await call("/catalog/imports", "POST", {}, admin, "")).status).toBe(403);
  });
  it("activates only complete imports, while retries of identical chunks are idempotent", async () => {
    const id = await begin(2), item = offer();
    const chunk = "/catalog/imports/" + id + "/batches/0";
    expect((await call(chunk, "PUT", { offers: [item] })).data.receivedCount).toBe(1);
    expect((await call(chunk, "PUT", { offers: [item] })).data.receivedCount).toBe(1);
    expect((await call(chunk, "PUT", { offers: [{ ...item, name: "Другой" }] })).status).toBe(409);
    expect((await call("/catalog/imports/" + id + "/commit", "POST", {})).status).toBe(409);
    expect((await call("/catalog/status")).data.activeSnapshot).toBeNull();
    await call("/catalog/imports/" + id + "/batches/1", "PUT", { offers: [offer("supplier:2")] });
    expect((await call("/catalog/imports/" + id + "/commit", "POST", {})).data.activeSnapshot.offerCount).toBe(2);
  });
  it("rejects an incomplete/invalid offer before persisting a package", async () => {
    const id = await begin();
    const response = await call("/catalog/imports/" + id + "/batches/0", "PUT", { offers: [{ ...offer(), quantity: -1 }] });
    expect(response.status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_offers").get().n).toBe(0);
  });
  it("counts each concurrent replay once even when both requests read before either commits", async () => {
    const id = await begin(), item = offer();
    raceNextTwoBatches();
    const results = await Promise.all([0, 1].map(() => call(`/catalog/imports/${id}/batches/0`, "PUT", { offers: [item] })));
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(results.map(result => result.data.receivedCount)).toEqual([1, 1]);
    expect(sqlite.prepare("SELECT received_count FROM catalog_imports WHERE id=?").get(id).received_count).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_offers").get().n).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_import_batches").get().n).toBe(1);
  });
  it("preserves the winning payload when simultaneous replays conflict", async () => {
    const id = await begin(), item = offer();
    raceNextTwoBatches();
    const results = await Promise.all([item, { ...item, name: "Другой товар" }].map(value => call(`/catalog/imports/${id}/batches/0`, "PUT", { offers: [value] })));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(sqlite.prepare("SELECT received_count FROM catalog_imports WHERE id=?").get(id).received_count).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_offers").get().n).toBe(1);
  });
  it("increments independently concurrent batches without losing an update", async () => {
    const id = await begin(2);
    raceNextTwoBatches();
    const results = await Promise.all([0, 1].map(index => call(`/catalog/imports/${id}/batches/${index}`, "PUT", { offers: [offer(`item:${index}`)] })));
    expect(results.every(result => result.status === 200)).toBe(true);
    expect(sqlite.prepare("SELECT received_count FROM catalog_imports WHERE id=?").get(id).received_count).toBe(2);
    expect((await call(`/catalog/imports/${id}/commit`, "POST", {})).status).toBe(200);
  });
  it("rechecks capacity inside concurrent transactions and rejects overflow without writing rows", async () => {
    const id = await begin();
    raceNextTwoBatches();
    const results = await Promise.all([0, 1].map(index => call(`/catalog/imports/${id}/batches/${index}`, "PUT", { offers: [offer(`item:${index}`)] })));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(sqlite.prepare("SELECT received_count FROM catalog_imports WHERE id=?").get(id).received_count).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_offers").get().n).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_import_batches").get().n).toBe(1);
  });
  it("rolls back the batch receipt and rows when the counter update fails", async () => {
    const id = await begin();
    const batch = env.DB.batch;
    env.DB.batch = entries => batch([entries[0], entries[1], { execute: () => { throw new Error("fixture counter failure"); } }]);
    await expect(call(`/catalog/imports/${id}/batches/0`, "PUT", { offers: [offer()] })).rejects.toThrow("fixture counter failure");
    expect(sqlite.prepare("SELECT received_count FROM catalog_imports WHERE id=?").get(id).received_count).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_offers").get().n).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_import_batches").get().n).toBe(0);
  });
  it("scans the catalog once on activation and still rejects an inconsistent final row count", async () => {
    const id = await begin(3);
    for (let index = 0; index < 3; index += 1)
      expect((await call(`/catalog/imports/${id}/batches/${index}`, "PUT", { offers: [offer(`item:${index}`)] })).status).toBe(200);
    expect(queries.filter(query => query.includes("COUNT(*) FROM catalog_offers"))).toHaveLength(0);
    sqlite.prepare("DELETE FROM catalog_offers WHERE offer_id=?").run("item:2");
    expect((await call(`/catalog/imports/${id}/commit`, "POST", {})).status).toBe(409);
    // prepare and bind each pass through the adapter; there is only one executed count statement.
    expect(new Set(queries.filter(query => query.includes("COUNT(*) FROM catalog_offers"))).size).toBe(1);
    expect((await call("/catalog/status")).data.activeSnapshot).toBeNull();
    expect(sqlite.prepare("SELECT status FROM catalog_imports WHERE id=?").get(id).status).toBe("uploading");
  });
  it("searches only the active version and preserves own-stock classification", async () => {
    const id = await load();
    const response = await call("/requests/1/quotation/candidates", "POST", {
      catalogSnapshotId: id, line: { id: "l", query: "ABC16", quantity: 5, unit: "шт", allocations: [] },
    });
    expect(response.status).toBe(200);
    expect(response.data.candidates[0].offer.id).toBe("warehouse:1");
    expect(response.data.candidates[0].offer.sourceType).toBe("warehouse");
  });
  it("finds a confirmed supplier link by the warehouse 1C code", async () => {
    const warehouse = { ...offer(), productId: "canonical:1" };
    const supplier = { ...offer("supplier:1"), productId: "canonical:1", onecCode: "", article: "OTHER-16", name: "Выключатель модульный Сириус", sourceType: "supplier", sourceId: "supplier", sourceName: "Поставщик" };
    const id = await load([warehouse, supplier]);
    const result = await call("/requests/1/quotation/candidates", "POST", { catalogSnapshotId: id, line: { id: "l", query: "0001", quantity: 1, unit: "шт", allocations: [] } });
    expect(result.data.candidates.map(item => item.offer.id)).toEqual(expect.arrayContaining([warehouse.id, supplier.id]));
    expect(result.data.candidates.find(item => item.offer.id === supplier.id).matchKind).toBe("confirmed_link");
    const choice = draft(); choice.lines[0].query = "0001"; choice.lines[0].allocations[0].offerId = supplier.id;
    const calculated = await call("/requests/1/quotation/evaluate", "POST", { catalogSnapshotId: id, draft: choice });
    expect(calculated.status).toBe(200);
    expect(calculated.data.evaluation.lines[0].allocations[0].ready).toBe(true);
  });
  it("rejects duplicate offers across packages without partially importing them", async () => {
    const id = await begin(3), item = offer();
    await call("/catalog/imports/" + id + "/batches/0", "PUT", { offers: [item] });
    expect((await call("/catalog/imports/" + id + "/batches/1", "PUT", { offers: [item, offer("second")] })).status).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_offers").get().n).toBe(1);
  });
  it("calculates from server offers and saves a revision and event atomically", async () => {
    const id = await load();
    const response = await call("/requests/1/quotation", "PUT", { catalogSnapshotId: id, expectedRevision: 0, draft: draft() }, manager);
    expect(response.status).toBe(200);
    expect(response.data.revision).toBe(1);
    expect(response.data.evaluation.totals.profitNet).toBe(2500);
    expect(response.data.evaluation.totals.marginPercent).toBe(50);
    const conflict = await call("/requests/1/quotation", "PUT", { catalogSnapshotId: id, expectedRevision: 0, draft: draft() }, manager);
    expect(conflict.status).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM request_events").get().n).toBe(1);
    expect((await call("/requests/1/quotation")).data.revision).toBe(1);
  });
  it("rejects stale snapshot recalculation and retains the historical quotation", async () => {
    const old = await load([offer()], new Date(Date.now() - 60000).toISOString());
    await call("/requests/1/quotation", "PUT", { catalogSnapshotId: old, expectedRevision: 0, draft: draft() });
    const newer = await load([offer()]);
    expect((await call("/requests/1/quotation/evaluate", "POST", { catalogSnapshotId: old, draft: draft() })).status).toBe(409);
    const quote = (await call("/requests/1/quotation")).data;
    expect(quote.catalogOutdated).toBe(true);
    expect(quote.catalogSnapshotId).toBe(old);
    expect(quote.activeCatalogSnapshotId).toBe(newer);
    expect(quote.evaluationOutdated).toBe(true);
  });
  it("marks saved calculations as historical after time passes without a new snapshot", async () => {
    const id = await load();
    await call("/requests/1/quotation", "PUT", { catalogSnapshotId: id, expectedRevision: 0, draft: draft() });
    expect((await call("/requests/1/quotation")).data.evaluationOutdated).toBe(false);
    sqlite.prepare("UPDATE request_quotations SET updated_at=? WHERE request_id=1").run(new Date(Date.now()-3600000).toISOString());
    const saved = (await call("/requests/1/quotation")).data;
    expect(saved.catalogOutdated).toBe(false);
    expect(saved.evaluationOutdated).toBe(true);
    expect(saved.revision).toBe(1);
  });
  it("prepares editable lines from the original request without saving a quotation", async () => {
    const response = await call("/requests/1/quotation/prepare", "POST", {});
    expect(response.status).toBe(200);
    expect(response.data.draft.lines.length).toBeGreaterThan(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM request_quotations").get().n).toBe(0);
    expect((await call("/requests/999/quotation")).status).toBe(404);
  });
  it("prepares only product rows from a stored text request with metadata and 1C context", async () => {
    const original = "Контекст заявки:\nКомпания клиента: ТЕСТ подбора\nМенеджер Michael: Тестовый менеджер\nКанал связи: text\n\nСветильник LED Beta 72w Sirius — 10 шт\nАвтомат Sirius 1P C16 — 10 шт\nЩМП-65.50.22 IP54 — 10 шт\n\nАвтоматическая проверка 1С:\nИспользуйте эти данные как справочные данные из 1С. Если данных нет, не придумывайте цену, остаток, договор или товар.\nСтатус 1С: не проверено (bridge 1С не настроен).";
    sqlite.prepare("UPDATE requests SET original_text=? WHERE id=1").run(original);
    const response = await call("/requests/1/quotation/prepare", "POST", {});
    expect(response.status).toBe(200);
    expect(response.data.draft.lines.map(row => [row.query, row.quantity, row.unit])).toEqual([
      ["Светильник LED Beta 72w Sirius", 10, "шт"], ["Автомат Sirius 1P C16", 10, "шт"], ["ЩМП-65.50.22 IP54", 10, "шт"],
    ]);
    expect(sqlite.prepare("SELECT original_text FROM requests WHERE id=1").get().original_text).toBe(original);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM request_quotations").get().n).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM request_events").get().n).toBe(0);
  });
  it.each(["text_draft", "unknown"])("preserves a raw %s body including copied context and the user's trailing product", async sourceType => {
    const original = "Контекст заявки:\nКомпания клиента: Указана на чертеже\n\nКабель;10;м\n\nАвтоматическая проверка 1С:\nИспользуйте эти данные как справочные данные из 1С. Если данных нет, не придумывайте цену, остаток, договор или товар.\nСтатус 1С: не проверено (bridge 1С не настроен).\n\nДополнительно нужно:\nАвтомат Sirius C16 — 10 шт";
    sqlite.prepare("UPDATE requests SET original_text=?,source_type=? WHERE id=1").run(original, sourceType);
    const response = await call("/requests/1/quotation/prepare", "POST", {});
    expect(response.status).toBe(200);
    expect(response.data.draft.lines[0].query).toBe("Контекст заявки:");
    expect(response.data.draft.lines.at(-1)).toMatchObject({ query: "Автомат Sirius C16", quantity: 10, unit: "шт" });
    expect(response.data.draft.lines.some(row => row.query === "Автоматическая проверка 1С:")).toBe(true);
    expect(sqlite.prepare("SELECT original_text FROM requests WHERE id=1").get().original_text).toBe(original);
  });
  it("rejects a catalog switch that races with saving, without writing an event", async () => {
    const id = await load();
    const batch = env.DB.batch;
    env.DB.batch = async entries => {
      sqlite.prepare("DELETE FROM catalog_state WHERE id=1").run();
      return batch(entries);
    };
    const response = await call("/requests/1/quotation", "PUT", { catalogSnapshotId: id, expectedRevision: 0, draft: draft() });
    expect(response.status).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM request_quotations").get().n).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM request_events").get().n).toBe(0);
  });
});
