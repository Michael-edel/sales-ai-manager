/** Pure catalogue matching and quotation calculations. No network, persistence or AI prices. */
export type CatalogEnvironment = "test" | "live" | "unknown";
export interface Money { amount: number; currency: string; vatIncluded: boolean | null; vatRate: number | null; updatedAt: string | null }
export interface DeliveryWindow { deliveryWeekday: number; cutoffWeekday: number; cutoffTime: string }
export interface Delivery { type: "stock" | "weekly" | "unknown"; timezone: "Asia/Almaty"; windows: DeliveryWindow[]; shippingCost: number | null; notes: string }
export interface CatalogOffer {
  id: string; productId: string; name: string; article: string; brand: string; onecCode: string; unit: string;
  sourceId: string; sourceName: string; sourceType: "warehouse" | "supplier"; warehouseName: string;
  quantity: number | null; available: boolean | null; stockConfirmed: boolean; updatedAt: string | null;
  prices: { purchase: Money | null; wholesale: Money | null; retail: Money | null }; delivery: Delivery;
}
export interface CatalogSnapshot { schemaVersion: 1; sourceSystem: "michael-cabinet"; exportedAt: string; environment: CatalogEnvironment; offers: CatalogOffer[] }
export interface Allocation {
  offerId: string; quantity: number; unitSalePrice: number | null; saleVatIncluded: boolean | null; saleVatRate: number | null;
  /** Total delivery expense for this allocation, in KZT excluding VAT. null means unknown. */
  shippingCost: number | null; confirmed: boolean;
  purchaseVatIncluded?: boolean | null; purchaseVatRate?: number | null; purchaseVatConfirmed?: boolean;
  /** Explicit same-unit confirmation, only usable when the source does not specify a unit. */
  confirmedUnit?: string;
}
export interface RequestLine { id: string; query: string; quantity: number | null; unit: string; article?: string; brand?: string; requiredBy?: string; allocations: Allocation[]; targetMarginPercent?: number | null }
export interface QuoteDraft { lines: RequestLine[]; notes?: string }
export interface SelectionContext { now?: string | Date | number; environment: CatalogEnvironment }
export interface RankedOffer { offer: CatalogOffer; score: number; matchKind: "article_brand" | "onec_code" | "exact_name" | "confirmed_link" | "similar"; warnings: string[]; deliveryDate: string | null }
export interface AllocationEvaluation {
  offerId: string; offer: CatalogOffer | null; quantity: number; confirmed: boolean;
  unitSalePrice: number | null; unitPurchasePrice: number | null; unitSaleNet: number | null; unitPurchaseNet: number | null;
  revenueNet: number | null; purchaseNet: number | null; shippingNet: number | null; goodsProfitNet: number | null;
  goodsMarginPercent: number | null; profitNet: number | null; marginPercent: number | null;
  deliveryDate: string | null; warnings: string[]; ready: boolean; salePriceSource: "manual" | "retail" | "target_margin" | "missing";
}
export interface LineEvaluation { id: string; query: string; quantity: number | null; unit: string; allocatedQuantity: number; shortageQuantity: number | null; allocations: AllocationEvaluation[]; warnings: string[]; ready: boolean }
export interface QuoteTotals { revenueNet: number | null; purchaseNet: number | null; shippingNet: number | null; goodsProfitNet: number | null; goodsMarginPercent: number | null; profitNet: number | null; marginPercent: number | null; complete: boolean }
export interface QuoteEvaluation { lines: LineEvaluation[]; totals: QuoteTotals; warnings: string[]; status: "ready" | "needs_review" | "incomplete" }

