import { useEffect, useRef, useState } from "react";
import { Calculator, Check, FileText, Loader2, Package, Plus, RefreshCw, Save, Search, Trash2, Truck, Upload } from "lucide-react";
import { commitCatalogImport, createCatalogImport, evaluateRequestQuotation, findQuotationCandidates, getSupplierPriceHistory, getCatalogImport, getCatalogStatus, getRequestQuotation, prepareRequestQuotation, saveRequestQuotation, uploadCatalogBatch } from "../../api";
import { importCatalogFile, readImportCheckpoint } from "../../lib/catalog-import.mjs";
import "./catalog-selection.css";

const EMPTY_DRAFT = { lines: [], notes: "" };
const currencyFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const displayNumber = (value) => Number.isFinite(value) ? currencyFormat.format(value) : "—";
const money = (value, currency = "KZT") => Number.isFinite(value) ? `${displayNumber(value)} ${currency === "KZT" ? "₸" : currency}` : "Не указано";
const percent = (value) => Number.isFinite(value) ? `${displayNumber(value)} %` : "Не рассчитана";
const numericValue = (value) => value === "" ? null : Number(value);
const dateTime = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "short", timeStyle: "short" }) : "Дата не указана";
const calendarDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value.split("-").reverse().join(".") : "Срок нужно уточнить";
const priceCaption = (price) => !price ? "Цена отсутствует" : price.vatIncluded === true ? `С НДС${price.vatRate != null ? ` ${price.vatRate} %` : " — ставка неизвестна"}` : price.vatIncluded === false ? "Цена без НДС" : "НДС не подтверждён";
const matchCaption = (value) => ({ confirmed_link: "Подтверждённая связь товаров", article_brand: "Совпали артикул и бренд", onec_code: "Совпал код 1С", exact_name: "Совпало наименование", similar: "Кандидат — проверьте модель" })[value] || "Требует проверки";

function Warnings({ items = [] }) {
  const warnings = [...new Set(items.filter(Boolean))];
  return warnings.length ? <ul className="catalog-warnings">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null;
}

function NumberField({ label, value, onChange, min = 0, max, step = "any", placeholder, disabled = false }) {
  return <label><span>{label}</span><input type="number" inputMode="decimal" min={min} max={max} step={step} value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(numericValue(event.target.value))} disabled={disabled} /></label>;
}

function PriceHistory({ offer }) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), [offer.id]);
  async function load(before = null) {
    if (busy) return;
    controller.current?.abort(); const signal = new AbortController(); controller.current = signal;
    setBusy(true); setError("");
    try {
      const result = await getSupplierPriceHistory(offer.id, before, { signal: signal.signal });
      if (!signal.signal.aborted) setData(previous => ({ ...result, points: before ? [...previous.points, ...result.points] : result.points }));
    } catch (err) { if (!signal.signal.aborted) setError(err.safeMessage || err.message || "История недоступна."); }
    finally { if (!signal.signal.aborted) setBusy(false); }
  }
  const comparable = (data?.points || []).filter(point => point.price && point.price.currency === offer.prices?.purchase?.currency && point.unit === offer.unit && point.price.vatIncluded === offer.prices?.purchase?.vatIncluded && point.price.vatRate === offer.prices?.purchase?.vatRate).slice().reverse();
  const values = comparable.map(point => point.price.amount), low = Math.min(...values), high = Math.max(...values);
  const firstTime = Date.parse(comparable[0]?.snapshotAt), lastTime = Date.parse(comparable.at(-1)?.snapshotAt);
  const coords = comparable.map(point => ({ x: firstTime === lastTime ? 50 : 4 + (Date.parse(point.snapshotAt) - firstTime) * 92 / (lastTime - firstTime), y: high === low ? 40 : 75 - (point.price.amount - low) * 65 / (high - low) }));
  return <div className="price-history"><button type="button" className="secondary-button" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); if (!expanded && !data) void load(); }}>История закупочной цены</button>
    {expanded ? <div><p className="catalog-subtle">Цены сохраняются при загрузке обновлённого каталога на сайт. Дата — время снимка; источник и единица не смешиваются.</p>
      {busy ? <p role="status">Загрузка истории…</p> : null}{error ? <p role="alert">{error}</p> : null}
      {data && comparable.length ? <><svg viewBox="0 0 100 85" role="img" aria-label={`График закупочной цены: ${comparable.length} наблюдений`} preserveAspectRatio="none" style={{ width: "100%", height: 120 }}><polyline points={coords.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#226348" strokeWidth="1" vectorEffect="non-scaling-stroke" />{coords.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="1.3" fill="#226348" />)}</svg><p className="catalog-subtle">{money(low, offer.prices?.purchase?.currency)} — {money(high, offer.prices?.purchase?.currency)} · {offer.unit || "единица не указана"}. График включает только цены с одинаковыми валютой, единицей и условиями НДС.</p></> : data ? <p>Сопоставимых цен пока нет.</p> : null}
      {data?.points.length ? <div className="price-history-table"><table><thead><tr><th>Снимок</th><th>Цена закупки</th><th>Дата источника</th></tr></thead><tbody>{data.points.map((p, i) => <tr key={`${p.snapshotAt}-${i}`}><td>{dateTime(p.snapshotAt)}</td><td>{p.price ? `${money(p.price.amount, p.price.currency)} / ${p.unit || "ед. не указана"} · ${priceCaption(p.price)}` : "Не указана"}</td><td>{dateTime(p.sourceUpdatedAt)}</td></tr>)}</tbody></table></div> : null}
      {data?.nextBefore ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void load(data.nextBefore)}>Показать более ранние снимки</button> : null}
      {data && !data.nextBefore ? <p className="catalog-subtle">Показана доступная история загруженных снимков. Изменения между снимками могут быть неизвестны.</p> : null}</div> : null}</div>;
}

