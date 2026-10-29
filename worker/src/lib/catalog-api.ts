import {
  evaluateQuote, nextDeliveryDate, normalizeCatalogText, parseRequestLines, rankOffers,
  validateCatalogOffer, validateQuoteDraft,
  type CatalogOffer, type QuoteDraft,
} from "./catalog-selection";
import { hasRequestAccess, requestScope } from "./request-access";

type CatalogUser = { id: number; username: string; role: string };
type CatalogEnv = { DB: D1Database };
type ImportRow = {
  id: string; source_system: string; exported_at: string;
  environment: "test" | "live" | "unknown";
  expected_count: number; received_count: number; status: string; created_by: number;
  storage_version: 1 | 2; source_hash: string | null;
};
type SavedQuote = {
  revision: number; catalog_snapshot_id: string; draft_json: string;
  evaluation_json: string; updated_at: string;
};
class CatalogInputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const MAX_BODY = 2 * 1024 * 1024;
const MAX_BATCH = 100;
const MAX_PAGE_BYTES = 1800000;
const MAX_SEARCH_PAGES = 24;
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
const MAX_LOOKUP_PAGES = 512;
const MAX_LOOKUP_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
function input<T>(action: () => T): T {
  try { return action(); }
  catch (error) {
    throw new CatalogInputError(error instanceof Error ? error.message.slice(0, 300) : "Проверьте данные подбора.");
  }
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || ""))
    throw new CatalogInputError("Ожидается JSON.", 415);
  if (Number(request.headers.get("Content-Length")) > MAX_BODY)
    throw new CatalogInputError("Слишком большой пакет данных.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new CatalogInputError("Пустой запрос.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_BODY) { await reader.cancel(); throw new CatalogInputError("Слишком большой пакет данных.", 413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const data = input(() => JSON.parse(new TextDecoder().decode(bytes)));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new CatalogInputError("Ожидается объект JSON.");
  return data;
}
function integer(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new CatalogInputError("Некорректное поле: " + name + ".");
  return value;
}
async function activeSnapshot(env: CatalogEnv): Promise<ImportRow | null> {
  return env.DB.prepare("SELECT i.* FROM catalog_state s JOIN catalog_imports i ON i.id=s.active_snapshot_id WHERE s.id=1 AND i.status='complete'").first<ImportRow>();
}
function publicSnapshot(row: ImportRow | null) {
  return row ? { id: row.id, exportedAt: row.exported_at, environment: row.environment, offerCount: row.received_count, storageVersion: row.storage_version } : null;
}
async function requireActive(env: CatalogEnv, snapshotId: unknown): Promise<ImportRow> {
  const active = await activeSnapshot(env);
  if (!active) throw new CatalogInputError("Сначала импортируйте каталог из кабинета Michael.", 409);
  if (snapshotId !== active.id) throw new CatalogInputError("Каталог обновлён. Пересчитайте подбор по актуальному каталогу.", 409);
  return active;
}
async function getImport(env: CatalogEnv, id: string): Promise<ImportRow> {
  if (!UUID.test(id)) throw new CatalogInputError("Неверный импорт.", 404);
  const row = await env.DB.prepare("SELECT * FROM catalog_imports WHERE id=?").bind(id).first<ImportRow>();
  if (!row) throw new CatalogInputError("Импорт не найден.", 404);
  return row;
}
async function importManifest(env: CatalogEnv, id: string, user: CatalogUser) {
  const record = await getImport(env, id);
  if (record.created_by !== user.id) throw new CatalogInputError("Импорт открыт другим администратором.", 403);
  const batches = await env.DB.prepare("SELECT batch_index,offer_count,checksum FROM catalog_import_batches WHERE import_id=? ORDER BY batch_index")
    .bind(id).all<{ batch_index: number; offer_count: number; checksum: string }>();
  return { id, storageVersion: record.storage_version, contentHash: record.source_hash,
    status: record.status, receivedCount: record.received_count, expectedCount: record.expected_count,
    exportedAt: record.exported_at, environment: record.environment,
    batches: batches.results.map(batch => ({ index: batch.batch_index, offerCount: batch.offer_count, checksum: batch.checksum })) };
}
async function createImport(request: Request, env: CatalogEnv, user: CatalogUser) {
  const value = await body(request);
  if (value.schemaVersion !== 1 || value.sourceSystem !== "michael-cabinet"
    || !["test", "live", "unknown"].includes(String(value.environment)))
    throw new CatalogInputError("Этот файл не является экспортом каталога Michael версии 1.");
  const count = integer(value.offerCount, 1, 100000, "число предложений");
  if (typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))
    || Date.parse(value.exportedAt) > Date.now() + 300000) throw new CatalogInputError("Некорректная дата экспорта.");
  if (value.contentHash != null && (typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.contentHash)))
    throw new CatalogInputError("Некорректная контрольная сумма файла каталога.");
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO catalog_imports (id,source_system,exported_at,environment,expected_count,created_by,storage_version,source_hash) VALUES (?,?,?,?,?,?,2,?)")
    .bind(id, "michael-cabinet", new Date(value.exportedAt).toISOString(), value.environment, count, user.id, value.contentHash ?? null).run();
  return { id, storageVersion: 2 };
}
async function importBatch(request: Request, env: CatalogEnv, id: string, index: number, user: CatalogUser) {
  const record = await getImport(env, id);
  if (record.created_by !== user.id) throw new CatalogInputError("Импорт открыт другим администратором.", 403);
  integer(index, 0, 99999, "номер пакета");
  const value = await body(request);
  if (!Array.isArray(value.offers) || value.offers.length < 1 || value.offers.length > MAX_BATCH)
    throw new CatalogInputError("Пакет должен содержать от 1 до 100 предложений.");
  const offers = value.offers.map(offer => input(() => validateCatalogOffer(offer)));
  if (new Set(offers.map(offer => offer.id)).size !== offers.length) throw new CatalogInputError("В пакете повторяются ID предложений.");
  const serialized = JSON.stringify(offers);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  const checksum = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
  const existing = await env.DB.prepare("SELECT checksum FROM catalog_import_batches WHERE import_id=? AND batch_index=?").bind(id, index).first<{ checksum: string }>();
  if (existing) {
    if (existing.checksum !== checksum) throw new CatalogInputError("Пакет с этим номером уже содержит другие данные.", 409);
    return { receivedCount: record.received_count };
  }
  if (record.status !== "uploading") throw new CatalogInputError("Импорт уже завершён.", 409);
  if (record.received_count + offers.length > record.expected_count) throw new CatalogInputError("В импорте больше позиций, чем заявлено.");
  const rows = offers.map(offer => ({
    id: offer.id, productId: offer.productId,
    article: normalizeCatalogText(offer.article), code: normalizeCatalogText(offer.onecCode),
    search: normalizeCatalogText([offer.name, offer.article, offer.onecCode, offer.brand].join(" ")),
    type: offer.sourceType, payload: JSON.stringify(offer),
  }));
  const page = record.storage_version === 2 ? {
    search: rows.map(row => row.search).join("\n"),
    exact: JSON.stringify([...new Set(rows.flatMap(row => [row.article, row.code]).filter(Boolean))]),
    ids: JSON.stringify(offers.map(offer => offer.id)),
    products: JSON.stringify([...new Set(offers.map(offer => offer.productId))]),
  } : null;
  if (page && encoder.encode(serialized + page.search + page.exact + page.ids + page.products).length > MAX_PAGE_BYTES)
    throw new CatalogInputError("Слишком большой пакет каталога. Уменьшите число предложений в пакете.", 413);
  // A replayed/conflicting batch fails atomically before changing any catalog data.
  try {
    // Recheck capacity inside the transaction: other batches may have committed since getImport.
    const results = await env.DB.batch([
      env.DB.prepare("INSERT INTO catalog_import_batches (import_id,batch_index,checksum,offer_count) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM catalog_imports WHERE id=? AND status='uploading' AND received_count+?<=expected_count)")
        .bind(id, index, checksum, offers.length, id, offers.length),
      page ? env.DB.prepare("INSERT INTO catalog_pages (snapshot_id,batch_index,offer_count,payload_json,search_text,exact_keys,offer_keys,product_keys) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM catalog_imports WHERE id=? AND status='uploading' AND received_count+?<=expected_count)")
        .bind(id, index, offers.length, serialized, page.search, page.exact, page.ids, page.products, id, offers.length)
        : env.DB.prepare("INSERT INTO catalog_offers (snapshot_id,offer_id,product_id,article_key,onec_code_key,search_text,source_type,payload_json) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.productId'),json_extract(value,'$.article'),json_extract(value,'$.code'),json_extract(value,'$.search'),json_extract(value,'$.type'),json_extract(value,'$.payload') FROM json_each(?) WHERE EXISTS (SELECT 1 FROM catalog_imports WHERE id=? AND status='uploading' AND received_count+?<=expected_count)")
          .bind(id, JSON.stringify(rows), id, offers.length),
      env.DB.prepare("UPDATE catalog_imports SET received_count=received_count+? WHERE id=? AND status='uploading' AND received_count+?<=expected_count")
        .bind(offers.length, id, offers.length),
    ]);
    if (results[0].meta.changes !== 1)
      throw new CatalogInputError("Импорт уже завершён или получено больше позиций, чем заявлено.", 409);
  } catch (error) {
    const replay = await env.DB.prepare("SELECT checksum FROM catalog_import_batches WHERE import_id=? AND batch_index=?").bind(id, index).first<{ checksum: string }>();
    if (replay?.checksum === checksum) return { receivedCount: (await getImport(env, id)).received_count };
    if (replay) throw new CatalogInputError("Пакет с этим номером уже содержит другие данные.", 409);
    if (String(error).includes("UNIQUE constraint failed: catalog_offers"))
      throw new CatalogInputError("В нескольких пакетах повторяется ID предложения. Создайте новый экспорт каталога.", 409);
    throw error;
  }
  return { receivedCount: (await getImport(env, id)).received_count };
}
async function commitImport(env: CatalogEnv, id: string, user: CatalogUser) {
  const record = await getImport(env, id);
  if (record.created_by !== user.id) throw new CatalogInputError("Импорт открыт другим администратором.", 403);
  if (record.received_count !== record.expected_count) throw new CatalogInputError("Получен не весь каталог. Завершите загрузку пакетов.", 409);
  const active = await activeSnapshot(env);
  if (active && active.id !== id && Date.parse(active.exported_at) >= Date.parse(record.exported_at))
    throw new CatalogInputError("В кабинете уже используется такой же или более свежий экспорт.", 409);
  const completeness = record.storage_version === 2
    ? "expected_count=(SELECT COALESCE(SUM(offer_count),0) FROM catalog_pages WHERE snapshot_id=?) AND expected_count=(SELECT COUNT(DISTINCT j.value) FROM catalog_pages p,json_each(p.offer_keys) j WHERE p.snapshot_id=?)"
    : "expected_count=(SELECT COUNT(*) FROM catalog_offers WHERE snapshot_id=?)";
  await env.DB.batch([
    // Count once at activation, instead of scanning the growing catalog after every batch.
    env.DB.prepare("UPDATE catalog_imports SET status='complete' WHERE id=? AND received_count=expected_count AND " + completeness + " AND NOT EXISTS (SELECT 1 FROM catalog_state s JOIN catalog_imports i ON i.id=s.active_snapshot_id WHERE i.id<>? AND i.exported_at>=?)")
      .bind(id, id, ...(record.storage_version === 2 ? [id] : []), id, record.exported_at),
    env.DB.prepare("INSERT INTO catalog_state (id,active_snapshot_id) SELECT 1,id FROM catalog_imports WHERE id=? AND status='complete' AND NOT EXISTS (SELECT 1 FROM catalog_state s JOIN catalog_imports i ON i.id=s.active_snapshot_id WHERE i.id<>? AND i.exported_at>=?) ON CONFLICT(id) DO UPDATE SET active_snapshot_id=excluded.active_snapshot_id")
      .bind(id, id, record.exported_at),
  ]);
  const current = await activeSnapshot(env);
  if (current?.id !== id) throw new CatalogInputError("Каталог не активирован: проверьте полноту, повторяющиеся ID предложений или более свежий импорт.", 409);
  return { activeSnapshot: publicSnapshot(current) };
}
type PagePredicate = { sql: string; bindings: string[] };
type PageMetadata = { batch_index: number; payload_bytes: number };
/** Filter page metadata first; never pull an unbounded catalog into a Worker. */
async function pageOffers(env: CatalogEnv, snapshotId: string, predicates: PagePredicate[], maxPages: number, maxBytes: number) {
  const pages = new Map<number, PageMetadata>();
  let truncated = false;
  for (const predicate of predicates) {
    const metadata = await env.DB.prepare("SELECT batch_index,length(CAST(payload_json AS BLOB)) AS payload_bytes FROM catalog_pages WHERE snapshot_id=? AND (" + predicate.sql + ") ORDER BY batch_index LIMIT ?")
      .bind(snapshotId, ...predicate.bindings, maxPages + 1).all<PageMetadata>();
    if (metadata.results.length > maxPages) truncated = true;
    for (const row of metadata.results.slice(0, maxPages)) pages.set(row.batch_index, row);
  }
  const selected: number[] = [];
  let size = 0;
  for (const row of [...pages.values()].sort((a, b) => a.batch_index - b.batch_index)) {
    if (selected.length >= maxPages || size + row.payload_bytes > maxBytes) { truncated = true; continue; }
    size += row.payload_bytes; selected.push(row.batch_index);
  }
  const offers: CatalogOffer[] = [];
  for (let offset = 0; offset < selected.length; offset += 80) {
    const chunk = selected.slice(offset, offset + 80);
    const rows = await env.DB.prepare("SELECT payload_json FROM catalog_pages WHERE snapshot_id=? AND batch_index IN (" + chunk.map(() => "?").join(",") + ") ORDER BY batch_index")
      .bind(snapshotId, ...chunk).all<{ payload_json: string }>();
    for (const row of rows.results) offers.push(...JSON.parse(row.payload_json) as CatalogOffer[]);
  }
  return { offers, truncated };
}
function keyPredicates(column: "offer_keys" | "product_keys" | "exact_keys", keys: string[]): PagePredicate[] {
  const unique = [...new Set(keys)], predicates: PagePredicate[] = [];
  for (let offset = 0; offset < unique.length; offset += 40) {
    const chunk = unique.slice(offset, offset + 40);
    // Quoted JSON strings delimit keys; JS below still verifies the actual field.
    predicates.push({ sql: chunk.map(() => "instr(" + column + ",?)>0").join(" OR "), bindings: chunk.map(key => JSON.stringify(key)) });
  }
  return predicates;
}
async function offersByIds(env: CatalogEnv, snapshot: ImportRow, ids: string[]): Promise<CatalogOffer[]> {
  if (snapshot.storage_version === 2) {
    const wanted = new Set(ids);
    const read = await pageOffers(env, snapshot.id, keyPredicates("offer_keys", ids), MAX_LOOKUP_PAGES, MAX_LOOKUP_BYTES);
    if (read.truncated) throw new CatalogInputError("Подбор затрагивает слишком большой объём каталога. Разделите заявку.", 413);
    return read.offers.filter(offer => wanted.has(offer.id));
  }
  const result: CatalogOffer[] = [];
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += 80) {
    const chunk = unique.slice(offset, offset + 80);
    const rows = await env.DB.prepare("SELECT payload_json FROM catalog_offers WHERE snapshot_id=? AND offer_id IN (" + chunk.map(() => "?").join(",") + ")")
      .bind(snapshot.id, ...chunk).all<{ payload_json: string }>();
    result.push(...rows.results.map(row => JSON.parse(row.payload_json) as CatalogOffer));
  }
  return result;
}
// Each successfully activated immutable snapshot is a durable observation. Read only
// the same source offer; names, product links and fuzzy matches are not identities.
async function priceHistory(env: CatalogEnv, offerId: string, before: string | null) {
  if (!offerId || offerId.length > 6000) throw new CatalogInputError("Укажите предложение товара.");
  const active = await activeSnapshot(env);
  if (!active) throw new CatalogInputError("Каталог ещё не загружен.", 409);
  const current = (await offersByIds(env, active, [offerId]))[0];
  if (!current) throw new CatalogInputError("Предложение не найдено в текущем каталоге.", 404);
  if (before && (!UUID.test(before) || !(await env.DB.prepare("SELECT id FROM catalog_imports WHERE id=? AND status='complete' AND exported_at<=?").bind(before, active.exported_at).first())))
    throw new CatalogInputError("Неверная страница истории.", 400);
  const rows = await env.DB.prepare("SELECT * FROM catalog_imports WHERE status='complete' AND exported_at<=? AND (? IS NULL OR exported_at < (SELECT exported_at FROM catalog_imports WHERE id=?)) ORDER BY exported_at DESC LIMIT 11")
    .bind(active.exported_at, before, before).all<ImportRow>();
  const chosen = rows.results.slice(0, 10);
  const points: { snapshotAt: string; sourceUpdatedAt: string | null; price: CatalogOffer['prices']['purchase']; unit: string }[] = [];
  for (const snapshot of chosen) {
    const old = (await offersByIds(env, snapshot, [offerId]))[0];
    if (old && old.sourceId === current.sourceId && old.sourceType === current.sourceType)
      points.push({ snapshotAt: snapshot.exported_at, sourceUpdatedAt: old.prices.purchase?.updatedAt || old.updatedAt, price: old.prices.purchase, unit: old.unit });
  }
  return { sourceName: current.sourceName, points, nextBefore: rows.results.length > 10 ? chosen[chosen.length - 1].id : null };
}
async function offersByProducts(env: CatalogEnv, snapshot: ImportRow, products: string[], forSearch = false) {
  if (snapshot.storage_version === 2) {
    const wanted = new Set(products);
    const read = await pageOffers(env, snapshot.id, keyPredicates("product_keys", products),
      forSearch ? MAX_SEARCH_PAGES : MAX_LOOKUP_PAGES, forSearch ? MAX_SEARCH_BYTES : MAX_LOOKUP_BYTES);
    if (read.truncated && !forSearch) throw new CatalogInputError("Подбор затрагивает слишком большой объём связанных товаров. Разделите заявку.", 413);
    return { offers: read.offers.filter(offer => wanted.has(offer.productId)), truncated: read.truncated };
  }
  const offers: CatalogOffer[] = [];
  let truncated = false;
  for (let offset = 0; offset < products.length; offset += 80) {
    const group = products.slice(offset, offset + 80);
    const linked = await env.DB.prepare("SELECT payload_json FROM catalog_offers WHERE snapshot_id=? AND product_id IN (" + group.map(() => "?").join(",") + ") LIMIT 1001")
      .bind(snapshot.id, ...group).all<{ payload_json: string }>();
    if (linked.results.length > 1000) truncated = true;
    offers.push(...linked.results.slice(0, 1000).map(row => JSON.parse(row.payload_json) as CatalogOffer));
  }
  if (truncated && !forSearch) throw new CatalogInputError("В подборе слишком много связанных предложений. Разделите заявку.", 413);
  return { offers, truncated };
}
async function evaluate(env: CatalogEnv, value: Record<string, unknown>) {
  const active = await requireActive(env, value.catalogSnapshotId);
  const draft = input(() => validateQuoteDraft(value.draft));
  const ids = draft.lines.flatMap(line => line.allocations.map(item => item.offerId));
  if (ids.length > 1000) throw new CatalogInputError("В одном подборе допускается до 1000 распределений.");
  const offers = await offersByIds(env, active, ids);
  const products = [...new Set(offers.map(offer => offer.productId))];
  const known = new Set(offers.map(offer => offer.id));
  // Include identity anchors for allocations found through confirmed cross-source links.
  const linked = await offersByProducts(env, active, products);
  for (const offer of linked.offers) {
    if (!known.has(offer.id)) { offers.push(offer); known.add(offer.id); }
  }
  return { draft, evaluation: input(() => evaluateQuote(draft, offers, { now: new Date(), environment: active.environment })), catalogSnapshotId: active.id };
}
async function findCandidates(env: CatalogEnv, value: Record<string, unknown>) {
  const active = await activeSnapshot(env);
  if (!active) throw new CatalogInputError("Сначала импортируйте каталог.", 409);
  if (value.catalogSnapshotId != null && value.catalogSnapshotId !== active.id)
    throw new CatalogInputError("Каталог обновлён. Обновите подбор.", 409);
  const draft = input(() => validateQuoteDraft({ lines: [value.line] }));
  const line = draft.lines[0];
  const query = normalizeCatalogText(line.query);
  const article = normalizeCatalogText(line.article || line.query);
  const terms = [...new Set(query.split(/\s+/).filter(t => t.length > 1))].slice(0, 8).map(term => {
    if (active.storage_version === 2) return term;
    // D1 LIKE patterns have a 50-byte limit, including wildcard characters.
    while (new TextEncoder().encode(term).length > 40) term = term.slice(0, -1);
    return term;
  });
  if (!query || (terms.length === 0 && !article)) throw new CatalogInputError("Введите артикул или название товара.");
  let offers: CatalogOffer[], searchTruncated = false;
  if (active.storage_version === 2) {
    const exact = await pageOffers(env, active.id, keyPredicates("exact_keys", article ? [article] : []), MAX_SEARCH_PAGES, MAX_SEARCH_BYTES);
    offers = exact.offers.filter(offer => normalizeCatalogText(offer.article) === article || normalizeCatalogText(offer.onecCode) === article);
    searchTruncated ||= exact.truncated;
    if (terms.length) {
      const text = await pageOffers(env, active.id, [{ sql: terms.map(() => "instr(search_text,?)>0").join(" AND "), bindings: terms }], MAX_SEARCH_PAGES, MAX_SEARCH_BYTES);
      const known = new Set(offers.map(offer => offer.id));
      for (const offer of text.offers) {
        // A page can match different terms in different offers. Never return such
        // a cross-match without checking all terms against this particular offer.
        const search = normalizeCatalogText([offer.name, offer.article, offer.onecCode, offer.brand].join(" "));
        if (!known.has(offer.id) && terms.every(term => search.includes(term))) { offers.push(offer); known.add(offer.id); }
      }
      searchTruncated ||= text.truncated;
    }
  } else {
    const conditions: string[] = [];
    const bindings: (string | number)[] = [active.id];
    if (article) { conditions.push("article_key=? OR onec_code_key=?"); bindings.push(article, article); }
    if (terms.length) {
      conditions.push("(" + terms.map(() => "search_text LIKE ? ESCAPE '\\'").join(" AND ") + ")");
      bindings.push(...terms.map(t => "%" + t.replace(/[\\%_]/g, c => "\\" + c) + "%"));
    }
    const rows = await env.DB.prepare("SELECT payload_json FROM catalog_offers WHERE snapshot_id=? AND (" + conditions.join(" OR ") + ") ORDER BY CASE WHEN article_key=? OR onec_code_key=? THEN 0 WHEN source_type='warehouse' THEN 1 ELSE 2 END LIMIT 201")
      .bind(...bindings, article, article).all<{ payload_json: string }>();
    searchTruncated = rows.results.length > 200;
    offers = rows.results.slice(0, 200).map(row => JSON.parse(row.payload_json) as CatalogOffer);
  }
  const context = { now: new Date(), environment: active.environment };
  const direct = input(() => rankOffers(line, offers, context));
  const productIds = [...new Set(direct.filter(item => item.matchKind !== "similar").map(item => item.offer.productId))].slice(0, 30);
  if (productIds.length) {
    // The exporter assigns shared IDs only to confirmed source links, never fuzzy matches.
    const linked = await offersByProducts(env, active, productIds, true);
    searchTruncated ||= linked.truncated;
    const known = new Set(offers.map(offer => offer.id));
    for (const offer of linked.offers) {
      if (!known.has(offer.id)) { offers.push(offer); known.add(offer.id); }
    }
  }
  const ranked = input(() => rankOffers(line, offers, context));
  return { candidates: ranked.slice(0, 30), catalogSnapshotId: active.id, searchTruncated: searchTruncated || ranked.length > 30 };
}
async function readQuote(env: CatalogEnv, requestId: number, user: CatalogUser) {
  const scope = requestScope(user);
  const saved = await env.DB.prepare("SELECT q.* FROM request_quotations q WHERE q.request_id=? AND EXISTS(SELECT 1 FROM requests r WHERE r.id=q.request_id AND " + scope.sql + ")")
    .bind(requestId, ...scope.bindings).first<SavedQuote>();
  if (!saved && !await hasRequestAccess(env, user, requestId)) throw new CatalogInputError("Заявка не найдена.", 404);
  const active = await activeSnapshot(env);
  const evaluation = saved ? JSON.parse(saved.evaluation_json) : null;
  const evaluationOutdated = Boolean(saved && (Date.now() - Date.parse(saved.updated_at) > 15 * 60 * 1000
    || saved.catalog_snapshot_id !== active?.id
    || evaluation?.lines?.some((line: { allocations: { offer: CatalogOffer | null; deliveryDate: string | null }[] }) =>
      line.allocations.some(item => item.offer && nextDeliveryDate(item.offer.delivery) !== item.deliveryDate))));
  return {
    revision: saved?.revision || 0,
    draft: saved ? JSON.parse(saved.draft_json) as QuoteDraft : { lines: [], notes: "" },
    evaluation, evaluationOutdated,
    catalogSnapshotId: saved?.catalog_snapshot_id || active?.id || null,
    activeCatalogSnapshotId: active?.id || null,
    catalogOutdated: Boolean(saved && saved.catalog_snapshot_id !== active?.id),
    updatedAt: saved?.updated_at || null,
  };
}
async function saveQuote(request: Request, env: CatalogEnv, requestId: number, user: CatalogUser) {
  const scope = requestScope(user);
  const value = await body(request);
  const revision = integer(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1, "версия подбора");
  const calculated = await evaluate(env, value);
  const token = crypto.randomUUID(), now = new Date().toISOString();
  const draftJson = JSON.stringify(calculated.draft), evaluationJson = JSON.stringify(calculated.evaluation);
  if (new TextEncoder().encode(draftJson + evaluationJson).length > 1800000)
    throw new CatalogInputError("Подбор слишком велик для одной заявки. Разделите его на несколько заявок.", 413);
  const result = await env.DB.batch([
    env.DB.prepare("INSERT INTO request_quotations (request_id,revision,catalog_snapshot_id,draft_json,evaluation_json,write_token,updated_by,updated_at) SELECT ?,1,?,?,?,?,?,? WHERE (?=0 OR EXISTS(SELECT 1 FROM request_quotations WHERE request_id=?)) AND EXISTS(SELECT 1 FROM catalog_state WHERE id=1 AND active_snapshot_id=?) AND EXISTS(SELECT 1 FROM requests r WHERE r.id=? AND " + scope.sql + ") ON CONFLICT(request_id) DO UPDATE SET revision=request_quotations.revision+1,catalog_snapshot_id=excluded.catalog_snapshot_id,draft_json=excluded.draft_json,evaluation_json=excluded.evaluation_json,write_token=excluded.write_token,updated_by=excluded.updated_by,updated_at=excluded.updated_at WHERE request_quotations.revision=? AND EXISTS(SELECT 1 FROM requests r WHERE r.id=? AND " + scope.sql + ") RETURNING revision")
      .bind(requestId, calculated.catalogSnapshotId, draftJson, evaluationJson, token, user.id, now, revision, requestId, calculated.catalogSnapshotId, requestId, ...scope.bindings, revision, requestId, ...scope.bindings),
    env.DB.prepare("INSERT INTO request_events (request_id,event_type,actor,payload_json) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM request_quotations WHERE request_id=? AND write_token=?)")
      .bind(requestId, "quotation_saved", user.username, JSON.stringify({ revision: revision + 1, catalogSnapshotId: calculated.catalogSnapshotId, lineCount: calculated.draft.lines.length }), requestId, token),
  ]);
  if (!result[0].results.length) {
    if (!await hasRequestAccess(env, user, requestId)) throw new CatalogInputError("Заявка не найдена.", 404);
    await requireActive(env, calculated.catalogSnapshotId);
    throw new CatalogInputError("Подбор уже изменён другим сотрудником. Загрузите сохранённую версию.", 409);
  }
  return { revision: revision + 1, ...calculated, updatedAt: now };
}