const MAX_AMOUNT = 1_000_000_000;
const MAX_QUANTITY = 1_000_000;
const DAY = 86_400_000;
const MAX_AGE = DAY;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: ожидается объект.`);
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label}: неизвестные поля.`);
}
function text(value: unknown, label: string, max: number, required = false, multiline = false): string {
  if (value === undefined || value === null) { if (!required) return ""; throw new Error(`${label}: значение не заполнено.`); }
  if (typeof value !== "string" || value.length > max || (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) throw new Error(`${label}: некорректный текст.`);
  const result = value.trim();
  if (required && !result) throw new Error(`${label}: значение не заполнено.`);
  return result;
}
function number(value: unknown, label: string, max: number, nullable = true, positive = false): number | null {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || (positive && value === 0)) throw new Error(`${label}: некорректное число.`);
  if (Math.abs(value - Math.round(value * 1e6) / 1e6) > 1e-8) throw new Error(`${label}: допускается до шести знаков после запятой.`);
  return value;
}
function boolean(value: unknown, label: string, nullable = true): boolean | null {
  if (nullable && (value === undefined || value === null)) return null;
  if (typeof value !== "boolean") throw new Error(`${label}: ожидается логическое значение.`);
  return value;
}
function timestamp(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const result = text(value, label, 40, true);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error(`${label}: дата должна содержать часовой пояс.`);
  date(result.slice(0, 10), label);
  return new Date(result).toISOString();
}
function date(value: unknown, label: string): string {
  const result = text(value, label, 10);
  if (result && (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(`${result}T00:00:00Z`)) || new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result)) throw new Error(`${label}: некорректная дата.`);
  return result;
}
function money(value: unknown, label: string): Money | null {
  if (value === null || value === undefined) return null;
  const p = object(value, label); fields(p, ["amount", "currency", "vatIncluded", "vatRate", "updatedAt"], label);
  const currency = text(p.currency, `${label}: валюта`, 3, true).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`${label}: некорректная валюта.`);
  return { amount: number(p.amount, label, MAX_AMOUNT, false)!, currency, vatIncluded: boolean(p.vatIncluded, label), vatRate: number(p.vatRate, `${label}: НДС`, 100), updatedAt: timestamp(p.updatedAt, label) };
}
export function validateCatalogOffer(input: unknown): CatalogOffer {
  const o = object(input, "Предложение");
  fields(o, ["id", "productId", "name", "article", "brand", "onecCode", "unit", "sourceId", "sourceName", "sourceType", "warehouseName", "quantity", "available", "stockConfirmed", "updatedAt", "prices", "delivery"], "Предложение");
  if (o.sourceType !== "warehouse" && o.sourceType !== "supplier") throw new Error("Неизвестный тип источника.");
  const p = object(o.prices, "Цены"); fields(p, ["purchase", "wholesale", "retail"], "Цены");
  const d = object(o.delivery, "Доставка"); fields(d, ["type", "timezone", "windows", "shippingCost", "notes"], "Доставка");
  if (!["stock", "weekly", "unknown"].includes(String(d.type)) || d.timezone !== "Asia/Almaty") throw new Error("Некорректные условия доставки или часовой пояс.");
  if (!Array.isArray(d.windows) || d.windows.length > 14) throw new Error("Некорректное расписание доставки.");
  const windows = d.windows.map(value => {
    const w = object(value, "Окно доставки"); fields(w, ["deliveryWeekday", "cutoffWeekday", "cutoffTime"], "Окно доставки");
    if (!Number.isInteger(w.deliveryWeekday) || !Number.isInteger(w.cutoffWeekday) || Number(w.deliveryWeekday) < 1 || Number(w.deliveryWeekday) > 7 || Number(w.cutoffWeekday) < 1 || Number(w.cutoffWeekday) > 7 || typeof w.cutoffTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(w.cutoffTime)) throw new Error("Некорректный день или крайнее время заказа.");
    return { deliveryWeekday: Number(w.deliveryWeekday), cutoffWeekday: Number(w.cutoffWeekday), cutoffTime: w.cutoffTime };
  });
  if (d.type !== "weekly" && windows.length) throw new Error("Расписание допустимо только для еженедельной доставки.");
  return {
    id: text(o.id, "ID предложения", 6000, true), productId: text(o.productId, "ID товара", 6000, true), name: text(o.name, "Наименование", 5000, true),
    article: text(o.article, "Артикул", 1500), brand: text(o.brand, "Бренд", 300), onecCode: text(o.onecCode, "Код 1С", 1000), unit: text(o.unit, "Единица", 100),
    sourceId: text(o.sourceId, "ID источника", 160, true), sourceName: text(o.sourceName, "Источник", 500, true), sourceType: o.sourceType, warehouseName: text(o.warehouseName, "Склад", 500),
    quantity: number(o.quantity, "Остаток", MAX_QUANTITY), available: boolean(o.available, "Наличие"), stockConfirmed: boolean(o.stockConfirmed, "Подтверждение остатка", false)!, updatedAt: timestamp(o.updatedAt, "Обновление предложения"),
    prices: { purchase: money(p.purchase, "Закупочная цена"), wholesale: money(p.wholesale, "Оптовая цена"), retail: money(p.retail, "Розничная цена") },
    delivery: { type: d.type as Delivery["type"], timezone: "Asia/Almaty", windows, shippingCost: number(d.shippingCost, "Доставка без НДС", MAX_AMOUNT), notes: text(d.notes, "Условия доставки", 2000, false, true) },
  };
}
export function validateQuoteDraft(input: unknown): QuoteDraft {
  const draft = object(input, "Подбор"); fields(draft, ["lines", "notes"], "Подбор");
  if (!Array.isArray(draft.lines) || draft.lines.length > 200) throw new Error("В подборе допускается до 200 строк.");
  const ids = new Set<string>();
  const lines = draft.lines.map(value => {
    const l = object(value, "Строка заявки"); fields(l, ["id", "query", "quantity", "unit", "article", "brand", "requiredBy", "allocations", "targetMarginPercent"], "Строка заявки");
    const id = text(l.id, "ID строки", 100, true); if (ids.has(id)) throw new Error("Повтор ID строки заявки."); ids.add(id);
    if (!Array.isArray(l.allocations) || l.allocations.length > 20) throw new Error("В строке допускается до 20 выбранных предложений.");
    const allocations = l.allocations.map(value => {
      const a = object(value, "Выбранное предложение"); fields(a, ["offerId", "quantity", "unitSalePrice", "saleVatIncluded", "saleVatRate", "shippingCost", "confirmed", "purchaseVatIncluded", "purchaseVatRate", "purchaseVatConfirmed", "confirmedUnit"], "Выбранное предложение");
      return { offerId: text(a.offerId, "ID предложения", 6000, true), quantity: number(a.quantity, "Количество в предложении", MAX_QUANTITY, false, true)!, unitSalePrice: number(a.unitSalePrice, "Продажная цена", MAX_AMOUNT), saleVatIncluded: boolean(a.saleVatIncluded, "НДС продажной цены"), saleVatRate: number(a.saleVatRate, "Ставка НДС продажи", 100), shippingCost: number(a.shippingCost, "Доставка без НДС", MAX_AMOUNT), confirmed: boolean(a.confirmed, "Подтверждение товара", false)!, purchaseVatIncluded: boolean(a.purchaseVatIncluded, "НДС закупки"), purchaseVatRate: number(a.purchaseVatRate, "Ставка НДС закупки", 100), purchaseVatConfirmed: a.purchaseVatConfirmed === undefined ? false : boolean(a.purchaseVatConfirmed, "Подтверждение НДС закупки", false)!, confirmedUnit: text(a.confirmedUnit, "Подтверждённая единица", 100) };
    });
    const target = number(l.targetMarginPercent, "Целевая маржа", 100); if (target !== null && target >= 100) throw new Error("Целевая маржа должна быть меньше 100%.");
    return { id, query: text(l.query, "Текст позиции", 2000, true), quantity: number(l.quantity, "Количество в заявке", MAX_QUANTITY, true, true), unit: text(l.unit, "Единица заявки", 100), article: text(l.article, "Артикул заявки", 1500), brand: text(l.brand, "Бренд заявки", 300), requiredBy: date(l.requiredBy, "Требуемая дата"), allocations, targetMarginPercent: target };
  });
  return { lines, notes: text(draft.notes, "Примечание", 4000, false, true) };
}