export function CandidateCard({ candidate, added, onAdd, disabled }) {
  const { offer } = candidate;
  const own = offer.sourceType === "warehouse";
  return <article className={`catalog-candidate ${own ? "catalog-candidate-own" : ""}`}>
    <div className="catalog-candidate-heading"><span className={`catalog-source-badge ${own ? "own" : ""}`}>{own ? <Package size={15} /> : <Truck size={15} />}{own ? "Наш склад" : "Поставщик"}</span><span className="catalog-subtle">{matchCaption(candidate.matchKind)}</span></div>
    <strong className="catalog-product-name">{offer.name}</strong>
    <p className="catalog-subtle">{[offer.brand, offer.article ? `Артикул ${offer.article}` : "Артикул не указан", offer.onecCode ? `Код 1С ${offer.onecCode}` : ""].filter(Boolean).join(" · ")}</p>
    <dl className="catalog-offer-facts">
      <div><dt>Источник</dt><dd>{offer.sourceName}{own && offer.warehouseName ? ` · ${offer.warehouseName}` : ""}</dd></div>
      <div><dt>{own ? "Остаток по снимку" : "Остаток у поставщика"}</dt><dd>{offer.quantity == null ? "Не подтверждён" : `${displayNumber(offer.quantity)} ${offer.unit || "(единица неизвестна)"}`}{!offer.stockConfirmed ? " · требуется проверка" : ""}</dd></div>
      <div><dt>Закупка за единицу</dt><dd>{money(offer.prices?.purchase?.amount, offer.prices?.purchase?.currency)}<small>{priceCaption(offer.prices?.purchase)}</small></dd></div>
      <div><dt>Розничная из источника</dt><dd>{money(offer.prices?.retail?.amount, offer.prices?.retail?.currency)}</dd></div>
      <div><dt>{own ? "Плановая выдача" : "Плановая доставка"}</dt><dd>{calendarDate(candidate.deliveryDate)}</dd></div>
      <div><dt>Обновлено</dt><dd>{dateTime(offer.updatedAt)}</dd></div>
    </dl>
    {offer.delivery?.notes ? <p className="catalog-subtle">{offer.delivery.notes}</p> : null}
    <Warnings items={candidate.warnings} />
    {!own ? <PriceHistory offer={offer} /> : null}
    {onAdd ? <button type="button" className="secondary-button" disabled={disabled || added} onClick={() => onAdd(offer)}>{added ? <Check size={16} /> : <Plus size={16} />}{added ? "Добавлено в подбор" : "Добавить в подбор"}</button> : null}
  </article>;
}

