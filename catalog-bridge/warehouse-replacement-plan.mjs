// Offline preparation only: this module never reads the database or publishes.
// An incomplete or ambiguous replacement fails closed; supplier offers are preserved.
const TEST_SOURCE = 'warehouse:onec-nkt';
const LIVE_SOURCE = 'warehouse:onec-work-torg2026';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function ref(offer, source) {
  const prefix = `${encodeURIComponent(source)}:`;
  if (typeof offer?.id !== 'string' || !offer.id.startsWith(prefix)) throw new Error('Недопустимый идентификатор товара склада.');
  const value = offer.id.slice(prefix.length).toLowerCase();
  if (!uuid.test(value)) throw new Error('Не подтверждён идентификатор 1С.');
  return value;
}

export function prepareWarehouseReplacement(baseline, live, manifest) {
  if (!baseline || baseline.sourceSystem !== 'michael-cabinet' || baseline.schemaVersion !== 1 || !Array.isArray(baseline.offers)) throw new Error('Некорректный исходный каталог.');
  if (!live || live.sourceSystem !== 'michael-cabinet' || live.schemaVersion !== 1 || live.environment !== 'live' || !Array.isArray(live.offers)) throw new Error('Некорректная выгрузка рабочей базы.');
  if (!manifest || manifest.database !== 'Torg2026' || manifest.warehouse !== 'Экибастуз' || manifest.complete !== true || !uuid.test(manifest.baseSnapshotId || '') || !Number.isSafeInteger(manifest.count) || manifest.count <= 0 || manifest.count !== live.offers.length) throw new Error('Полнота рабочей выгрузки или исходный каталог не подтверждены.');
  if (!Number.isFinite(Date.parse(live.exportedAt))) throw new Error('Не указано время выгрузки.');
  const ids = new Set(), liveByRef = new Map();
  for (const offer of live.offers) {
    if (offer.sourceType !== 'warehouse' || offer.sourceId !== LIVE_SOURCE || offer.warehouseName !== 'Экибастуз' || offer.productId !== offer.id || !offer.name || !offer.onecCode) throw new Error('Некорректный товар рабочего склада.');
    const key = ref(offer, LIVE_SOURCE);
    if (ids.has(offer.id) || liveByRef.has(key)) throw new Error('Повтор рабочего товара.');
    ids.add(offer.id); liveByRef.set(key, offer);
  }
  const old = new Map(), sourceIds = new Set();
  for (const offer of baseline.offers) {
    if (!offer || typeof offer.id !== 'string' || sourceIds.has(offer.id)) throw new Error('Повтор или отсутствие идентификатора исходного товара.');
    sourceIds.add(offer.id);
    if (offer.sourceType === 'warehouse' && offer.sourceId === TEST_SOURCE) old.set(offer.id, ref(offer, TEST_SOURCE));
    else if (offer.sourceType === 'warehouse') throw new Error('Найден неизвестный склад: автоматическая замена остановлена.');
    else if (offer.sourceType !== 'supplier') throw new Error('Неизвестный источник товара.');
  }
  if (!old.size) throw new Error('Тестовый склад в исходном каталоге не найден.');
  const suppliers = baseline.offers.filter(o => o.sourceType === 'supplier').map(offer => {
    if (ids.has(offer.id)) throw new Error('Совпали идентификаторы поставщика и склада.');
    if (!old.has(offer.productId)) return {...offer};
    const matched = liveByRef.get(old.get(offer.productId));
    if (!matched) throw new Error('Подтверждённая связь поставщика не найдена в рабочей базе; требуется проверка.');
    if (!offer.unit || !matched.unit || offer.unit.normalize('NFKC').trim().toLocaleLowerCase('ru') !== matched.unit.normalize('NFKC').trim().toLocaleLowerCase('ru')) throw new Error('Единицы связанного товара не совпадают; требуется проверка.');
    return {...offer, productId:matched.id};
  });
  return {schemaVersion:1, sourceSystem:'michael-cabinet', environment:'live', baseSnapshotId:manifest.baseSnapshotId, exportedAt:live.exportedAt, offers:[...live.offers.map(o=>({...o})), ...suppliers]};
}