/** Search normalization deliberately preserves all numbers/model parts. */
export function normalizeCatalogText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/(\d),(?=\d)/g, "$1.").replace(/(\d)\s*[xх×*]\s*(?=\d)/gu, "$1x").replace(/[^\p{L}\p{N}.]+/gu, " ").replace(/\s+/g, " ").trim();
}
export function normalizedUnit(value: string): string {
  const u = normalizeCatalogText(value).replace(/\.$/, "");
  const groups = [["шт", "штука", "штуки", "штук", "pcs", "pc", "piece"], ["м", "метр", "метра", "метров", "m"], ["кг", "килограмм", "kg"], ["уп", "упак", "упаковка", "упаковки", "pack"], ["компл", "комплект", "комплекта"], ["рулон", "рул"], ["л", "литр", "литра"], ["пара", "пар"]];
  return groups.find(group => group.includes(u))?.[0] || u;
}
function parameters(value: string): string[] {
  const replacements: Record<string, string> = { а: "a", в: "b", с: "c", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", т: "t", х: "x" };
  const compact = value.normalize("NFKC").toLowerCase().replace(/(\d),(?=\d)/g, "$1.").replace(/(\d)\s*[xх×*]\s*(?=\d)/gu, "$1x").replace(/(^|[^\p{L}\p{N}])([a-zа-я]{1,4})\s+(?=\d)/gu, "$1$2").replace(/(\d)\s+(?=(?:[aа]|[pр]|[кk][aа]|[вv]|[wв][tт])(?:\s|$|[),]))/g, "$1");
  return (compact.match(/[\p{L}]*\d+(?:[.\-/xх×]\d+)*[\p{L}]*/gu) || []).map(token => token.replace(/[авсекмнортх]/g, char => replacements[char] || char)).filter(Boolean);
}
function match(line: RequestLine, offer: CatalogOffer): { score: number; kind: RankedOffer["matchKind"]; conflict: boolean; brandConflict: boolean } {
  const q = normalizeCatalogText(line.query), name = normalizeCatalogText(offer.name), article = normalizeCatalogText(line.article || ""), brand = normalizeCatalogText(line.brand || ""), offerBrand = normalizeCatalogText(offer.brand);
  const exactArticle = !!article && article === normalizeCatalogText(offer.article);
  const codeQuery = q === normalizeCatalogText(offer.onecCode) && !!offer.onecCode;
  const articleQuery = q === normalizeCatalogText(offer.article) && !!offer.article;
  const requiredParameters = codeQuery || articleQuery ? [] : parameters(line.query);
  const offerParameters = new Set(parameters(offer.name));
  const conflict = requiredParameters.some(token => !offerParameters.has(token));
  const brandConflict = !!brand && !!offerBrand && brand !== offerBrand;
  let score = 0; let kind: RankedOffer["matchKind"] = "similar";
  if ((exactArticle || articleQuery) && brand && brand === offerBrand) { score = 100; kind = "article_brand"; }
  else if (codeQuery) { score = 99; kind = "onec_code"; }
  else if (q === name) { score = 96; kind = "exact_name"; }
  else {
    const tokens = q.split(" ").filter(token => token.length > 1), source = new Set(name.split(" "));
    const overlap = tokens.filter(token => source.has(token)).length;
    score = tokens.length ? Math.round(70 * overlap / tokens.length) : 0;
    if (exactArticle || articleQuery) score = Math.max(score, 88);
    if (brand && brand === offerBrand) score += 5;
    if (q.length > 2 && name.includes(q)) score = Math.max(score, 80);
  }
  if (conflict || brandConflict) { score = Math.min(score, 45); kind = "similar"; }
  return { score, kind, conflict, brandConflict };
}
function nowValue(now?: SelectionContext["now"]): number {
  const result = now === undefined ? Date.now() : now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(result)) throw new Error("Некорректное время расчёта.");
  return result;
}
function localCalendar(now: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const n = (key: string) => Number(parts.find(p => p.type === key)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
}
/** Calendar dates are estimates from confirmed weekly policy, never reservation promises. */
export function nextDeliveryDate(delivery: Delivery, now: SelectionContext["now"] = Date.now()): string | null {
  const localNow = localCalendar(nowValue(now), delivery.timezone), localDate = new Date(localNow), midnight = Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate());
  if (delivery.type === "stock") return new Date(midnight).toISOString().slice(0, 10);
  if (delivery.type !== "weekly" || !delivery.windows.length) return null;
  const weekday = localDate.getUTCDay() || 7;
  const choices = delivery.windows.map(window => {
    let deliveryDay = midnight + ((window.deliveryWeekday - weekday + 7) % 7) * DAY;
    const [hour, minute] = window.cutoffTime.split(":").map(Number);
    const cutoffDayDistance = (window.deliveryWeekday - window.cutoffWeekday + 7) % 7;
    for (let week = 0; week < 3; week++) {
      const cutoff = deliveryDay - cutoffDayDistance * DAY + (hour * 60 + minute) * 60_000;
      if (localNow < cutoff) return deliveryDay;
      deliveryDay += 7 * DAY;
    }
    return deliveryDay;
  });
  return new Date(Math.min(...choices)).toISOString().slice(0, 10);
}
function sourceWarnings(offer: CatalogOffer, line: RequestLine, context: SelectionContext, linked = false): string[] {
  const warnings: string[] = [], now = nowValue(context.now);
  if (context.environment === "test") warnings.push("Тестовый каталог: перед предложением клиенту нужны рабочие данные.");
  if (context.environment !== "test" && context.environment !== "live") warnings.push("Не подтверждено, из какой базы получен каталог.");
  if (!offer.updatedAt) warnings.push("Дата обновления данных неизвестна.");
  else if (now - Date.parse(offer.updatedAt) > MAX_AGE) warnings.push("Данные старше 24 часов: проверьте остаток и цену.");
  else if (Date.parse(offer.updatedAt) - now > 300_000) warnings.push("Дата источника находится в будущем: проверьте часы.");
  if (!offer.stockConfirmed) warnings.push("Остаток источника не подтверждён.");
  if (offer.quantity === null) warnings.push("Количество у источника неизвестно.");
  else if (offer.quantity <= 0 || offer.available === false) warnings.push("В источнике нет подтверждённого положительного остатка.");
  if (!line.unit) warnings.push("Укажите единицу в заявке.");
  if (!offer.unit) warnings.push("Единица у источника неизвестна; требуется подтверждение.");
  else if (line.unit && normalizedUnit(line.unit) !== normalizedUnit(offer.unit)) warnings.push("Единицы заявки и источника различаются; пересчёт не задан.");
  if (!offer.prices.purchase) warnings.push("Закупочная цена отсутствует.");
  else if (offer.prices.purchase.currency !== "KZT") warnings.push("Закупочная цена не в KZT; валютный пересчёт не задан.");
  const m = match(line, offer);
  if (!linked && m.conflict) warnings.push("Числовые параметры или модель отличаются от запроса.");
  if (!linked && m.brandConflict) warnings.push("Бренд отличается от указанного в заявке.");
  const deliveryDate = nextDeliveryDate(offer.delivery, context.now);
  if (!deliveryDate) warnings.push("Срок доставки не подтверждён.");
  else if (line.requiredBy && deliveryDate > line.requiredBy) warnings.push("Расчётная дата доставки позже требуемого срока.");
  return warnings;
}
const LINK_WARNING = "Предложение найдено по подтверждённой связи товаров в кабинете; названия источников могут отличаться.";
/** Shared product IDs are emitted only for confirmed, same-unit links by the catalog bridge. */
function linkedMatches(line: RequestLine, offers: CatalogOffer[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const offer of offers) {
    const m = match(line, offer);
    if (m.kind !== "similar" && !m.conflict && !m.brandConflict) result.set(offer.productId, Math.max(result.get(offer.productId) || 0, m.score));
  }
  return result;
}
export function rankOffers(line: RequestLine, offers: CatalogOffer[], context: SelectionContext): RankedOffer[] {
  const identities = linkedMatches(line, offers);
  return offers.map(offer => {
    const m = match(line, offer), linkedScore = identities.get(offer.productId), linked = linkedScore !== undefined && m.kind === "similar";
    return { offer, score: linked ? linkedScore : m.score, matchKind: linked ? "confirmed_link" as const : m.kind, warnings: [...sourceWarnings(offer, line, context, linked), ...(linked ? [LINK_WARNING] : [])], deliveryDate: nextDeliveryDate(offer.delivery, context.now) };
  }).filter(item => item.score > 0).sort((a, b) => {
    const scoreDifference = b.score - a.score; if (scoreDifference) return scoreDifference;
    const own = (offer: CatalogOffer) => offer.sourceType === "warehouse" && offer.stockConfirmed && (offer.quantity || 0) > 0 ? 1 : 0;
    return own(b.offer) - own(a.offer) || (a.offer.prices.purchase?.currency === "KZT" ? a.offer.prices.purchase.amount : Infinity) - (b.offer.prices.purchase?.currency === "KZT" ? b.offer.prices.purchase.amount : Infinity) || a.offer.id.localeCompare(b.offer.id);
  });
}