function AllocationCard({ allocation, offer, result, onChange, onRemove, disabled }) {
  const purchaseVatMissing = offer?.prices?.purchase && (offer.prices.purchase.vatIncluded == null || (offer.prices.purchase.vatIncluded && offer.prices.purchase.vatRate == null));
  const purchaseVatIncluded = offer?.prices?.purchase?.vatIncluded ?? allocation.purchaseVatIncluded;
  const purchaseVatRate = offer?.prices?.purchase?.vatRate ?? allocation.purchaseVatRate;
  return <article className="catalog-allocation">
    <div className="catalog-card-heading"><div><strong>{offer?.name || "Предложение из сохранённого подбора"}</strong><p className="catalog-subtle">{offer ? `${offer.sourceType === "warehouse" ? "Наш склад" : "Поставщик"} · ${offer.sourceName}` : allocation.offerId}</p></div><button type="button" className="catalog-icon-button" onClick={onRemove} disabled={disabled} aria-label="Убрать предложение"><Trash2 size={17} /></button></div>
    <div className="catalog-allocation-fields">
      <NumberField label={`Количество${offer?.unit ? `, ${offer.unit}` : ""}`} value={allocation.quantity || null} min={0.000001} onChange={(quantity) => onChange({ quantity: quantity ?? 0 })} disabled={disabled} />
      <NumberField label="Продажа за единицу, ₸" value={allocation.unitSalePrice} placeholder="Из розницы / по заданной марже" onChange={(unitSalePrice) => onChange({ unitSalePrice })} disabled={disabled} />
      <label><span>НДС в цене продажи</span><select aria-label="НДС в цене продажи" value={allocation.saleVatIncluded === true ? "included" : allocation.saleVatIncluded === false ? "excluded" : "unknown"} onChange={(event) => onChange({ saleVatIncluded: event.target.value === "unknown" ? null : event.target.value === "included" })} disabled={disabled}><option value="unknown">Не подтверждён</option><option value="included">Включён в цену</option><option value="excluded">Цена без НДС</option></select></label>
      <NumberField label="Ставка НДС продажи, %" value={allocation.saleVatRate} max={100} onChange={(saleVatRate) => onChange({ saleVatRate })} disabled={disabled} />
      <NumberField label="Доставка без НДС, ₸ за это количество" value={allocation.shippingCost} placeholder={offer?.delivery?.shippingCost === 0 ? "Бесплатно по условиям" : "Стоимость не известна"} onChange={(shippingCost) => onChange({ shippingCost })} disabled={disabled} />
    </div>
    {offer && !offer.unit ? <label className="catalog-unit-confirm"><span>Единица поставщика — по подтверждённому документу</span><input value={allocation.confirmedUnit || ""} maxLength={40} onChange={(event) => onChange({ confirmedUnit: event.target.value, confirmed: false })} disabled={disabled} placeholder="Уточните у поставщика" /></label> : null}
    {purchaseVatMissing ? <fieldset className="catalog-purchase-vat"><legend>Уточнение НДС закупки</legend><p className="catalog-subtle">Источник не передал все условия НДС. Заполните их по счёту или подтверждению поставщика. Сумма закупки остаётся из каталога.</p><div className="catalog-options-grid"><label><span>НДС в закупочной цене</span><select aria-label="НДС в закупочной цене" value={purchaseVatIncluded === true ? "included" : purchaseVatIncluded === false ? "excluded" : "unknown"} onChange={(event) => onChange({ purchaseVatIncluded: event.target.value === "unknown" ? null : event.target.value === "included", purchaseVatConfirmed: false })} disabled={disabled || offer.prices.purchase.vatIncluded != null}><option value="unknown">Не подтверждён</option><option value="included">Включён в цену</option><option value="excluded">Цена без НДС</option></select></label><NumberField label="Ставка НДС закупки, %" value={purchaseVatRate} max={100} onChange={(purchaseVatRate) => onChange({ purchaseVatRate, purchaseVatConfirmed: false })} disabled={disabled || offer.prices.purchase.vatRate != null} /></div><label className="catalog-confirm"><input type="checkbox" checked={Boolean(allocation.purchaseVatConfirmed)} onChange={(event) => onChange({ purchaseVatConfirmed: event.target.checked })} disabled={disabled} /><span>Условия НДС закупки подтверждены документом поставщика</span></label></fieldset> : null}
    <p className="catalog-subtle">Закупка: {money(offer?.prices?.purchase?.amount, offer?.prices?.purchase?.currency)} · {priceCaption(offer?.prices?.purchase)}. Доставка распределяется на выбранное здесь количество.</p>
    <label className="catalog-confirm"><input type="checkbox" checked={Boolean(allocation.confirmed)} onChange={(event) => onChange({ confirmed: event.target.checked })} disabled={disabled} /><span>Проверил точную модель, характеристики и совпадение единиц измерения</span></label>
    {result ? <div className="catalog-allocation-result"><div><span>Продажа / ед.</span><strong>{money(result.unitSalePrice)}</strong><small>{({ manual: "Введена менеджером", retail: "Розничная из источника", target_margin: "По заданной марже", missing: "Цена не определена" })[result.salePriceSource]}</small></div><div><span>Прибыль без НДС</span><strong>{money(result.profitNet)}</strong></div><div><span>Маржа с доставкой</span><strong>{percent(result.marginPercent)}</strong></div><div><span>Плановый срок</span><strong>{calendarDate(result.deliveryDate)}</strong></div><Warnings items={result.warnings} /></div> : null}
  </article>;
}

