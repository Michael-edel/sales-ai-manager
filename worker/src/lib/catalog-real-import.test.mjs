import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { handleCatalogRoutes } from "./catalog-api";
import { beginPageSync,stagePage,commitPageSync } from "./catalog-page-sync";

// Opt-in acceptance replay of a private Cabinet export. CI never needs customer
// data, credentials, a production database, or a local 1C/supplier server.
const fixturePath = process.env.MICHAEL_CATALOG_FIXTURE;
const admin = { id: 1, username: "fixture-admin", role: "admin" };
const manager = { id: 2, username: "fixture-manager", role: "manager" };
const source = {
  warehouse: "warehouse:onec-nkt", elco: "supplier:elco", azerti: "supplier:azerti",
  alstyle: "supplier:al-style", ct1: "supplier:svetotehnika-1", volt: "supplier:220volt",
};
let sqlite, env, snapshot, snapshotId, counts, importedAt;
const syncDevice={id:"33333333-3333-4333-8333-333333333333",created_by:1};
const writes = [];
const requestText = "DK-01S — 3 шт\nDefender 99751 — 1 шт\nXK-100UB — 1 шт\nSirius 006072 — 6 шт\n23876 — 1 шт";
function statement(sql, bindings = []) {
  const execute = () => {
    const prepared = sqlite.prepare(sql);
    if (/^(?:INSERT|UPDATE|DELETE)/.test(sql)) writes.push(sql);
    if (prepared.columns().length) return { results: prepared.all(...bindings), success: true, meta: {} };
    return { results: [], success: true, meta: { changes: Number(prepared.run(...bindings).changes) } };
  };
  return { bind: (...values) => statement(sql, values), first: async () => execute().results[0] || null,
    all: async () => execute(), run: async () => execute(), execute };
}
async function call(path, method = "GET", data, user = manager) {
  const response = await handleCatalogRoutes(new Request("https://ai.michael.kz/api" + path, {
    method, headers: { "Content-Type": "application/json", Origin: "https://ai.michael.kz" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), env, user);
  return { status: response.status, data: await response.json() };
}
const line = (id, query, quantity = 1, article = "", brand = "") => ({ id, query, quantity, unit: "шт", article, brand, allocations: [] });
const search = row => call("/requests/1/quotation/candidates", "POST", { catalogSnapshotId: snapshotId, line: row });
const pick = (sourceId, article) => {
  const matches = snapshot.offers.filter(offer => offer.sourceId === sourceId && offer.article === article && offer.stockConfirmed);
  expect(matches, `Fixture must contain one current ${sourceId} / ${article}`).toHaveLength(1);
  return matches[0];
};
const allocation = (offer, quantity) => ({ offerId: offer.id, quantity, unitSalePrice: null, saleVatIncluded: null,
  saleVatRate: null, shippingCost: null, confirmed: false });

describe.skipIf(!fixturePath)("private real catalogue acceptance (opt-in)", () => {
  beforeAll(async () => {
    const started = performance.now(), bytes = readFileSync(fixturePath);
    snapshot = JSON.parse(bytes.toString("utf8"));
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.sourceSystem).toBe("michael-cabinet");
    expect(snapshot.environment).toBe("test");
    expect(snapshot.offers.length).toBeGreaterThan(10000);
    // Replay at the immutable snapshot's time, including weekly cutoffs and age
    // warnings, so rerunning this private test tomorrow has the same meaning.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(snapshot.exportedAt));
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE app_users(id INTEGER PRIMARY KEY,role TEXT,is_active INTEGER); INSERT INTO app_users VALUES(1,'admin',1); CREATE TABLE requests(id INTEGER PRIMARY KEY,original_text TEXT NOT NULL,source_type TEXT NOT NULL DEFAULT 'text',assigned_user_id INTEGER DEFAULT 2); CREATE TABLE request_events(id INTEGER PRIMARY KEY,request_id INTEGER,event_type TEXT,actor TEXT,payload_json TEXT);");
    sqlite.prepare("INSERT INTO requests(id,original_text) VALUES(1,?)").run(requestText);
    for (const migration of ["0020_catalog_quotations.sql", "0022_catalog_pages.sql", "0027_catalog_sync.sql"])
      sqlite.exec(readFileSync(new URL("../../migrations/" + migration, import.meta.url), "utf8"));
    sqlite.prepare("INSERT INTO catalog_sync_devices(id,token_hash,created_by,created_at) VALUES(?,?,1,?)").run(syncDevice.id,"fixture",snapshot.exportedAt);
    env = { DB: { prepare: sql => statement(sql), batch: async entries => {
      sqlite.exec("BEGIN");
      try { const values = entries.map(entry => entry.execute()); sqlite.exec("COMMIT"); return values; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    } } };
    const opened = await call("/catalog/imports", "POST", { schemaVersion: snapshot.schemaVersion, sourceSystem: snapshot.sourceSystem,
      environment: snapshot.environment, exportedAt: snapshot.exportedAt, offerCount: snapshot.offers.length,
      contentHash: createHash("sha256").update(bytes).digest("hex") }, admin);
    expect(opened.status).toBe(201); expect(opened.data.storageVersion).toBe(2);
    snapshotId = opened.data.id;
    for (let offset = 0; offset < snapshot.offers.length; offset += 100) {
      const response = await call(`/catalog/imports/${snapshotId}/batches/${offset / 100}`, "PUT", { offers: snapshot.offers.slice(offset, offset + 100) }, admin);
      expect(response.status, `Import batch ${offset / 100}: ${JSON.stringify(response.data)}`).toBe(200);
      expect(response.data.receivedCount).toBe(Math.min(offset + 100, snapshot.offers.length));
    }
    const activated = await call(`/catalog/imports/${snapshotId}/commit`, "POST", {}, admin);
    expect(activated.status).toBe(200);
    counts = { offers: snapshot.offers.length, pages: Number(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_pages").get().n),
      receipts: Number(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_import_batches").get().n),
      legacyRows: Number(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_offers").get().n) };
    importedAt = performance.now() - started;
    console.info("Private catalogue import acceptance:", JSON.stringify({ ...counts, elapsedMs: Math.round(importedAt) }));
  }, 120000);

  afterAll(() => { sqlite?.close(); vi.useRealTimers(); });

  it("activates the entire private export in bounded pages without per-offer storage writes", async () => {
    expect(counts.pages).toBe(Math.ceil(counts.offers / 100));
    expect(counts.receipts).toBe(counts.pages); expect(counts.legacyRows).toBe(0);
    expect(writes.some(sql => sql.startsWith("INSERT INTO catalog_offers"))).toBe(false);
    expect(writes.filter(sql => sql.startsWith("INSERT INTO catalog_pages"))).toHaveLength(counts.pages);
    const status = await call("/catalog/status");
    expect(status.data.activeSnapshot).toMatchObject({ id: snapshotId, offerCount: counts.offers, environment: "test", storageVersion: 2 });
    const manifest = await call(`/catalog/imports/${snapshotId}`, "GET", undefined, admin);
    expect(manifest.data).toMatchObject({ status: "complete", receivedCount: counts.offers, expectedCount: counts.offers });
    expect(manifest.data.batches).toHaveLength(counts.pages);
  });

  it("finds warehouse plus all five suppliers while retaining real quantity, unit, tax, age and delivery limits", async () => {
    const dk = await search(line("dk", "DK-01S", 3, "DK-01S"));
    expect(dk.status).toBe(200);
    const ownIndex = dk.data.candidates.findIndex(item => item.offer.sourceId === source.warehouse && item.offer.article === "DK-01S");
    const elcoIndex = dk.data.candidates.findIndex(item => item.offer.sourceId === source.elco && item.offer.article === "DK-01S");
    expect(ownIndex).toBeGreaterThanOrEqual(0); expect(elcoIndex).toBeGreaterThan(ownIndex);
    expect(dk.data.candidates[ownIndex].offer.quantity).toBe(1);
    expect(dk.data.candidates[elcoIndex].offer.quantity).toBe(76);
    expect(dk.data.candidates[elcoIndex].offer.unit).toBe("");
    expect(dk.data.candidates[elcoIndex].warnings.join(" ")).toMatch(/Единица.*неизвестна/);
    const rows = [
      [source.azerti, "99751", line("defender", "Defender 99751", 1, "99751")],
      [source.alstyle, "XK-100UB", line("keyboard", "XK-100UB", 1, "XK-100UB")],
      [source.ct1, "006072", line("breaker", "Sirius 006072", 6, "006072", "Sirius")],
      [source.volt, "23876", line("clamp", "23876", 1, "23876")],
    ];
    const results = [];
    for (const [sourceId, article, row] of rows) {
      const found = await search(row); expect(found.status).toBe(200);
      const item = found.data.candidates.find(candidate => candidate.offer.sourceId === sourceId && candidate.offer.article === article);
      expect(item, `Search ${row.query}`).toBeDefined();
      expect(item.offer).toEqual(pick(sourceId, article));
      expect(item.warnings.join(" ")).toContain("Тестовый каталог");
      expect(item.offer.prices.purchase.vatRate).toBeNull();
      results.push({ query: row.query, source: sourceId, quantity: item.offer.quantity, deliveryDate: item.deliveryDate });
      if (sourceId === source.ct1) {
        expect(item.offer.quantity).toBe(5); expect(item.deliveryDate).toBe("2026-11-04");
        expect(item.warnings.join(" ")).toContain("старше 24 часов");
      }
      if (sourceId === source.volt) {
        expect(item.deliveryDate).toBeNull(); expect(item.warnings.join(" ")).toContain("Срок доставки не подтверждён");
      }
    }
    console.info("Private catalogue searches:", JSON.stringify(results));
  });

  it("reads the matching supplier price observation from the full real-sized snapshot", async () => {
    const item = pick(source.volt, "23876");
    const response = await call(`/catalog/price-history?offerId=${encodeURIComponent(item.id)}`);
    expect(response.status).toBe(200);
    expect(response.data.points).toHaveLength(1);
    expect(response.data.points[0].price).toEqual(item.prices.purchase);
    expect(response.data.points[0].unit).toEqual(item.unit);
  });

  it("prepares, saves and reopens the five-line six-source quotation without inventing missing tax or units", async () => {
    const prepared = await call("/requests/1/quotation/prepare", "POST", {});
    expect(prepared.status).toBe(200); expect(prepared.data.draft.lines).toHaveLength(5);
    const own = pick(source.warehouse, "DK-01S"), elco = pick(source.elco, "DK-01S"), defender = pick(source.azerti, "99751"),
      keyboard = pick(source.alstyle, "XK-100UB"), breaker = pick(source.ct1, "006072"), clamp = pick(source.volt, "23876");
    const rows = [line("dk", "DK-01S", 3, "DK-01S"), line("defender", "Defender 99751", 1, "99751"),
      line("keyboard", "XK-100UB", 1, "XK-100UB"), line("breaker", "Sirius 006072", 6, "006072", "Sirius"), line("clamp", "23876", 1, "23876")];
    rows[0].allocations = [allocation(own, 1), allocation(elco, 2)];
    for (const [index, offer, quantity] of [[1, defender, 1], [2, keyboard, 1], [3, breaker, 5], [4, clamp, 1]]) rows[index].allocations = [allocation(offer, quantity)];
    const draft = { lines: rows, notes: "Тестовая заявка проверки переноса. Реальные цены и остатки из тестового каталога; неизвестные налоговые условия и единицы не подтверждены. Не является предложением клиенту." };
    const saved = await call("/requests/1/quotation", "PUT", { catalogSnapshotId: snapshotId, expectedRevision: 0, draft });
    expect(saved.status).toBe(200); expect(saved.data.revision).toBe(1);
    expect(saved.data.evaluation.status).not.toBe("ready");
    expect(saved.data.evaluation.totals.profitNet).toBeNull();
    const allocations = saved.data.evaluation.lines.flatMap(row => row.allocations);
    expect(allocations).toHaveLength(6);
    expect(new Set(allocations.map(row => row.offer.sourceId))).toEqual(new Set(Object.values(source)));
    expect(allocations.every(row => row.ready === false)).toBe(true);
    expect(allocations.every(row => row.warnings.some(warning => warning.includes("Тестовый каталог")))).toBe(true);
    expect(allocations.some(row => row.warnings.some(warning => warning.includes("НДС закупочной цены неизвестен")))).toBe(true);
    expect(saved.data.evaluation.lines[3].shortageQuantity).toBe(1);
    const reopened = await call("/requests/1/quotation");
    expect(reopened.status).toBe(200); expect(reopened.data.revision).toBe(1);
    expect(reopened.data.draft).toEqual(saved.data.draft);
    expect(reopened.data.evaluation).toEqual(saved.data.evaluation);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM request_events WHERE event_type='quotation_saved'").get().n).toBe(1);

    // Arithmetic demonstration ONLY: no assumptions are written into imported
    // offers or presented as the suppliers' real tax/delivery conditions.
    const demonstration = structuredClone(draft);
    demonstration.notes = "ИСКЛЮЧИТЕЛЬНО ДЕМОНСТРАЦИОННЫЙ РАСЧЁТ: условный НДС 16%, закупочная и продажная цены с НДС, продажа по удвоенной закупочной цене, условная бесплатная доставка и подтверждённая штука. Это не реальные подтверждённые условия поставщиков и не КП.";
    const byId = new Map(snapshot.offers.map(offer => [offer.id, offer]));
    for (const row of demonstration.lines) for (const a of row.allocations) {
      a.unitSalePrice = byId.get(a.offerId).prices.purchase.amount * 2;
      Object.assign(a, { confirmed: true, confirmedUnit: "шт", saleVatIncluded: true, saleVatRate: 16,
        purchaseVatIncluded: true, purchaseVatRate: 16, purchaseVatConfirmed: true, shippingCost: 0 });
    }
    const evaluated = await call("/requests/1/quotation/evaluate", "POST", { catalogSnapshotId: snapshotId, draft: demonstration });
    expect(evaluated.status).toBe(200);
    expect(evaluated.data.evaluation.totals.marginPercent).toBeCloseTo(50, 1);
    expect(evaluated.data.evaluation.totals.profitNet).toBeGreaterThan(0);
    expect(evaluated.data.evaluation.status).not.toBe("ready");
    expect(evaluated.data.evaluation.lines.every(row => row.allocations.every(a => !a.ready))).toBe(true);
    expect((await call("/requests/1/quotation")).data.revision).toBe(1);
    expect(pick(source.elco, "DK-01S").prices.purchase.vatIncluded).toBeNull();
    console.info("Private quotation acceptance:", JSON.stringify({ lines: rows.length, allocations: allocations.length,
      shortage: saved.data.evaluation.lines[3].shortageQuantity, actualProfit: saved.data.evaluation.totals.profitNet,
      demonstrationOnly: evaluated.data.evaluation.totals, status: evaluated.data.evaluation.status }));
  });
  it("reuses the real-sized immutable catalog while changing one supplier price",async()=>{
    const original=pick(source.volt,"23876");
    const page=sqlite.prepare("SELECT batch_index FROM catalog_pages WHERE snapshot_id=? AND instr(offer_keys,?)>0").get(snapshotId,JSON.stringify(original.id));
    expect(page).toBeTruthy();
    const observed=new Date(Date.parse(snapshot.exportedAt)+60000).toISOString();
    const change={id:original.id,sourceId:original.sourceId,quantity:original.quantity,available:original.available,stockConfirmed:original.stockConfirmed,updatedAt:observed,prices:{...original.prices,purchase:{...original.prices.purchase,amount:original.prices.purchase.amount+1,updatedAt:observed}}};
    const sync=await beginPageSync(env,snapshotId,syncDevice,1,observed);
    await stagePage(env,sync.id,syncDevice,page.batch_index,[change]);await commitPageSync(env,sync.id,syncDevice);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_pages WHERE snapshot_id=?').get(sync.id).n).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_page_refs WHERE snapshot_id=?').get(sync.id).n).toBe(Math.ceil(snapshot.offers.length/100));
    const history=await call(`/catalog/price-history?offerId=${encodeURIComponent(original.id)}`);
    expect(history.data.points.map(x=>x.price.amount)).toEqual([change.prices.purchase.amount,original.prices.purchase.amount]);
  });
});