/** Legacy text requests were stored with generated context. Raw text drafts must
 * never use this extraction, even if the user pasted the same headings verbatim.
 */
function requestProductBody(originalText: string): string {
  let body = originalText.replace(/\r\n/g, "\n");
  body = body.replace(/^Контекст заявки:\n(?:(?:Компания клиента|Контакт\/менеджер клиента|Менеджер Michael|Канал связи|Приоритет|Следующее действие):[^\n]*\n)+\n/, "");
  const suffixStart = body.lastIndexOf("\n\nАвтоматическая проверка 1С:\n");
  if (suffixStart < 0) return body;
  const suffix = body.slice(suffixStart + 2);
  const advice = "Используйте эти данные как справочные данные из 1С. Если данных нет, не придумывайте цену, остаток, договор или товар.";
  const unavailablePrefix = `Автоматическая проверка 1С:\n${advice}\n`;
  const unavailable = suffix.startsWith(unavailablePrefix)
    && /^Статус 1С: не проверено \([^\n]*\)\.$/u.test(suffix.slice(unavailablePrefix.length));
  const failed = /^Автоматическая проверка 1С:\n1С не проверена: [^\n]*\.\nНе придумывайте цену, остаток, договор или товар, если их нет в заявке или документах\.$/u.test(suffix);
  // Successful queries contain arbitrary text and no end marker. Keep them, and
  // any unrecognized tail, as editable rows rather than silently losing products.
  return unavailable || failed ? body.slice(0, suffixStart) : body;
}