function EvaluationSummary({ evaluation, stale }) {
  if (!evaluation) return null;
  const totals = evaluation.totals || {};
  return <div className={`catalog-summary ${stale ? "catalog-summary-stale" : ""}`}>
    <div className="catalog-card-heading"><strong>{stale ? "Расчёт сохранённой версии" : evaluation.status === "ready" ? "Расчёт подбора выполнен" : "В подборе есть вопросы"}</strong><span className="catalog-subtle">Суммы без НДС · KZT</span></div>
    <div className="catalog-summary-grid"><div><span>Продажа</span><strong>{money(totals.revenueNet)}</strong></div><div><span>Закупка</span><strong>{money(totals.purchaseNet)}</strong></div><div><span>Доставка</span><strong>{money(totals.shippingNet)}</strong></div><div><span>Прибыль с доставкой</span><strong>{money(totals.profitNet)}</strong></div><div><span>Маржа с доставкой</span><strong>{percent(totals.marginPercent)}</strong></div><div><span>Маржа товара без доставки</span><strong>{percent(totals.goodsMarginPercent)}</strong></div></div>
    {!totals.complete ? <p className="catalog-subtle">Итог неполный: часть цен, количеств, НДС или расходов требует уточнения. Неизвестные расходы не считаются нулевыми.</p> : null}
    <Warnings items={evaluation.warnings} />
  </div>;
}

