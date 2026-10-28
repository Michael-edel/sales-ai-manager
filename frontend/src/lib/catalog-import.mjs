// Persist only upload identity, never private catalogue contents or credentials.
const checkpointKey = userId => `michael-catalog-import:v1:${userId}`;
const failure = safeMessage => Object.assign(new Error(safeMessage), { safeMessage });

export function readImportCheckpoint(storage, userId) {
  try {
    const value = JSON.parse(storage.getItem(checkpointKey(userId)) || "null");
    return value && /^[a-f0-9-]{36}$/i.test(value.id) && /^[a-f0-9]{64}$/.test(value.contentHash)
      && Number.isSafeInteger(value.offerCount) && value.offerCount > 0 ? value : null;
  } catch { return null; }
}

export async function importCatalogFile(file, { api, storage, userId, signal, onProgress = () => {} }) {
  if (!file.size || file.size > 100 * 1024 * 1024)
    throw failure("Выберите непустой JSON-каталог размером до 100 МБ.");
  const bytes = await file.arrayBuffer();
  let snapshot;
  try { snapshot = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw failure("Не удалось прочитать JSON. Выберите файл экспорта каталога."); }
  if (snapshot?.schemaVersion !== 1 || snapshot.sourceSystem !== "michael-cabinet"
    || !["test", "live", "unknown"].includes(snapshot.environment)
    || !Number.isFinite(Date.parse(snapshot.exportedAt))
    || !Array.isArray(snapshot.offers) || !snapshot.offers.length || snapshot.offers.length > 100000)
    throw failure("Это не экспорт каталога из «Кабинета Michael» или превышен лимит 100 000 предложений.");
  // Detect duplicate IDs before spending server writes. Full offer validation stays server-side.
  const ids = snapshot.offers.map(offer => offer?.id);
  if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length)
    throw failure("В каталоге отсутствуют или повторяются ID предложений. Сделайте новый экспорт.");
  signal?.throwIfAborted();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const contentHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const metadata = { schemaVersion: 1, sourceSystem: "michael-cabinet", exportedAt: snapshot.exportedAt,
    environment: snapshot.environment, offerCount: snapshot.offers.length, contentHash };
  const previous = readImportCheckpoint(storage, userId);
  let record;
  if (previous?.contentHash === contentHash) {
    record = await api.get(previous.id, { signal });
    if (record.contentHash !== contentHash || record.expectedCount !== metadata.offerCount
      || record.exportedAt !== new Date(metadata.exportedAt).toISOString() || record.environment !== metadata.environment)
      throw failure("Сохранённая загрузка относится к другому файлу. Сделайте новый экспорт каталога.");
  } else {
    // Test storage before opening an import; a failed checkpoint must never silently duplicate uploads.
    try { storage.setItem(checkpointKey(userId), JSON.stringify(previous)); }
    catch { throw failure("Браузер не разрешает сохранять ход загрузки. Разрешите данные этого сайта и повторите."); }
    record = await api.create(metadata, { signal });
  }
  if (record.storageVersion !== 2)
    throw failure("Сервер ещё не обновлён для загрузки большого каталога. Обновите приложение перед импортом.");
  const checkpoint = { id: record.id, contentHash, offerCount: metadata.offerCount, fileName: file.name };
  try { storage.setItem(checkpointKey(userId), JSON.stringify(checkpoint)); }
  catch { throw failure("Не удалось сохранить ход загрузки. Повторите в браузере с разрешёнными данными сайта."); }
  const completed = new Set();
  let loaded = 0;
  for (const batch of record.batches || []) {
    const expected = Math.min(100, metadata.offerCount - batch.index * 100);
    if (!Number.isInteger(batch.index) || batch.index < 0 || expected <= 0
      || batch.offerCount !== expected || completed.has(batch.index))
      throw failure("Сервер вернул неполный журнал загрузки. Обратитесь к администратору.");
    completed.add(batch.index); loaded += expected;
  }
  if (loaded !== (record.receivedCount || 0))
    throw failure("Сервер не подтвердил ход загрузки. Повторите выбор того же файла.");
  onProgress({ loaded, total: metadata.offerCount });
  for (let offset = 0; offset < metadata.offerCount; offset += 100) {
    signal?.throwIfAborted();
    if (completed.has(offset / 100)) continue;
    const result = await api.upload(record.id, offset / 100, snapshot.offers.slice(offset, offset + 100), { signal });
    loaded = result.receivedCount;
    onProgress({ loaded, total: metadata.offerCount });
  }
  signal?.throwIfAborted();
  const committed = await api.commit(record.id, { signal });
  if (committed?.activeSnapshot?.id !== record.id || committed.activeSnapshot.offerCount !== metadata.offerCount)
    throw failure("Сервер не подтвердил активацию каталога. Выберите тот же файл для продолжения.");
  storage.removeItem(checkpointKey(userId));
  return committed;
}