/** Extract only explicit quantities. Unsupported prose remains an editable unresolved row. */
export function parseRequestLines(originalText: string, options: { legacyContext?: boolean } = {}): RequestLine[] {
  if (typeof originalText !== "string" || originalText.length > 200_000) throw new Error("Текст заявки слишком большой.");
  const result: RequestLine[] = [];
  const productBody = options.legacyContext === true ? requestProductBody(originalText) : originalText;
  for (const original of productBody.split(/\r?\n/)) {
    const value = original.trim().replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
    if (!value || /^(?:наименование|товар|позиция)\s*[;\t|].*(?:количество|кол-во)/i.test(value)) continue;
    let query = value, quantity: number | null = null, unit = "";
    const cells = value.split(/[;\t|]/).map(cell => cell.trim());
    if (cells.length >= 3 && /^\d+(?:[.,]\d+)?$/.test(cells.at(-2) || "") && cells.at(-1)) {
      query = cells.slice(0, -2).join(" "); quantity = Number(cells.at(-2)!.replace(",", ".")); unit = cells.at(-1)!;
    } else {
      const tail = value.match(/^(.*?)\s*(?:—|–|:|\s)\s*(\d+(?:[.,]\d+)?)\s*(шт\.?|штук[аи]?|м\.?|метр(?:а|ов)?|кг\.?|уп\.?|упак\.?|компл\.?|комплект(?:а|ов)?|рулон(?:а|ов)?|пар[аы]?|л\.?)\s*$/iu);
      if (tail && tail[1].trim()) { query = tail[1].replace(/\s*[-—–:]\s*$/, "").trim(); quantity = Number(tail[2].replace(",", ".")); unit = tail[3]; }
    }
    if (!query) continue;
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY)) quantity = null;
    if (query.length > 2000) throw new Error("Позиция заявки длиннее 2000 символов; разделите её на строки.");
    if (result.length >= 200) throw new Error("В подборе допускается до 200 строк; разделите заявку.");
    result.push({ id: `line-${result.length + 1}`, query, quantity, unit: normalizedUnit(unit), article: "", brand: "", requiredBy: "", allocations: [], targetMarginPercent: null });
  }
  return result;
}

