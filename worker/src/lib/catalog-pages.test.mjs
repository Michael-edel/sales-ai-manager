import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleCatalogRoutes } from "./catalog-api";
import { catalogAnalysisEvidence, extractAnalysisProducts } from "./catalog-analysis";

// Execute real SQLite migrations and transactions; only D1's transport is adapted.
let sqlite, env, queries;
const admin = { id: 1, username: "fixture-admin", role: "admin" };
const manager = { id: 2, username: "fixture-manager", role: "manager" };
const now = () => new Date().toISOString();
function statement(sql, bindings = []) {
  queries.push(sql);
  const execute = () => {
    const prepared = sqlite.prepare(sql);
    if (prepared.columns().length) return { results: prepared.all(...bindings), success: true, meta: {} };
    return { results: [], success: true, meta: { changes: Number(prepared.run(...bindings).changes) } };
  };
  return { bind: (...values) => statement(sql, values), first: async () => execute().results[0] || null,
    all: async () => execute(), run: async () => execute(), execute };
}
beforeEach(() => {
  queries = [];
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE requests(id INTEGER PRIMARY KEY,original_text TEXT NOT NULL,source_type TEXT NOT NULL DEFAULT 'text',assigned_user_id INTEGER DEFAULT 2); CREATE TABLE request_events(id INTEGER PRIMARY KEY,request_id INTEGER,event_type TEXT,actor TEXT,payload_json TEXT); INSERT INTO requests(id,original_text) VALUES(1,'Автомат Sirius C16 — 5 шт');");
  for (const migration of ["0020_catalog_quotations.sql", "0022_catalog_pages.sql"])
    sqlite.exec(readFileSync(new URL("../../migrations/" + migration, import.meta.url), "utf8"));
  env = { DB: { prepare: sql => statement(sql), batch: async entries => {
    sqlite.exec("BEGIN");
    try { const values = entries.map(entry => entry.execute()); sqlite.exec("COMMIT"); return values; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } };
});
afterEach(() => sqlite.close());
function offer(id = "warehouse:1", changes = {}) {
  return { id, productId: id, name: "Автомат Sirius C16 1P", article: "ABC16", brand: "Sirius", onecCode: "0001",
    unit: "шт", sourceId: "warehouse:onec", sourceName: "1С Экибастуз", sourceType: "warehouse",
    warehouseName: "Экибастуз", quantity: 10, available: true, stockConfirmed: true, updatedAt: now(),
    prices: { purchase: { amount: 580, currency: "KZT", vatIncluded: true, vatRate: 16, updatedAt: now() },
      retail: { amount: 1160, currency: "KZT", vatIncluded: true, vatRate: 16, updatedAt: now() }, wholesale: null },
    delivery: { type: "stock", timezone: "Asia/Almaty", windows: [], shippingCost: 0, notes: "Самовывоз" }, ...changes };
}
async function call(path, method = "GET", data, user = admin) {
  const response = await handleCatalogRoutes(new Request("https://ai.michael.kz/api" + path, {
    method, headers: { "Content-Type": "application/json", Origin: "https://ai.michael.kz" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), env, user);
  return { status: response.status, data: await response.json() };
}
async function begin(count = 1, options = {}) {
  const response = await call("/catalog/imports", "POST", {
    schemaVersion: 1, sourceSystem: "michael-cabinet", environment: "test", exportedAt: now(), offerCount: count, ...options,
  });
  expect(response.status).toBe(201); expect(response.data.storageVersion).toBe(2);
  return response.data.id;
}
const upload = (id, index, offers) => call(`/catalog/imports/${id}/batches/${index}`, "PUT", { offers });
const commit = id => call(`/catalog/imports/${id}/commit`, "POST", {});
async function load(offers, options = {}) {
  const id = await begin(offers.length, options);
  for (let i = 0; i < offers.length; i += 100) expect((await upload(id, i / 100, offers.slice(i, i + 100))).status).toBe(200);
  expect((await commit(id)).status).toBe(200);
  return id;
}
const line = (query = "ABC16", changes = {}) => ({ id: "l", query, quantity: 5, unit: "шт", allocations: [], ...changes });
const search = (id, row) => call("/requests/1/quotation/candidates", "POST", { catalogSnapshotId: id, line: row });
const quote = (offerId = "warehouse:1", query = "ABC16") => ({ lines: [line(query, { allocations: [{
  offerId, quantity: 5, unitSalePrice: 1160, saleVatIncluded: true, saleVatRate: 16, shippingCost: 0, confirmed: true,
}] })] });
function raceBatches() {
  const batch = env.DB.batch;
  let arrived = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  env.DB.batch = async entries => { if (++arrived === 2) release(); await ready; return batch(entries); };
}

describe("bounded catalog page storage", () => {
  it("provides catalog candidates and test provenance to request analysis", async () => {
    const id = await load([offer("cable", { name: "Кабель КГ 4*4", article: "КГ 4*4", onecCode: "C1", unit: "м" })]);
    sqlite.prepare("UPDATE catalog_pages SET search_text=? WHERE snapshot_id=?").run("кабель кг 4 4", id);
    const text = "| № | Код | Наименование | Ед. изм. | Кол-во | Цена |\n|---|---|---|---|---|---|\n| 1 | уточняется | Кабель КГ 4х4 | м | 30 | уточняется |";
    expect(extractAnalysisProducts(text)).toEqual([{query:"Кабель КГ 4х4",quantity:30,unit:"м"}]);
    const evidence = await catalogAnalysisEvidence(env, text);
    expect(evidence.prompt).toContain("среда test");
    expect(evidence.prompt).toContain("Кабель КГ 4*4");
    expect(evidence.prompt).toContain("тестовой 1С");
    expect(evidence.prompt).toContain('"quantity":10');
    expect(evidence.report).toContain("остаток: 10 м");
  });
  it("finds cable dimensions across old indexes without accepting a different size", async () => {
    const cable = offer("cable:4", { name: "Кабель КГ 4*4", article: "КГ 4*4", brand: "", onecCode: "", unit: "м" });
    const other = offer("cable:40", { name: "Кабель КГ 4*40", article: "КГ 4*40", brand: "", onecCode: "", unit: "м" });
    const id = await load([cable, other]);
    // Simulate pages imported before numeric separators were normalized.
    sqlite.prepare("UPDATE catalog_pages SET search_text=? WHERE snapshot_id=?").run("кабель кг 4 4 кабель кг 4 40", id);
    for (const query of ["КГ 4х4", "КГ 4x4", "КГ 4×4", "КГ 4*4"]) {
      const result = await search(id, line(query, { unit: "м" }));
      expect(result.status).toBe(200);
      expect(result.data.candidates.map(item => item.offer.id)).toContain("cable:4");
      const wrong = result.data.candidates.find(item => item.offer.id === "cable:40");
      if (wrong) expect(wrong.matchKind).toBe("similar");
    }
  });
  it("reads supplier prices only from complete snapshots for the same source and all employee roles", async () => {
    const source = offer("supplier:x", { sourceType: "supplier", sourceId: "s1", sourceName: "S1", unit: "шт" });
    const old = await load([source], { exportedAt: new Date(Date.now() - 120000).toISOString() });
    const draft = await begin(1, { exportedAt: new Date(Date.now() - 60000).toISOString() });
    await upload(draft, 0, [{ ...source, prices: { ...source.prices, purchase: { ...source.prices.purchase, amount: 9999 } } }]);
    await load([{ ...source, prices: { ...source.prices, purchase: { ...source.prices.purchase, amount: 700 } } }]);
    for (const role of ["admin", "manager", "accountant", "viewer"]) {
      const result = await call(`/catalog/price-history?offerId=${encodeURIComponent(source.id)}`, "GET", undefined, { id: 2, username: "fixture", role });
      expect(result.status).toBe(200);
      expect(result.data.points.map(p => p.price.amount)).toEqual([700, 580]);
    }
    expect((await call('/catalog/price-history?offerId=missing')).status).toBe(404);
    expect((await call('/catalog/price-history?offerId=supplier%3Ax&before=invalid')).status).toBe(400);
  });

  it("stores file identity and exposes only the owning administrator's resumable manifest", async () => {
    const contentHash = "a".repeat(64), id = await begin(2, { contentHash });
    await upload(id, 4, [offer()]);
    const manifest = await call(`/catalog/imports/${id}`);
    expect(manifest.data).toMatchObject({ id, storageVersion: 2, contentHash, status: "uploading", receivedCount: 1, expectedCount: 2, environment: "test" });
    expect(manifest.data.batches).toEqual([{ index: 4, offerCount: 1, checksum: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect((await call(`/catalog/imports/${id}`, "GET", undefined, manager)).status).toBe(403);
    expect((await call(`/catalog/imports/${id}`, "GET", undefined, { ...admin, id: 3 })).status).toBe(403);
    expect((await call("/catalog/imports/not-an-id")).status).toBe(404);
    expect((await call("/catalog/imports", "POST", { schemaVersion: 1, sourceSystem: "michael-cabinet", environment: "test", exportedAt: now(), offerCount: 1, contentHash: "BAD" })).status).toBe(400);
  });

  it("keeps a thousand offers in ten pages without per-offer table/index writes", async () => {
    const items = Array.from({ length: 1000 }, (_, index) => offer(`item:${index}`, { article: `ART-${index}` }));
    const id = await load(items);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_pages").get().n).toBe(10);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_offers").get().n).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_import_batches").get().n).toBe(10);
    expect((await call("/catalog/status")).data.activeSnapshot).toMatchObject({ id, offerCount: 1000, storageVersion: 2, environment: "test" });
    expect((await search(id, line("ART-999"))).data.candidates[0].offer.id).toBe("item:999");
  });

  it("retains atomic replay semantics, including concurrent identical and conflicting pages", async () => {
    const id = await begin(), item = offer();
    raceBatches();
    const results = await Promise.all([upload(id, 0, [item]), upload(id, 0, [item])]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(results.map(result => result.data.receivedCount)).toEqual([1, 1]);
    expect((await upload(id, 0, [{ ...item, name: "Другое" }])).status).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_pages").get().n).toBe(1);
    expect((await commit(id)).status).toBe(200);
    expect((await upload(id, 0, [item])).status).toBe(200);
  });

  it("rejects concurrent capacity overflow without persisting the losing page or receipt", async () => {
    const id = await begin(); raceBatches();
    const results = await Promise.all([upload(id, 0, [offer("a")]), upload(id, 1, [offer("b")])]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_pages").get().n).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_import_batches").get().n).toBe(1);
    expect((await call(`/catalog/imports/${id}`)).data.receivedCount).toBe(1);
  });

  it("keeps the winning page when concurrent replays have different payloads", async () => {
    const id = await begin(), item = offer(); raceBatches();
    const results = await Promise.all([upload(id, 0, [item]), upload(id, 0, [{ ...item, name: "Другой товар" }])]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const winner = JSON.parse(sqlite.prepare("SELECT payload_json FROM catalog_pages").get().payload_json)[0];
    expect([item.name, "Другой товар"]).toContain(winner.name);
    expect((await call(`/catalog/imports/${id}`)).data.receivedCount).toBe(1);
  });

  it("rolls back the receipt and page when the counter operation fails", async () => {
    const id = await begin(), batch = env.DB.batch;
    env.DB.batch = entries => batch([entries[0], entries[1], { execute: () => { throw new Error("fixture failure"); } }]);
    await expect(upload(id, 0, [offer()])).rejects.toThrow("fixture failure");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_pages").get().n).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_import_batches").get().n).toBe(0);
    expect((await call(`/catalog/imports/${id}`)).data.receivedCount).toBe(0);
  });

  it("validates pages before persistence and does not turn local duplicate IDs into valid stock", async () => {
    const id = await begin(2), item = offer();
    expect((await upload(id, 0, [item, item])).status).toBe(400);
    expect((await upload(id, 0, [{ ...item, quantity: -1 }])).status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_pages").get().n).toBe(0);
  });

  it("bounds the total stored page bytes even when the input body fits the upload limit", async () => {
    const items = Array.from({ length: 100 }, (_, index) => offer(`${index}:` + "x".repeat(3000), { name: "Т".repeat(2000) }));
    expect(new TextEncoder().encode(JSON.stringify({ offers: items })).length).toBeLessThan(2 * 1024 * 1024);
    const id = await begin(items.length), response = await upload(id, 0, items);
    expect(response.status).toBe(413); expect(response.data.detail).toContain("Уменьшите");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_pages").get().n).toBe(0);
    expect((await call(`/catalog/imports/${id}`)).data.receivedCount).toBe(0);
  });

  it("rejects cross-page duplicate identities at activation while preserving the previous catalog", async () => {
    const active = await load([offer("old")], { exportedAt: new Date(Date.now() - 60000).toISOString() });
    const id = await begin(3), item = offer("duplicate");
    expect((await upload(id, 0, [item])).status).toBe(200);
    expect((await upload(id, 1, [item, offer("unique")])).status).toBe(200);
    expect((await commit(id)).status).toBe(409);
    expect((await call("/catalog/status")).data.activeSnapshot.id).toBe(active);
    expect((await call(`/catalog/imports/${id}`)).data.status).toBe("uploading");
  });

  it("does not activate a page snapshot whose stored count no longer matches its receipt", async () => {
    const id = await begin(2);
    await upload(id, 0, [offer("a")]); await upload(id, 1, [offer("b")]);
    sqlite.prepare("DELETE FROM catalog_pages WHERE snapshot_id=? AND batch_index=1").run(id);
    expect((await commit(id)).status).toBe(409);
    expect((await call("/catalog/status")).data.activeSnapshot).toBeNull();
  });

  it("checks text terms per offer instead of accepting terms spread across different products in a page", async () => {
    const id = await load([
      offer("red", { name: "Кабель красный", article: "red", onecCode: "" }),
      offer("blue", { name: "Автомат синий", article: "blue", onecCode: "" }),
      offer("exact", { name: "Кабель синий", article: "blue-wire", onecCode: "" }),
    ]);
    const result = await search(id, line("Кабель синий"));
    expect(result.data.candidates.map(item => item.offer.id)).toEqual(["exact"]);
    expect(result.data.searchTruncated).toBe(false);
  });

  it("uses quoted exact keys and returns a late exact article ahead of a bounded broad text search", async () => {
    const id = await begin(27);
    for (let i = 0; i < 26; i++) await upload(id, i, [offer(`filler:${i}`, { name: "needle", article: `prefix-${i}`, onecCode: "" })]);
    await upload(id, 26, [offer('late:"id', { name: "needle", article: 'target:"sku', onecCode: "" })]);
    expect((await commit(id)).status).toBe(200);
    const result = await search(id, line("needle", { article: 'target:"sku', brand: "Sirius" }));
    expect(result.data.searchTruncated).toBe(true);
    expect(result.data.candidates[0].offer.id).toBe('late:"id');
    const notExact = await search(id, line("prefix"));
    expect(notExact.data.candidates.every(item => item.matchKind !== "article_brand")).toBe(true);
  });

  it("loads confirmed links and identity anchors across pages for search, evaluation and saved history", async () => {
    const warehouse = offer("warehouse:1", { productId: 'canonical:"1' });
    const supplier = offer("supplier:1", { productId: warehouse.productId, name: "Выключатель модульный", article: "OTHER", onecCode: "", sourceType: "supplier", sourceId: "supplier", sourceName: "Поставщик" });
    const unrelated = offer("unrelated", { productId: 'xcanonical:"1', name: "Чужой товар", article: "OTHER2", onecCode: "" });
    const id = await begin(3, { environment: "live" });
    await upload(id, 0, [warehouse]); await upload(id, 1, [supplier, unrelated]); await commit(id);
    const found = await search(id, line("0001"));
    expect(found.data.candidates.map(item => item.offer.id)).toEqual(expect.arrayContaining([warehouse.id, supplier.id]));
    expect(found.data.candidates.some(item => item.offer.id === unrelated.id)).toBe(false);
    expect(found.data.candidates.find(item => item.offer.id === supplier.id).matchKind).toBe("confirmed_link");
    const saved = await call("/requests/1/quotation", "PUT", { catalogSnapshotId: id, expectedRevision: 0, draft: quote(supplier.id, "0001") }, manager);
    expect(saved.status).toBe(200); expect(saved.data.evaluation.totals.profitNet).toBe(2500);
    expect(saved.data.evaluation.lines[0].allocations[0].ready).toBe(true);
    expect((await call("/requests/1/quotation")).data.revision).toBe(1);
    expect((await call("/requests/1/quotation", "PUT", { catalogSnapshotId: id, expectedRevision: 0, draft: quote(supplier.id, "0001") }, manager)).status).toBe(409);
  });

  it("continues to read a migrated row snapshot and its saved quote after a page snapshot is activated", async () => {
    const old = await begin(1, { environment: "live", exportedAt: new Date(Date.now() - 60000).toISOString() });
    sqlite.prepare("UPDATE catalog_imports SET storage_version=1 WHERE id=?").run(old);
    await upload(old, 0, [offer()]); await commit(old);
    expect((await search(old, line())).data.candidates[0].offer.id).toBe("warehouse:1");
    expect((await call("/requests/1/quotation", "PUT", { catalogSnapshotId: old, expectedRevision: 0, draft: quote() })).status).toBe(200);
    const current = await load([offer()]);
    const saved = await call("/requests/1/quotation");
    expect(saved.data.catalogSnapshotId).toBe(old); expect(saved.data.activeCatalogSnapshotId).toBe(current);
    expect(saved.data.catalogOutdated).toBe(true); expect(saved.data.evaluation.totals.profitNet).toBe(2500);
    expect((await call("/requests/1/quotation/evaluate", "POST", { catalogSnapshotId: old, draft: quote() })).status).toBe(409);
  });
});
