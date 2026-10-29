// Mirrored in sales-ai-manager/catalog-bridge/export.mjs. Keep both copies identical.
// This is a whitelist export of a local snapshot, never a request to 1C or a supplier.
const ONEC = 'warehouse:onec-nkt';
const CT1 = 'supplier:svetotehnika-1';
const VOLT220 = 'supplier:220volt';
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WAREHOUSE_KEY = '1fa50cd4-9962-11e7-9a36-4c72b98ae351';
const PRICE_KEYS = {purchase:'c5b7c90b-9e90-11e7-9a37-4c72b98ae351',wholesale:'c5b7c90e-9e90-11e7-9a37-4c72b98ae351',retail:'c5b7c90d-9e90-11e7-9a37-4c72b98ae351'};
const own = (value, key) => value != null && Object.hasOwn(value, key);
function text(value, limit = 5000) {
  if (typeof value !== 'string') return '';
  const result = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/gu, ' ').trim();
  if (result.length > limit) throw new Error('Поле каталога превышает допустимую длину. Экспорт отменён.');
  return result;
}
function identifier(value, limit = 6000) {
  if (typeof value !== 'string' || !value || value.length > limit || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Некорректный идентификатор товара или источника. Экспорт отменён.');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const result = new Date(value);
  return Number.isFinite(result.getTime()) ? result.toISOString() : null;
}
function number(value) { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : null; }
function baseUnit(product) {
  const clean = value => { const result = text(value, 100); return /^(?:не указано?|неизвестно|нет|—|-)$/iu.test(result) ? '' : result; };
  // An explicit manual edit, including clearing the field, always wins.
  if (own(product.detailsOverrides, 'baseUnit')) return clean(product.detailsOverrides.baseUnit);
  const primary = clean(product.details?.baseUnit);
  if (primary) return primary;
  // Some supplier pages provide the base unit only as a named characteristic.
  // Read that explicit field; never infer a unit from the name or packaging count.
  const attributes = own(product.detailsOverrides, 'attributes') ? product.detailsOverrides.attributes : product.details?.attributes;
  const values = (Array.isArray(attributes) ? attributes : [])
    .filter(attribute => /^базовая единица:?$/iu.test(text(attribute?.name, 500)))
    .map(attribute => clean(attribute.value)).filter(Boolean);
  return values.length && new Set(values.map(canonicalUnit)).size === 1 ? values[0] : '';
}
function canonicalUnit(value) {
  const unit = value.toLocaleLowerCase('ru').replace(/\.$/u, '');
  const aliases = [['шт','штука','штуки','штук','pcs','pc','piece'],['м','метр','метра','метров','m'],['кг','килограмм','kg'],['уп','упак','упаковка','упаковки','pack'],['компл','комплект','комплекта'],['рулон','рул'],['л','литр','литра'],['пара','пар']];
  return aliases.find(group => group.includes(unit))?.[0] || unit;
}
function brand(product) {
  const clean = value => { const result = text(value, 256); return GUID.test(result) ? '' : /^sirius$/i.test(result) ? 'Sirius' : result; };
  const attributes = product.detailsOverrides?.attributes || product.details?.attributes || [];
  const names = [...new Set((Array.isArray(attributes) ? attributes : []).filter(a => /^(бренд|производитель|brand|manufacturer)$/iu.test(String(a?.name || '').trim())).map(a => clean(a.value)).filter(Boolean))];
  const explicit = clean(product.brand) || (names.length === 1 ? names[0] : '');
  if (explicit) return explicit;
  if (/(?:^|[^\p{L}\p{N}])sirius(?=$|[^\p{L}\p{N}])/iu.test(product.name || '') || (product.sourceId === CT1 && product.categoryPath?.[0]?.name === '00 Sirius')) return 'Sirius';
  return '';
}
function article(product) {
  if (product.sourceId === ONEC) return text(product.onecArticle, 512);
  const sku = text(product.sku, 5000);
  // Earlier XLS imports used the complete name as a synthetic SKU. It is not an article.
  if (product.sourceId === CT1 && (sku === text(product.name) || sku === text(product.externalId))) return '';
  if (['supplier:azerti', 'supplier:elco', 'supplier:vint', 'supplier:comportal'].includes(product.sourceId) && sku === String(product.externalId || '')) return '';
  return text(sku, 512);
}
function observation(product, supplier) {
  return timestamp(product.sourceId === ONEC ? product.onecStock?.fetchedAt || product.onecFetchedAt : product.sourceUpdatedAt || supplier?.lastImport || product.updatedAt);
}
function stockProof(product) {
  const meta = product.onecStock;
  return product.sourceId === ONEC && product.sourceType === 'warehouse' &&
    GUID.test(product.externalId || '') && product.externalId !== ZERO_GUID && product.id === encodeURIComponent(ONEC) + ':' + product.externalId &&
    product.onecListed === true && product.stale !== true && number(product.stock) !== null && product.available === (product.stock > 0) &&
    meta?.warehouseKey === WAREHOUSE_KEY && meta.warehouseName === 'Экибастуз' &&
    typeof meta.period === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(meta.period) &&
    typeof meta.timeZoneId === 'string' && !!meta.timeZoneId &&
    !!timestamp(meta.fetchedAt) && timestamp(meta.fetchedAt) === timestamp(product.onecFetchedAt);
}
function money(amount, currency, updatedAt, vatIncluded = null, vatRate = null) {
  if (typeof amount === 'number' && Number.isFinite(amount) && amount > 1e9) throw new Error('Цена превышает допустимый предел AI-менеджера. Проверьте исходные цены.');
  if (number(amount) === null || amount <= 0 || !/^[A-Z]{3}$/.test(currency || '')) return null;
  return {amount, currency, vatIncluded, vatRate, updatedAt};
}
function onecMoney(product, slot, updatedAt) {
  const meta = product.onecPricing, column = meta?.columns?.find(c => c.slot === slot);
  if (!stockProof(product) || meta?.complete !== true || meta.register !== 'ЦеныНоменклатуры' ||
      meta.entitySet !== 'InformationRegister_ЦеныНоменклатуры_RecordType' || meta.currency !== 'KZT' ||
      meta.currencyKey !== 'bedb6964-9780-11e7-9a35-4c72b98ae351' ||
      meta.period !== product.onecStock.period || meta.timeZoneId !== product.onecStock.timeZoneId ||
      timestamp(meta.fetchedAt) !== updatedAt || column?.includesVat !== true || column.refKey !== PRICE_KEYS[slot] ||
      !Array.isArray(product.onecPrices)) return null;
  const quotes = product.onecPrices.filter(q => q.slot === slot);
  // A characteristic/packaging price cannot be silently interpreted as a base-unit price.
  if (quotes.length !== 1 || quotes[0].characteristicKey !== ZERO_GUID || quotes[0].packagingKey !== ZERO_GUID || quotes[0].packagingName !== null ||
      typeof quotes[0].period !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(quotes[0].period) || quotes[0].period > meta.period) return null;
  return money(quotes[0].amount, 'KZT', updatedAt, true, null);
}
function delivery(product, confirmed) {
  const common = {timezone:'Asia/Almaty', windows:[], shippingCost:null};
  if (product.sourceType === 'warehouse') return {...common, type:confirmed ? 'stock' : 'unknown', notes:confirmed ? 'Физический остаток склада; резерв и доставка клиенту не учтены.' : 'Остаток склада не подтверждён.'};
  if (product.sourceId === CT1) return {...common, type:'weekly', windows:[{deliveryWeekday:3,cutoffWeekday:5,cutoffTime:'15:00'}], shippingCost:0, notes:'Бесплатно по средам в Экибастуз. Заказ до 15:00 предыдущей пятницы.'};
  if (product.sourceId === VOLT220) return {...common, type:'unknown', shippingCost:0, notes:'Бесплатно по понедельникам в Экибастуз. Крайний срок заказа не подтверждён; дату поставки нужно уточнить.'};
  return {...common, type:'unknown', notes:'Условия и срок поставки нужно уточнить у поставщика.'};
}
function canonicalIds(products, links) {
  const index = new Map(products.map(p => [p.id, p])), result = new Map();
  for (const link of Array.isArray(links) ? links : []) {
    if (link?.confirmed !== true || link.unitConfirmed !== true) continue;
    const warehouse = index.get(link.ownId), offer = index.get(link.offerId);
    if (!warehouse || !offer || warehouse.sourceId !== ONEC || warehouse.sourceType !== 'warehouse' || offer.sourceType !== 'supplier') continue;
    const warehouseUnit = canonicalUnit(baseUnit(warehouse)), offerUnit = canonicalUnit(baseUnit(offer));
    // A later manual unit edit can invalidate an earlier confirmation.
    if (warehouseUnit && offerUnit && warehouseUnit !== offerUnit) continue;
    if (result.has(offer.id) && result.get(offer.id) !== warehouse.id) throw new Error('У товара есть противоречивые подтверждённые связи. Проверьте раздел «Связи товаров».');
    result.set(offer.id, warehouse.id);
  }
  return result;
}

/** Build from the saved Cabinet state, including manual edits/confirmed unit mappings.
 * No input object is mutated. Credentials, settings, leads, images and raw payloads
 * are not copied. Unknown prices/units/taxes remain unknown. The nkt source is test.
 */
export function buildAiCatalogSnapshot(state, options = {}) {
  if (!state || !Array.isArray(state.products) || state.products.length > 100000) throw new Error('Не удалось прочитать каталог для экспорта.');
  const exportedAt = timestamp(options.exportedAt || new Date().toISOString());
  if (!exportedAt) throw new Error('Некорректное время экспорта.');
  const suppliers = new Map((state.suppliers || []).map(s => [s.id, s]));
  const products = state.products.filter(p => p && ['supplier','warehouse'].includes(p.sourceType) && !(p.sourceType === 'supplier' && suppliers.get(p.sourceId)?.deletedAt));
  const seen = new Set();
  for (const product of products) {
    identifier(product.id); identifier(product.sourceId, 160);
    if (seen.has(product.id)) throw new Error('Повтор идентификатора товара. Экспорт отменён.');
    seen.add(product.id);
  }
  const canonical = canonicalIds(products, state.matching?.links);
  const offers = products.map(product => {
    const supplier = suppliers.get(product.sourceId), updatedAt = observation(product, supplier);
    const isOnec = product.sourceId === ONEC, validOwnStock = isOnec && stockProof(product);
    const obsolete = product.stale === true || (isOnec && !validOwnStock);
    if (!obsolete && typeof product.stock === 'number' && Number.isFinite(product.stock) && product.stock > 1e6) throw new Error('Остаток превышает допустимый предел AI-менеджера. Проверьте исходное количество и единицу.');
    const stock = obsolete || (product.sourceType === 'supplier' && number(product.stock) < 0) ? null : number(product.stock);
    const quantity = stock === null ? null : Math.max(0, stock);
    const stockConfirmed = !obsolete && !!updatedAt && (isOnec ? validOwnStock : product.sourceType === 'supplier' && quantity !== null);
    const included = [CT1, VOLT220].includes(product.sourceId) ? true : null;
    const sourcePurchase = money(product.supplierPurchasePrice, product.currency, updatedAt, included);
    const manualRetail = product.retailPrice != null ? money(product.retailPrice, product.currency, timestamp(product.updatedAt)) : null;
    const name = text(product.name);
    if (!name) throw new Error('В каталоге есть товар без названия. Экспорт отменён.');
    return {
      id:product.id, productId:canonical.get(product.id) || product.id, name,
      article:article(product), brand:brand(product), onecCode:isOnec ? text(product.sku, 1000) : '', unit:baseUnit(product),
      sourceId:product.sourceId, sourceName:text(supplier?.name || product.sourceName, 500) || product.sourceId, sourceType:product.sourceType,
      warehouseName:product.sourceType === 'warehouse' ? (isOnec ? 'Экибастуз' : text(product.warehouseName, 500)) : '',
      quantity, available:obsolete ? null : quantity !== null ? quantity > 0 : typeof product.available === 'boolean' ? product.available : null,
      stockConfirmed, updatedAt,
      prices:{purchase:isOnec ? onecMoney(product, 'purchase', updatedAt) : sourcePurchase,
        wholesale:isOnec ? onecMoney(product, 'wholesale', updatedAt) : null,
        retail:product.retailPrice != null ? manualRetail : isOnec ? onecMoney(product, 'retail', updatedAt) : money(product.price, product.currency, updatedAt)},
      delivery:delivery(product, stockConfirmed),
    };
  });
  // This installation uses the nkt test database; it cannot be relabelled live.
  const environment = products.some(p => p.sourceId === ONEC) ? 'test' : ['test','live','unknown'].includes(options.environment) ? options.environment : 'test';
  return {schemaVersion:1,sourceSystem:'michael-cabinet',exportedAt,environment,offers};
}
