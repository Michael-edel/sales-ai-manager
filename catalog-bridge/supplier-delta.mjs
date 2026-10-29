// Pure planning only: no network, disk writes or credentials. The cloud baseline
// must be the exact active snapshot; callers must CAS-check its identity on commit.
function index(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.sourceSystem !== 'michael-cabinet' || !Array.isArray(snapshot.offers)) throw new Error('Некорректный снимок каталога.');
  const map = new Map();
  for (const offer of snapshot.offers) {
    if (!offer || typeof offer.id !== 'string' || !offer.id || typeof offer.sourceId !== 'string' || !offer.sourceId || !['supplier', 'warehouse'].includes(offer.sourceType)) throw new Error('Некорректная идентичность предложения.');
    if (map.has(offer.id)) throw new Error('Повтор ID предложения.');
    map.set(offer.id, offer);
  }
  return map;
}
function stamp(value) { const n = Date.parse(value || ''); return Number.isFinite(n) ? n : null; }
function moneyKey(value) { return value == null ? null : [value.amount, value.currency, value.vatIncluded, value.vatRate]; }
function observed(offer) {
  return {quantity:offer.quantity, available:offer.available, stockConfirmed:offer.stockConfirmed, updatedAt:offer.updatedAt,
    prices:{purchase:offer.prices?.purchase ?? null, wholesale:offer.prices?.wholesale ?? null, retail:offer.prices?.retail ?? null}};
}
function contentKey(value) {
  return JSON.stringify([value.quantity,value.available,value.stockConfirmed,...['purchase','wholesale','retail'].map(slot=>moneyKey(value.prices[slot]))]);
}
/** Supplier prices and stocks only; absent/new/older records are reported, never
 * silently removed or created. A full sync caller must also validate file/source
 * completeness before deciding what to do with absent records. */
export function planSupplierDelta(baseline, next) {
  const old = index(baseline), latest = index(next);
  const changes = [], older = [], missing = [], added = [];
  for (const [id, prior] of old) {
    if (prior.sourceType !== 'supplier') continue;
    const current = latest.get(id);
    if (!current) { missing.push({id,sourceId:prior.sourceId}); continue; }
    if (current.sourceType !== 'supplier' || current.sourceId !== prior.sourceId) throw new Error('Источник существующего предложения изменился.');
    const a=observed(prior), b=observed(current);
    if (contentKey(a) === contentKey(b)) continue;
    const previous=stamp(a.updatedAt), now=stamp(b.updatedAt);
    if (previous !== null && (now === null || now < previous)) { older.push({id,sourceId:prior.sourceId}); continue; }
    for (const slot of ['purchase','wholesale','retail']) {
      const was=stamp(a.prices[slot]?.updatedAt), is=stamp(b.prices[slot]?.updatedAt);
      if (was !== null && b.prices[slot] && (is === null || is < was)) throw new Error('Дата цены источника стала старше.');
    }
    changes.push({id,sourceId:prior.sourceId,...b});
  }
  for (const [id,current] of latest) if (current.sourceType === 'supplier' && !old.has(id)) added.push({id,sourceId:current.sourceId});
  return {changes,older,missing,added};
}