export default function CatalogSelectionPanel({ selectedRequest, user }) {
  const canManage = ["admin", "manager"].includes(user?.role);
  const [catalog, setCatalog] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [revision, setRevision] = useState(0);
  const [savedAt, setSavedAt] = useState(null);
  const [snapshotId, setSnapshotId] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [evaluationOutdated, setEvaluationOutdated] = useState(false);
  const [offers, setOffers] = useState({});
  const [candidates, setCandidates] = useState({});
  const [busy, setBusy] = useState("load");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [pendingImport, setPendingImport] = useState(() => readImportCheckpoint(localStorage, user?.id));
  const lifetime = useRef(null);
  const searchVersions = useRef({});
  const draftVersion = useRef(0);
  const fileInput = useRef(null);
  const requestId = selectedRequest?.id;
  const activeSnapshot = catalog?.activeSnapshot;
  const outdated = Boolean(snapshotId && activeSnapshot?.id && snapshotId !== activeSnapshot.id);

  function absorbOffers(value) {
    const found = {};
    for (const line of value?.lines || []) for (const allocation of line.allocations || []) if (allocation.offer) found[allocation.offer.id] = allocation.offer;
    setOffers((current) => ({ ...current, ...found }));
  }

  function reportFailure(err) {
    if (err.name === "AbortError") return;
    const messages = { 400: "Проверьте заполнение позиций и формат каталога.", 401: "Сессия завершилась. Войдите в приложение снова.", 403: "Для этого действия недостаточно прав.", 404: "Заявка или каталог больше не доступны. Обновите страницу.", 409: "Данные изменились. Обновите каталог или загрузите сохранённый подбор перед повторным сохранением.", 422: "Проверьте количество, единицы и условия цен в подборе.", 429: "Слишком много запросов. Повторите через некоторое время." };
    setError(err.safeMessage || messages[err.status] || "Не удалось выполнить действие. Проверьте связь с сервером и повторите попытку.");
    if (err.status === 409) setConflict(true);
  }

  async function load(signal) {
    Object.keys(searchVersions.current).forEach((id) => { searchVersions.current[id]++; });
    setBusy("load"); setError("");
    try {
      const [status, saved] = await Promise.all([getCatalogStatus({ signal }), getRequestQuotation(requestId, { signal })]);
      if (signal.aborted) return;
      setCatalog(status); setDraft(saved.draft || EMPTY_DRAFT); setRevision(saved.revision || 0); setSavedAt(saved.updatedAt || null);
      setSnapshotId(saved.catalogSnapshotId || status.activeSnapshot?.id || null); setEvaluation(saved.evaluation || null); setEvaluationOutdated(Boolean(saved.evaluationOutdated));
      setOffers({}); absorbOffers(saved.evaluation); setCandidates({}); setDirty(false); setConflict(false); setNotice(""); setLoaded(true); draftVersion.current++;
    } catch (err) { if (!signal.aborted) reportFailure(err); }
    finally { if (!signal.aborted) setBusy(""); }
  }

  useEffect(() => {
    if (!canManage || !requestId) return undefined;
    const controller = new AbortController(); lifetime.current = controller;
    void load(controller.signal);
    return () => { controller.abort(); lifetime.current = null; };
  }, [requestId, canManage]);

  function mutateDraft(transform) {
    setDraft(transform); setEvaluation(null); setEvaluationOutdated(false); setDirty(true); setNotice(""); draftVersion.current++;
  }

  function updateLine(id, patch) {
    const identityChanged = ["query", "article", "brand", "unit"].some((key) => Object.hasOwn(patch, key));
    const searchChanged = identityChanged || ["quantity", "requiredBy"].some((key) => Object.hasOwn(patch, key));
    if (searchChanged) {
      searchVersions.current[id] = (searchVersions.current[id] || 0) + 1;
      setCandidates((current) => ({ ...current, [id]: undefined }));
    }
    mutateDraft((current) => ({ ...current, lines: current.lines.map((line) => line.id !== id ? line : { ...line, ...patch, allocations: identityChanged ? (patch.allocations ?? line.allocations).map((allocation) => ({ ...allocation, confirmed: false })) : (patch.allocations ?? line.allocations) }) }));
  }

  function updateAllocation(lineId, index, patch) {
    mutateDraft((current) => ({ ...current, lines: current.lines.map((line) => line.id !== lineId ? line : { ...line, allocations: line.allocations.map((allocation, i) => i === index ? { ...allocation, ...patch } : allocation) }) }));
  }

  async function prepare() {
    const signal = lifetime.current?.signal; if (!signal) return;
    setBusy("prepare"); setError("");
    try {
      const result = await prepareRequestQuotation(requestId, { signal });
      if (signal.aborted) return;
      mutateDraft(() => result.draft || EMPTY_DRAFT); setSnapshotId(activeSnapshot?.id || null);
      setNotice("Проверьте извлечённые позиции, количества и единицы. Неопределённые значения оставлены пустыми.");
    } catch (err) { if (!signal.aborted) reportFailure(err); }
    finally { if (!signal.aborted) setBusy(""); }
  }

  async function search(line) {
    const signal = lifetime.current?.signal; if (!signal) return;
    const version = (searchVersions.current[line.id] || 0) + 1; searchVersions.current[line.id] = version;
    setCandidates((current) => ({ ...current, [line.id]: { loading: true, items: [] } }));
    try {
      const result = await findQuotationCandidates(requestId, line, snapshotId, { signal });
      if (signal.aborted || version !== searchVersions.current[line.id]) return;
      setCandidates((current) => ({ ...current, [line.id]: { loading: false, items: result.candidates || [], truncated: Boolean(result.searchTruncated) } }));
      setOffers((current) => ({ ...current, ...Object.fromEntries((result.candidates || []).map((candidate) => [candidate.offer.id, candidate.offer])) }));
    } catch (err) {
      if (signal.aborted || version !== searchVersions.current[line.id]) return;
      setCandidates((current) => ({ ...current, [line.id]: { loading: false, items: [], error: err.status === 409 ? "Каталог изменился. Перейдите на актуальную версию каталога." : "Не удалось найти предложения. Проверьте связь с сервером и повторите попытку." } }));
    }
  }

  function addOffer(line, offer) {
    if (line.allocations.some((allocation) => allocation.offerId === offer.id)) return;
    const remaining = line.quantity == null ? 0 : Math.max(0, line.quantity - line.allocations.reduce((total, allocation) => total + (allocation.quantity || 0), 0));
    const quantity = offer.quantity == null ? remaining : Math.min(remaining, Math.max(0, offer.quantity));
    const retail = offer.prices?.retail;
    const allocation = { offerId: offer.id, quantity, unitSalePrice: null, saleVatIncluded: retail?.vatIncluded ?? null, saleVatRate: retail?.vatRate ?? null, shippingCost: null, confirmed: false, purchaseVatIncluded: offer.prices?.purchase?.vatIncluded ?? null, purchaseVatRate: offer.prices?.purchase?.vatRate ?? null, purchaseVatConfirmed: false, confirmedUnit: "" };
    updateLine(line.id, { allocations: [...line.allocations, allocation] });
  }

  async function calculate(save = false) {
    const signal = lifetime.current?.signal; if (!signal) return;
    const version = draftVersion.current;
    setBusy(save ? "save" : "evaluate"); setError(""); setNotice("");
    try {
      const result = save ? await saveRequestQuotation(requestId, draft, snapshotId, revision, { signal }) : await evaluateRequestQuotation(requestId, draft, snapshotId, { signal });
      if (signal.aborted || draftVersion.current !== version) return;
      setEvaluation(result.evaluation); setEvaluationOutdated(false); setSnapshotId(result.catalogSnapshotId || snapshotId); absorbOffers(result.evaluation);
      if (save) { setRevision(result.revision); setSavedAt(result.updatedAt || null); setDraft(result.draft || draft); setDirty(false); setConflict(false); setNotice("Черновик подбора сохранён в заявке."); }
    } catch (err) { if (!signal.aborted) reportFailure(err); }
    finally { if (!signal.aborted) setBusy(""); }
  }

  async function refreshCatalog() {
    const signal = lifetime.current?.signal; if (!signal) return;
    setBusy("catalog"); setError("");
    try {
      const status = await getCatalogStatus({ signal }); if (signal.aborted) return;
      setCatalog(status);
      if (status.activeSnapshot?.id && status.activeSnapshot.id !== snapshotId) {
        setSnapshotId(status.activeSnapshot.id); setCandidates({}); Object.keys(searchVersions.current).forEach((id) => { searchVersions.current[id]++; }); setOffers({});
        mutateDraft((current) => ({ ...current, lines: current.lines.map((line) => ({ ...line, allocations: line.allocations.map((allocation) => ({ ...allocation, confirmed: false, purchaseVatConfirmed: false })) })) }));
        setNotice("Выбрана актуальная версия каталога. Пересчитайте подбор и подтвердите выбранные товары заново.");
      } else if (status.activeSnapshot?.id) {
        setNotice("Каталог уже актуален. Выбранные товары и подтверждения сохранены.");
      }
    } catch (err) { if (!signal.aborted) reportFailure(err); }
    finally { if (!signal.aborted) setBusy(""); }
  }

  async function importCatalog(file) {
    const signal = lifetime.current?.signal; if (!signal || !file) return;
    setBusy("import"); setError(""); setNotice(""); setImportProgress({ loaded: 0, total: 0 });
    try {
      const committed = await importCatalogFile(file, { signal, storage: localStorage, userId: user.id,
        api: { create: createCatalogImport, get: getCatalogImport, upload: uploadCatalogBatch, commit: commitCatalogImport },
        onProgress: (value) => { if (!signal.aborted) setImportProgress(value); } });
      if (signal.aborted) return;
      setCatalog({ activeSnapshot: committed.activeSnapshot });
      if (!snapshotId) setSnapshotId(committed.activeSnapshot.id);
      setPendingImport(null);
      setNotice(`Каталог загружен: ${committed.activeSnapshot.offerCount.toLocaleString("ru-RU")} предложений. Для существующего подбора выберите актуальный каталог и пересчитайте цены.`);
    } catch (err) { if (!signal.aborted) reportFailure(err instanceof SyntaxError ? Object.assign(new Error(), { safeMessage: "Не удалось прочитать JSON. Выберите файл экспорта каталога." }) : err); }
    finally { if (!signal.aborted) { setBusy(""); setImportProgress(null); setPendingImport(readImportCheckpoint(localStorage, user.id)); if (fileInput.current) fileInput.current.value = ""; } }
  }

  if (!canManage || !requestId) return null;
  const disabled = Boolean(busy) || !loaded;

  return <section className="catalog-selection" aria-labelledby="catalog-selection-title">
    <div className="catalog-panel-heading"><div><span className="catalog-eyebrow">Склад Michael и поставщики</span><h3 id="catalog-selection-title">Подбор товаров из заявки</h3><p>Выберите точные товары, распределите количество и проверьте цену, срок и маржу.</p></div><span className="catalog-revision">{dirty ? "Есть несохранённые изменения" : revision ? `Сохранена версия ${revision}` : "Новый подбор"}</span></div>

    <div className="catalog-status"><div><strong>{activeSnapshot ? `${displayNumber(activeSnapshot.offerCount)} предложений в каталоге` : "Каталог ещё не загружен"}</strong><span>{activeSnapshot ? `Снимок: ${dateTime(activeSnapshot.exportedAt)} · время Экибастуза` : "Администратор может загрузить экспорт из «Кабинета Michael»."}</span></div><button type="button" className="secondary-button" onClick={refreshCatalog} disabled={disabled}><RefreshCw size={16} />{outdated ? "Выбрать актуальный каталог" : "Обновить данные каталога"}</button></div>
    {activeSnapshot && activeSnapshot.environment !== "live" ? <div className="catalog-alert">{activeSnapshot.environment === "test" ? "Тестовый каталог: данные учебной 1С не подтверждают наличие и цены рабочего склада." : "Рабочая среда источника не подтверждена. Проверьте данные перед предложением клиенту."}</div> : null}
    {outdated ? <div className="catalog-alert">Сохранённый подбор использует предыдущий снимок. Выберите актуальный каталог, пересчитайте и проверьте изменившиеся цены и остатки.</div> : null}
    {evaluationOutdated ? <div className="catalog-alert">Сохранённый расчёт устарел — пересчитайте цены и сроки.</div> : null}
    {user.role === "admin" ? <details className="catalog-import"><summary><Upload size={16} />Загрузить каталог из кабинета</summary><p>В «Кабинете Michael» экспортируйте каталог для AI-менеджера и выберите JSON-файл. Предыдущий каталог будет заменён только после полной загрузки. Если загрузка прервётся, выберите тот же файл для продолжения.</p>{pendingImport ? <p className="catalog-alert">Есть незавершённая загрузка «{pendingImport.fileName}». Выберите этот же файл, чтобы продолжить с сохранённого места.</p> : null}<label className="catalog-file-label"><span>JSON-каталог, до 100 МБ</span><input ref={fileInput} type="file" accept=".json,application/json" onChange={(event) => void importCatalog(event.target.files?.[0])} disabled={disabled} /></label>{importProgress ? <div role="status" className="catalog-import-progress"><progress value={importProgress.loaded} max={importProgress.total || 1} /><span>Загружено {displayNumber(importProgress.loaded)} из {displayNumber(importProgress.total)} предложений</span></div> : null}</details> : null}
    <details className="catalog-original"><summary>Исходный текст заявки</summary><pre>{selectedRequest.original_text || "Исходный текст отсутствует."}</pre></details>

    {error ? <div className="error-box" role="alert">{error}{conflict || !loaded ? <button type="button" className="secondary-button" onClick={() => { if (lifetime.current) void load(lifetime.current.signal); }} disabled={Boolean(busy)}>{loaded ? "Отменить изменения и загрузить сохранённое" : "Повторить загрузку"}</button> : null}</div> : null}
    {notice ? <div className="catalog-notice" role="status">{notice}</div> : null}
    {savedAt ? <p className="catalog-subtle">Последнее сохранение: {dateTime(savedAt)} · время Экибастуза</p> : null}
    {busy === "load" ? <p className="catalog-loading" role="status"><Loader2 className="spin" size={18} />Загружаем подбор…</p> : null}

    <div className="catalog-toolbar">{draft.lines.length === 0 ? <button type="button" className="primary-button" onClick={prepare} disabled={disabled || !selectedRequest.original_text}><FileText size={17} />Взять позиции из заявки</button> : null}<button type="button" className="secondary-button" disabled={disabled || draft.lines.length >= 100} onClick={() => mutateDraft((current) => ({ ...current, lines: [...current.lines, { id: crypto.randomUUID(), query: "", quantity: null, unit: "", allocations: [] }] }))}><Plus size={17} />Добавить позицию</button></div>
    {draft.lines.length === 0 && !busy ? <div className="catalog-empty">Сначала выделите позиции из текста заявки или добавьте их вручную. Количество и единицы нужно проверить перед подбором.</div> : null}

    <div className="catalog-lines">{draft.lines.map((line, lineIndex) => {
      const searchResult = candidates[line.id];
      const evaluatedLine = evaluation?.lines?.find((item) => item.id === line.id);
      const allocated = line.allocations.reduce((total, allocation) => total + (allocation.quantity || 0), 0);
      return <article className="catalog-line" key={line.id}>
        <div className="catalog-card-heading"><strong>Позиция {lineIndex + 1}</strong><button type="button" className="catalog-icon-button" aria-label={`Удалить позицию ${lineIndex + 1}`} disabled={disabled} onClick={() => { searchVersions.current[line.id] = (searchVersions.current[line.id] || 0) + 1; mutateDraft((current) => ({ ...current, lines: current.lines.filter((item) => item.id !== line.id) })); }}><Trash2 size={17} /></button></div>
        <div className="catalog-line-fields"><label className="catalog-query"><span>Товар из заявки / поисковый запрос</span><input value={line.query} maxLength={500} onChange={(event) => updateLine(line.id, { query: event.target.value })} disabled={disabled} placeholder="Наименование, модель или код 1С" /></label><NumberField label="Нужно клиенту" value={line.quantity} min={0.000001} onChange={(quantity) => updateLine(line.id, { quantity })} disabled={disabled} /><label><span>Единица</span><input value={line.unit || ""} maxLength={40} onChange={(event) => updateLine(line.id, { unit: event.target.value })} disabled={disabled} placeholder="шт, м…" /></label><label><span>Нужно к дате</span><input type="date" value={line.requiredBy || ""} onChange={(event) => updateLine(line.id, { requiredBy: event.target.value || undefined })} disabled={disabled} /></label></div>
        <details className="catalog-line-options"><summary>Артикул, бренд и целевая маржа</summary><div className="catalog-options-grid"><label><span>Точный артикул</span><input value={line.article || ""} onChange={(event) => updateLine(line.id, { article: event.target.value })} maxLength={200} disabled={disabled} /></label><label><span>Бренд</span><input value={line.brand || ""} onChange={(event) => updateLine(line.id, { brand: event.target.value })} maxLength={160} disabled={disabled} /></label><NumberField label="Целевая маржа, % от продажи без НДС" value={line.targetMarginPercent} min={0} max={99.99} onChange={(targetMarginPercent) => updateLine(line.id, { targetMarginPercent })} disabled={disabled} /></div><p className="catalog-subtle">Маржа применяется для расчёта, когда нет ручной и розничной цены. Для расчёта нужны закупка, доставка и условия НДС продажи.</p></details>
        <div className="catalog-line-search"><button type="button" className="secondary-button" onClick={() => void search(line)} disabled={disabled || searchResult?.loading || !line.query.trim() || !activeSnapshot || outdated}>{searchResult?.loading ? <Loader2 className="spin" size={17} /> : <Search size={17} />}Найти на складе и у поставщиков</button><span className="catalog-subtle">В подборе {displayNumber(allocated)} из {displayNumber(line.quantity)} {line.unit}</span></div>
        {searchResult?.error ? <div className="catalog-alert" role="alert">{searchResult.error}</div> : null}
        {searchResult && !searchResult.loading && !searchResult.error ? <div className="catalog-search-results"><p className="catalog-subtle">{searchResult.items.length ? `Найдено предложений: ${searchResult.items.length}. Совпадение модели и единиц подтверждает менеджер.` : "Подходящих предложений не найдено. Уточните артикул, бренд или наименование."}</p>{searchResult.truncated ? <p className="catalog-alert">Показана часть совпадений. Уточните модель или укажите точный артикул, чтобы сузить поиск.</p> : null}<div className="catalog-candidates">{searchResult.items.map((candidate) => <CandidateCard key={candidate.offer.id} candidate={candidate} added={line.allocations.some((allocation) => allocation.offerId === candidate.offer.id)} disabled={disabled} onAdd={(offer) => addOffer(line, offer)} />)}</div></div> : null}
        {line.allocations.length ? <div className="catalog-allocations"><h4>Выбранные предложения</h4>{line.allocations.map((allocation, index) => <AllocationCard key={allocation.offerId} allocation={allocation} offer={offers[allocation.offerId] || evaluatedLine?.allocations?.find((item) => item.offerId === allocation.offerId)?.offer} result={evaluatedLine?.allocations?.find((item) => item.offerId === allocation.offerId)} disabled={disabled} onChange={(patch) => updateAllocation(line.id, index, patch)} onRemove={() => updateLine(line.id, { allocations: line.allocations.filter((_, i) => i !== index) })} />)}</div> : null}
        <Warnings items={evaluatedLine?.warnings} />
      </article>;
    })}</div>

    {draft.lines.length ? <><label className="catalog-notes"><span>Комментарий к подбору</span><textarea aria-label="Комментарий к подбору" rows={2} value={draft.notes || ""} maxLength={2000} onChange={(event) => mutateDraft((current) => ({ ...current, notes: event.target.value }))} disabled={disabled} /></label><div className="catalog-toolbar catalog-bottom-toolbar"><button type="button" className="secondary-button" onClick={() => void calculate(false)} disabled={disabled || !snapshotId || outdated}><Calculator size={17} />Пересчитать цены, сроки и маржу</button><button type="button" className="primary-button" onClick={() => void calculate(true)} disabled={disabled || !snapshotId || outdated || conflict}>{busy === "save" ? <Loader2 className="spin" size={17} /> : <Save size={17} />}Сохранить черновик</button></div><EvaluationSummary evaluation={evaluation} stale={outdated || evaluationOutdated} /><p className="catalog-footnote">Подбор не резервирует товар и не создаёт документы в 1С. Остатки и сроки требуют подтверждения перед обещанием клиенту. Маржа рассчитывается от выручки без НДС, с учётом известной стоимости доставки.</p></> : null}
  </section>;
}