/** Called only after the existing session authentication. Does not call AI or write to 1C. */
export async function handleCatalogRoutes(request: Request, env: CatalogEnv, user: CatalogUser): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (!(path === "/api/catalog/status" || path === "/api/catalog/search" || path === "/api/catalog/price-history" || path.startsWith("/api/catalog/imports")
    || /^\/api\/requests\/\d+\/quotation(?:\/|$)/.test(path))) return null;
  try {
    if (!["admin", "manager", "accountant", "viewer"].includes(user.role)) throw new CatalogInputError("Недостаточно прав.", 403);
    if (request.method !== "GET" && request.headers.get("Origin") !== url.origin)
      throw new CatalogInputError("Откройте программу на её основном адресе.", 403);
    if (path === "/api/catalog/status" && request.method === "GET")
      return json({ activeSnapshot: publicSnapshot(await activeSnapshot(env)) });
    if (path === "/api/catalog/price-history" && request.method === "GET")
      return json(await priceHistory(env, url.searchParams.get("offerId") || "", url.searchParams.get("before")));
    if (path === "/api/catalog/search" && request.method === "GET") {
      const query = (url.searchParams.get("q") || "").trim();
      const article = (url.searchParams.get("article") || "").trim();
      const brand = (url.searchParams.get("brand") || "").trim();
      if ([query, article, brand].some(value => value.length > 300)) throw new CatalogInputError("Поисковая строка слишком длинная.");
      return json(await findCandidates(env, { line: { id: "catalog-search", query: query || article, article, brand, quantity: 1, unit: null, allocations: [] } }));
    }
    if (path.startsWith("/api/catalog/imports")) {
      if (user.role !== "admin") throw new CatalogInputError("Импорт каталога доступен администратору.", 403);
      if (path === "/api/catalog/imports" && request.method === "POST") return json(await createImport(request, env, user), 201);
      const manifest = path.match(/^\/api\/catalog\/imports\/([^/]+)$/);
      if (manifest && request.method === "GET") return json(await importManifest(env, manifest[1], user));
      const batch = path.match(/^\/api\/catalog\/imports\/([^/]+)\/batches\/(\d+)$/);
      if (batch && request.method === "PUT") return json(await importBatch(request, env, batch[1], Number(batch[2]), user));
      const commit = path.match(/^\/api\/catalog\/imports\/([^/]+)\/commit$/);
      if (commit && request.method === "POST") return json(await commitImport(env, commit[1], user));
      throw new CatalogInputError("Метод импорта не найден.", 404);
    }
    const match = path.match(/^\/api\/requests\/(\d+)\/quotation(?:\/(prepare|candidates|evaluate))?$/);
    if (!match) throw new CatalogInputError("Метод подбора не найден.", 404);
    const requestId = Number(match[1]);
    if (!await hasRequestAccess(env, user, requestId)) throw new CatalogInputError("Заявка не найдена.", 404);
    const scope = requestScope(user);
    const existing = await env.DB.prepare("SELECT r.id,r.original_text,r.source_type FROM requests r WHERE r.id=? AND " + scope.sql).bind(requestId, ...scope.bindings).first<{ id: number; original_text: string; source_type: string }>();
    if (!existing) throw new CatalogInputError("Заявка не найдена.", 404);
    const action = match[2];
    if (!action && request.method === "GET") return json(await readQuote(env, requestId, user));
    if (!["admin", "manager"].includes(user.role)) throw new CatalogInputError("Изменять подбор может администратор или менеджер.", 403);
    if (!action && request.method === "PUT") return json(await saveQuote(request, env, requestId, user));
    if (action === "prepare" && request.method === "POST")
      return json({ draft: { lines: input(() => parseRequestLines(existing.original_text, { legacyContext: existing.source_type === "text" })), notes: "" }, catalogSnapshotId: (await activeSnapshot(env))?.id || null });
    if (action === "candidates" && request.method === "POST") return json(await findCandidates(env, await body(request)));
    if (action === "evaluate" && request.method === "POST") return json(await evaluate(env, await body(request)));
    throw new CatalogInputError("Недопустимый метод.", 405);
  } catch (error) {
    if (error instanceof CatalogInputError) return json({ detail: error.message }, error.status);
    throw error;
  }
}