function rounded(value: number): number | null { return Number.isFinite(value) && Math.abs(value * 100) <= Number.MAX_SAFE_INTEGER ? Math.round((value + Number.EPSILON) * 100) / 100 : null; }
function precision(value: number): number { return Math.round(value * 1e6) / 1e6; }
function percent(profit: number | null, revenue: number | null): number | null { return profit !== null && revenue !== null && revenue > 0 ? rounded(profit / revenue * 100) : null; }
function net(price: Money | null): number | null { if (!price || price.currency !== "KZT" || price.vatIncluded === null || (price.vatIncluded && price.vatRate === null)) return null; return price.vatIncluded ? price.amount / (1 + price.vatRate! / 100) : price.amount; }
function completeSum(values: Array<number | null>): number | null { if (!values.length || values.some(value => value === null)) return null; return rounded((values as number[]).reduce((sum, value) => sum + value, 0)); }

export function evaluateQuote(input: QuoteDraft, offers: CatalogOffer[], context: SelectionContext): QuoteEvaluation {
  const draft = validateQuoteDraft(input), map = new Map<string, CatalogOffer>(), usage = new Map<string, number>();
  for (const offer of offers) { if (map.has(offer.id)) throw new Error("Повтор ID предложения в каталоге."); map.set(offer.id, offer); }
  for (const line of draft.lines) for (const a of line.allocations) usage.set(a.offerId, precision((usage.get(a.offerId) || 0) + a.quantity));
  const lines: LineEvaluation[] = draft.lines.map(line => {
    const identities = linkedMatches(line, offers);
    const allocations: AllocationEvaluation[] = line.allocations.map(a => {
      const offer = map.get(a.offerId) || null;
      const item: AllocationEvaluation = { offerId: a.offerId, offer, quantity: a.quantity, confirmed: a.confirmed, unitSalePrice: null, unitPurchasePrice: null, unitSaleNet: null, unitPurchaseNet: null, revenueNet: null, purchaseNet: null, shippingNet: null, goodsProfitNet: null, goodsMarginPercent: null, profitNet: null, marginPercent: null, deliveryDate: null, warnings: [], ready: false, salePriceSource: "missing" };
      if (!offer) { item.warnings.push("Предложение отсутствует в выбранном снимке каталога."); return item; }
      const linked = identities.has(offer.productId) && match(line, offer).kind === "similar";
      item.warnings = sourceWarnings(offer, line, context, linked);
      let blocking = item.warnings.length > 0;
      if (!offer.unit && a.confirmedUnit && a.confirmed && line.unit && normalizedUnit(a.confirmedUnit) === normalizedUnit(line.unit)) {
        item.warnings = item.warnings.filter(warning => !warning.startsWith("Единица у источника неизвестна"));
        blocking = item.warnings.length > 0; item.warnings.push("Единица источника явно подтверждена менеджером.");
      }
      if (!a.confirmed) { item.warnings.push("Менеджер ещё не подтвердил точный товар и единицу."); blocking = true; }
      if (offer.quantity !== null && (usage.get(offer.id) || 0) > offer.quantity + 1e-8) { item.warnings.push("Суммарно по заявке выбрано больше, чем остаток этого предложения."); blocking = true; }
      let purchase = offer.prices.purchase ? { ...offer.prices.purchase } : null;
      if (purchase && a.purchaseVatConfirmed) {
        if ((purchase.vatIncluded !== null && a.purchaseVatIncluded !== null && a.purchaseVatIncluded !== undefined && purchase.vatIncluded !== a.purchaseVatIncluded) || (purchase.vatRate !== null && a.purchaseVatRate !== null && a.purchaseVatRate !== undefined && purchase.vatRate !== a.purchaseVatRate)) { item.warnings.push("Подтверждённый НДС закупки противоречит данным источника."); blocking = true; }
        else if ((purchase.vatIncluded === null && a.purchaseVatIncluded != null) || (purchase.vatRate === null && a.purchaseVatRate != null)) { purchase.vatIncluded ??= a.purchaseVatIncluded ?? null; purchase.vatRate ??= a.purchaseVatRate ?? null; item.warnings.push("Недостающий НДС закупки явно подтверждён менеджером."); }
      }
      const purchaseNet = net(purchase);
      item.unitPurchasePrice = purchase?.currency === "KZT" ? purchase.amount : null;
      item.unitPurchaseNet = purchaseNet === null ? null : precision(purchaseNet);
      item.purchaseNet = purchaseNet === null ? null : rounded(purchaseNet * a.quantity);
      if (purchaseNet !== null && item.purchaseNet === null) { item.warnings.push("Сумма закупки превышает точность расчёта; разделите заявку."); blocking = true; }
      if (purchase && purchase.currency === "KZT" && purchaseNet === null) { item.warnings.push("НДС закупочной цены неизвестен; чистая себестоимость не рассчитана."); blocking = true; }
      const purchaseTime = purchase?.updatedAt || offer.updatedAt;
      if (purchaseTime && nowValue(context.now) - Date.parse(purchaseTime) > MAX_AGE) { item.warnings.push("Закупочная цена старше 24 часов."); blocking = true; }
      else if (purchaseTime && Date.parse(purchaseTime) - nowValue(context.now) > 300_000) { item.warnings.push("Дата закупочной цены находится в будущем: проверьте часы."); blocking = true; }
      item.shippingNet = a.shippingCost ?? offer.delivery.shippingCost ?? (offer.sourceType === "warehouse" && offer.delivery.type === "stock" ? 0 : null);
      if (item.shippingNet === null) { item.warnings.push("Расходы доставки неизвестны: показана только маржа по товару."); blocking = true; }
      let sale: Money | null = null;
      if (a.unitSalePrice !== null) { sale = { amount: a.unitSalePrice, currency: "KZT", vatIncluded: a.saleVatIncluded, vatRate: a.saleVatRate, updatedAt: null }; item.salePriceSource = "manual"; }
      else if (offer.prices.retail?.currency === "KZT") {
        sale = { ...offer.prices.retail }; item.salePriceSource = "retail";
        if ((sale.vatIncluded !== null && a.saleVatIncluded !== null && sale.vatIncluded !== a.saleVatIncluded) || (sale.vatRate !== null && a.saleVatRate !== null && sale.vatRate !== a.saleVatRate)) { item.warnings.push("НДС розничной цены противоречит данным источника; используется НДС источника."); blocking = true; }
        if (sale.vatIncluded === null) sale.vatIncluded = a.saleVatIncluded;
        if (sale.vatRate === null) sale.vatRate = a.saleVatRate;
        if (sale.updatedAt && nowValue(context.now) - Date.parse(sale.updatedAt) > MAX_AGE) { item.warnings.push("Розничная цена источника старше 24 часов."); blocking = true; }
        else if (sale.updatedAt && Date.parse(sale.updatedAt) - nowValue(context.now) > 300_000) { item.warnings.push("Дата розничной цены находится в будущем: проверьте часы."); blocking = true; }
      } else if (line.targetMarginPercent !== null && line.targetMarginPercent !== undefined && purchaseNet !== null && item.shippingNet !== null && a.saleVatIncluded !== null && (!a.saleVatIncluded || a.saleVatRate !== null)) {
        const amountNet = (purchaseNet + item.shippingNet / a.quantity) / (1 - line.targetMarginPercent / 100);
        const amount = Math.ceil((amountNet * (a.saleVatIncluded ? 1 + a.saleVatRate! / 100 : 1) - 1e-9) * 100) / 100;
        if (Number.isFinite(amount) && amount <= MAX_AMOUNT) { sale = { amount, currency: "KZT", vatIncluded: a.saleVatIncluded, vatRate: a.saleVatRate, updatedAt: null }; item.salePriceSource = "target_margin"; }
      }
      const saleNet = net(sale);
      item.unitSalePrice = sale?.amount ?? null; item.unitSaleNet = saleNet === null ? null : precision(saleNet); item.revenueNet = saleNet === null ? null : rounded(saleNet * a.quantity);
      if (saleNet !== null && item.revenueNet === null) { item.warnings.push("Сумма продажи превышает точность расчёта; разделите заявку."); blocking = true; }
      if (!sale) { item.warnings.push("Продажная цена не задана; закупочная цена не используется вместо неё."); blocking = true; }
      else if (saleNet === null) { item.warnings.push("НДС продажной цены неизвестен; выручка без НДС не рассчитана."); blocking = true; }
      if (item.revenueNet !== null && item.purchaseNet !== null) item.goodsProfitNet = rounded(item.revenueNet - item.purchaseNet);
      item.goodsMarginPercent = percent(item.goodsProfitNet, item.revenueNet);
      if (item.goodsProfitNet !== null && item.shippingNet !== null) item.profitNet = rounded(item.goodsProfitNet - item.shippingNet);
      item.marginPercent = percent(item.profitNet, item.revenueNet);
      if (item.profitNet !== null && item.profitNet < 0) { item.warnings.push("Продажа ниже себестоимости с учётом доставки."); blocking = true; }
      if (line.targetMarginPercent != null && item.marginPercent !== null && item.marginPercent + 0.01 < line.targetMarginPercent) { item.warnings.push("Маржа ниже указанной целевой маржи."); blocking = true; }
      item.deliveryDate = nextDeliveryDate(offer.delivery, context.now);
      if (linked) item.warnings.push(LINK_WARNING);
      item.warnings = [...new Set(item.warnings)];
      item.ready = !blocking && item.profitNet !== null && item.marginPercent !== null;
      return item;
    });
    const allocatedQuantity = precision(line.allocations.reduce((sum, a) => sum + a.quantity, 0));
    const warnings: string[] = [];
    if (line.quantity === null) warnings.push("Количество в заявке не распознано; заполните его вручную.");
    else if (allocatedQuantity > line.quantity + 1e-8) warnings.push("Распределённое количество больше количества в заявке.");
    else if (allocatedQuantity + 1e-8 < line.quantity) warnings.push("Не всё количество заявки распределено по источникам.");
    if (!line.unit) warnings.push("Единица в заявке не указана.");
    if (!allocations.length) warnings.push("Для позиции ещё не выбраны предложения.");
    return { id: line.id, query: line.query, quantity: line.quantity, unit: line.unit, allocatedQuantity, shortageQuantity: line.quantity === null ? null : precision(Math.max(0, line.quantity - allocatedQuantity)), allocations, warnings, ready: !warnings.length && allocations.every(a => a.ready) };
  });
  const allocations = lines.flatMap(line => line.allocations);
  const revenueNet = completeSum(allocations.map(a => a.revenueNet)), purchaseNet = completeSum(allocations.map(a => a.purchaseNet)), shippingNet = completeSum(allocations.map(a => a.shippingNet));
  const goodsProfitNet = revenueNet === null || purchaseNet === null ? null : rounded(revenueNet - purchaseNet);
  const profitNet = goodsProfitNet === null || shippingNet === null ? null : rounded(goodsProfitNet - shippingNet);
  const coverage = !!lines.length && lines.every(line => line.quantity !== null && Math.abs(line.quantity - line.allocatedQuantity) < 1e-8 && !!line.allocations.length);
  const complete = coverage && revenueNet !== null && revenueNet > 0 && purchaseNet !== null && shippingNet !== null && profitNet !== null;
  const totals: QuoteTotals = { revenueNet, purchaseNet, shippingNet, goodsProfitNet, goodsMarginPercent: percent(goodsProfitNet, revenueNet), profitNet, marginPercent: percent(profitNet, revenueNet), complete };
  const warnings = [...new Set([...lines.flatMap(line => [...line.warnings, ...line.allocations.flatMap(a => a.warnings)]), ...(!lines.length ? ["В заявке ещё нет позиций для подбора."] : [])])];
  return { lines, totals, warnings, status: !complete ? "incomplete" : lines.every(line => line.ready) ? "ready" : "needs_review" };
}
