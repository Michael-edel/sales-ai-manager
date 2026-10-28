import { describe, expect, it } from "vitest";
import { evaluateQuote, nextDeliveryDate, normalizeCatalogText, parseRequestLines, rankOffers, validateCatalogOffer, validateQuoteDraft, type Allocation, type CatalogOffer, type Delivery, type QuoteDraft, type RequestLine, type SelectionContext } from "./catalog-selection";

const NOW = "2026-10-27T10:00:00.000Z";
const context: SelectionContext = { now: NOW, environment: "live" };
const delivery: Delivery = { type: "stock", timezone: "Asia/Almaty", windows: [], shippingCost: 0, notes: "Самовывоз со склада" };
function offer(changes: Partial<CatalogOffer> = {}): CatalogOffer {
  return { id: "onec:1", productId: "onec:1", name: "Автомат ВА47-29 1P 16А C 4,5кА Sirius", article: "A16", brand: "Sirius", onecCode: "0001", unit: "шт", sourceId: "warehouse:onec", sourceName: "Michael", sourceType: "warehouse", warehouseName: "Экибастуз", quantity: 20, available: true, stockConfirmed: true, updatedAt: NOW, prices: { purchase: { amount: 1160, currency: "KZT", vatIncluded: true, vatRate: 16, updatedAt: NOW }, wholesale: null, retail: { amount: 1450, currency: "KZT", vatIncluded: true, vatRate: 16, updatedAt: NOW } }, delivery: { ...delivery }, ...changes };
}
function allocation(changes: Partial<Allocation> = {}): Allocation {
  return { offerId: "onec:1", quantity: 2, unitSalePrice: null, saleVatIncluded: true, saleVatRate: 16, shippingCost: null, confirmed: true, ...changes };
}
function line(changes: Partial<RequestLine> = {}): RequestLine {
  return { id: "line-1", query: offer().name, quantity: 2, unit: "шт", article: "A16", brand: "Sirius", allocations: [allocation()], targetMarginPercent: null, ...changes };
}
function quote(changes: Partial<RequestLine> = {}): QuoteDraft { return { lines: [line(changes)] }; }
function evaluate(product: CatalogOffer = offer(), changes: Partial<RequestLine> = {}) { return evaluateQuote(quote(changes), [product], context); }
const ct1: Delivery = { type: "weekly", timezone: "Asia/Almaty", windows: [{ deliveryWeekday: 3, cutoffWeekday: 5, cutoffTime: "15:00" }], shippingCost: 0, notes: "Бесплатно по средам, заказ до пятницы 15:00" };

describe("validated catalog and quote contract", () => {
  it("preserves long source identity and unknown VAT rather than manufacturing tax data", () => {
    const product = offer({ id: "ct1:" + "%D0%B0".repeat(800) });
    product.prices.purchase!.vatRate = null;
    expect(validateCatalogOffer(product)).toEqual(product);
  });
  it.each([NaN, Infinity, -1, "10", 1_000_001])("rejects malformed quantity %s", value => {
    expect(() => validateCatalogOffer({ ...offer(), quantity: value })).toThrow();
  });
  it("rejects impossible dates, unsupported timezone and malformed cutoff", () => {
    expect(() => validateCatalogOffer(offer({ updatedAt: "2026-02-31T12:00:00Z" }))).toThrow();
    expect(() => validateCatalogOffer({ ...offer(), delivery: { ...ct1, timezone: "UTC" } })).toThrow();
    expect(() => validateCatalogOffer({ ...offer(), delivery: { ...ct1, windows: [{ deliveryWeekday: 3, cutoffWeekday: 5, cutoffTime: "25:00" }] } })).toThrow();
  });
  it("never accepts a purchase amount supplied in a quotation allocation", () => {
    expect(() => validateQuoteDraft({ lines: [{ ...line(), allocations: [{ ...allocation(), purchasePrice: 1 }] }] })).toThrow("неизвестные поля");
  });
  it("rejects duplicate row IDs and target margins at 100%", () => {
    expect(() => validateQuoteDraft({ lines: [line(), line()] })).toThrow("Повтор");
    expect(() => validateQuoteDraft(quote({ targetMarginPercent: 100 }))).toThrow("меньше 100");
  });
  it("accepts an unresolved draft but never invents missing quantity", () => {
    const result = validateQuoteDraft(quote({ quantity: null, allocations: [] }));
    expect(result.lines[0].quantity).toBeNull();
  });
});

describe("request extraction and conservative matching", () => {
  const productBody = "Светильник LED Beta 72w 1200mm 6500К Sirius — 10 шт\nАвтомат ВА 47-29 1P 16А (С) Sirius — 10 шт\nЩМП-65.50.22 IP54 — 10 шт";
  const metadataPrefix = "Контекст заявки:\nКомпания клиента: ТЕСТ подбора\nКонтакт/менеджер клиента: Тестовый контакт\nМенеджер Michael: Тестовый менеджер\nКанал связи: text\nПриоритет: normal\nСледующее действие: Проверить подбор\n\n";
  const advice = "Используйте эти данные как справочные данные из 1С. Если данных нет, не придумывайте цену, остаток, договор или товар.";
  const legacy = { legacyContext: true };
  const unavailable = `Автоматическая проверка 1С:\n${advice}\nСтатус 1С: не проверено (bridge 1С не настроен).`;
  it("extracts all three product lines from the stored metadata-prefixed text contract", () => {
    const expected = parseRequestLines(productBody);
    expect(expected).toHaveLength(3);
    expect(parseRequestLines(metadataPrefix + productBody, legacy)).toEqual(expected);
    expect(parseRequestLines((metadataPrefix + productBody).replace(/\n/g, "\r\n"), legacy)).toEqual(expected);
  });
  it.each([
    unavailable,
    "Автоматическая проверка 1С:\n1С не проверена: bridge 1С недоступен.\nНе придумывайте цену, остаток, договор или товар, если их нет в заявке или документах.",
  ])("removes only a fully recognized terminal legacy 1C error block: %s", suffix => {
    expect(parseRequestLines(metadataPrefix + productBody + "\n\n" + suffix, legacy)).toEqual(parseRequestLines(productBody));
    expect(parseRequestLines(productBody + "\n\n" + suffix, legacy)).toEqual(parseRequestLines(productBody));
  });
  it("preserves verbatim generated headings and a user product tail in raw drafts by default", () => {
    const raw = `${metadataPrefix}Кабель;10;м\n\n${unavailable}\n\nДополнительно нужно:\nАвтомат Sirius C16 — 10 шт`;
    const rows = parseRequestLines(raw);
    expect(rows[0].query).toBe("Контекст заявки:");
    expect(rows.some(row => row.query === "Автоматическая проверка 1С:")).toBe(true);
    expect(rows.at(-1)).toMatchObject({ query: "Автомат Sirius C16", quantity: 10, unit: "шт" });
    expect(parseRequestLines(`${productBody}\n\n${unavailable}`).at(-1)?.query).toBe("Статус 1С: не проверено (bridge 1С не настроен).");
  });
  it("keeps unknown tails and arbitrary successful 1C output even for legacy text", () => {
    const success = `Автоматическая проверка 1С:\n\n${advice}\n\nСтатус 1С: bridge доступен, инструментов: 2.\n\nТовар, поиск "Sirius":\nАвтомат Sirius C32 — 7 шт`;
    const failure = "Автоматическая проверка 1С:\n1С не проверена: bridge 1С недоступен.\nНе придумывайте цену, остаток, договор или товар, если их нет в заявке или документах.";
    for (const suffix of [unavailable, failure, success]) {
      const text = `${metadataPrefix}${productBody}\n\n${suffix}\n\nДополнительно нужно:\nКабель;25;м`;
      const rows = parseRequestLines(text, legacy);
      expect(rows.some(row => row.query === "Автоматическая проверка 1С:")).toBe(true);
      expect(rows.at(-1)).toMatchObject({ query: "Кабель", quantity: 25, unit: "м" });
    }
    expect(parseRequestLines(`${productBody}\n\n${success}`, legacy).at(-1)).toMatchObject({ query: "Автомат Sirius C32", quantity: 7 });
  });
  it("preserves ordinary user prose and similar headings instead of removing matching words globally", () => {
    const text = "Контекст заявки:\nОсобое требование: проверить комплектацию\n\nКабель ВВГ;25;м\nКомпания клиента: указана на чертеже\n\nАвтоматическая проверка 1С:\nНужно согласовать замену\nАвтомат Sirius C16 — 10 шт";
    expect(parseRequestLines(text).map(row => row.query)).toEqual([
      "Контекст заявки:", "Особое требование: проверить комплектацию", "Кабель ВВГ", "Компания клиента: указана на чертеже",
      "Автоматическая проверка 1С:", "Нужно согласовать замену", "Автомат Sirius C16",
    ]);
    expect(parseRequestLines("Кабель;2;м\n\nКонтекст заявки:\nКомпания клиента: Михаил\n\nАвтомат;3;шт")).toHaveLength(4);
  });
  it("parses explicit table quantities and trailing quantities while preserving cable dimensions", () => {
    const rows = parseRequestLines("Наименование;Количество;Ед\nКабель ВВГ 3x2,5;25;м\nАвтомат Sirius 1P C16 — 10 шт.\nПроверить возможность поставки щита");
    expect(rows.map(row => [row.query, row.quantity, row.unit])).toEqual([["Кабель ВВГ 3x2,5", 25, "м"], ["Автомат Sirius 1P C16", 10, "шт"], ["Проверить возможность поставки щита", null, ""]]);
  });
  it("does not mistake current rating for a requested count", () => {
    expect(parseRequestLines("Автомат ВА47-29 1P 16А Sirius")[0].quantity).toBeNull();
  });
  it("rejects oversized input instead of silently dropping request rows or variant text", () => {
    expect(() => parseRequestLines(Array(201).fill("Кабель;2;м").join("\n"))).toThrow("до 200");
    expect(() => parseRequestLines("К".repeat(2001))).toThrow("2000");
  });
  it("normalizes casing and decimal comma without discarding electrical parameters", () => {
    expect(normalizeCatalogText("  SIRIUS 4,5 кА ")).toBe("sirius 4.5 ка");
    expect(normalizeCatalogText("ВА 47-100 3P")).not.toBe(normalizeCatalogText("ВА 47-29 1P"));
  });
  it("never marks a conflicting model/current as an exact article-and-brand match", () => {
    const wrong = offer({ id: "supplier:wrong", productId: "supplier:wrong", name: "Автомат ВА47-29 1P 32А C 4,5кА Sirius" });
    const ranked = rankOffers(line(), [wrong, offer()], context);
    expect(ranked[0].offer.id).toBe("onec:1");
    const candidate = ranked.find(row => row.offer.id === wrong.id)!;
    expect(candidate.matchKind).toBe("similar");
    expect(candidate.warnings.join(" ")).toContain("параметры");
  });
  it("prefers available own stock for otherwise equal exact matches", () => {
    const supplier = offer({ id: "supplier:1", sourceType: "supplier", sourceId: "supplier:ct1", sourceName: "CT1", delivery: ct1 });
    expect(rankOffers(line(), [supplier, offer()], context)[0].offer.sourceType).toBe("warehouse");
  });
  it("does not use a same-name foreign brand as an exact match", () => {
    expect(rankOffers(line(), [offer({ brand: "Other" })], context)[0].matchKind).toBe("similar");
  });
  it("keeps spaces around Cyrillic model and unit parts from causing a false parameter conflict", () => {
    const candidate = rankOffers(line({ query: "Автомат ВА 47-29 1P 16 А C 4,5 кА Sirius" }), [offer()], context)[0];
    expect(candidate.matchKind).toBe("article_brand");
    expect(candidate.warnings.join(" ")).not.toContain("параметры");
  });
  it("brings in an alternate supplier identifier only through the confirmed common product identity", () => {
    const supplier = offer({ id: "ct1:2", productId: "onec:1", name: "Выключатель C16 Sirius", article: "006020", onecCode: "", sourceType: "supplier", delivery: ct1 });
    const unrelated = offer({ ...supplier, id: "ct1:3", productId: "ct1:3" });
    const ranked = rankOffers(line(), [supplier, unrelated, offer()], context);
    expect(ranked.find(item => item.offer.id === supplier.id)?.matchKind).toBe("confirmed_link");
    expect(ranked.find(item => item.offer.id === unrelated.id)?.matchKind).toBe("similar");
    expect(ranked.find(item => item.offer.id === supplier.id)?.warnings.join(" ")).toContain("подтверждённой связи");
  });
});

describe("delivery dates in business timezone", () => {
  it("accepts CT1 Friday before 15:00 and rolls to following Wednesday at the cutoff", () => {
    expect(nextDeliveryDate(ct1, "2026-10-23T09:59:59Z")).toBe("2026-10-28");
    expect(nextDeliveryDate(ct1, "2026-10-23T10:00:00Z")).toBe("2026-11-04");
  });
  it("chooses the first eligible Russian Svet delivery window", () => {
    const russianSvet: Delivery = { ...ct1, windows: [{ deliveryWeekday: 3, cutoffWeekday: 1, cutoffTime: "12:00" }, { deliveryWeekday: 5, cutoffWeekday: 3, cutoffTime: "12:00" }] };
    expect(nextDeliveryDate(russianSvet, "2026-10-26T06:59:59Z")).toBe("2026-10-28");
    expect(nextDeliveryDate(russianSvet, "2026-10-26T07:00:00Z")).toBe("2026-10-30");
    expect(nextDeliveryDate(russianSvet, "2026-10-28T07:00:00Z")).toBe("2026-11-04");
  });
  it("uses the local calendar day across UTC midnight and leaves incomplete policies unknown", () => {
    expect(nextDeliveryDate(delivery, "2026-10-27T20:00:00Z")).toBe("2026-10-28");
    expect(nextDeliveryDate({ ...ct1, windows: [] }, NOW)).toBeNull();
    expect(nextDeliveryDate({ ...ct1, type: "unknown", windows: [] }, NOW)).toBeNull();
  });
});

describe("quotation finance and inventory", () => {
  it("calculates 20% margin on net revenue, not the 25% markup", () => {
    const result = evaluate();
    expect(result.status).toBe("ready");
    expect(result.totals).toMatchObject({ revenueNet: 2500, purchaseNet: 2000, shippingNet: 0, profitNet: 500, marginPercent: 20, complete: true });
    expect(result.lines[0].allocations[0].salePriceSource).toBe("retail");
  });
  it("rounds line totals after VAT conversion rather than rounding each unit prematurely", () => {
    const product = offer(); product.prices.purchase!.amount = 1.01; product.quantity = 100; product.prices.retail!.amount = 1.16;
    const result = evaluate(product, { quantity: 100, allocations: [allocation({ quantity: 100 })] });
    expect(result.totals.purchaseNet).toBe(87.07); expect(result.totals.revenueNet).toBe(100); expect(result.totals.profitNet).toBe(12.93);
  });
  it("keeps the full margin unknown when shipping is unknown, but explains goods margin", () => {
    const product = offer({ sourceType: "supplier", sourceId: "supplier:ct1", delivery: { ...ct1, shippingCost: null } });
    const result = evaluate(product);
    expect(result.totals.goodsMarginPercent).toBe(20); expect(result.totals.shippingNet).toBeNull(); expect(result.totals.profitNet).toBeNull(); expect(result.totals.complete).toBe(false);
  });
  it("uses an explicitly entered net delivery expense in both profit and margin", () => {
    const result = evaluate(offer(), { allocations: [allocation({ shippingCost: 100 })] });
    expect(result.totals).toMatchObject({ goodsProfitNet: 500, profitNet: 400, marginPercent: 16 });
  });
  it("does not invent a retail price from purchase price or wholesale price", () => {
    const product = offer(); product.prices.retail = null; product.prices.wholesale = { ...product.prices.purchase!, amount: 1300 };
    const result = evaluate(product);
    expect(result.lines[0].allocations[0].unitSalePrice).toBeNull(); expect(result.totals.revenueNet).toBeNull(); expect(result.status).toBe("incomplete");
  });
  it("uses an explicit target margin with known cost, shipping and sale VAT", () => {
    const product = offer(); product.prices.retail = null;
    const result = evaluate(product, { targetMarginPercent: 20, allocations: [allocation({ shippingCost: 200 })] });
    expect(result.lines[0].allocations[0]).toMatchObject({ unitSalePrice: 1595, salePriceSource: "target_margin" });
    expect(result.totals).toMatchObject({ revenueNet: 2750, purchaseNet: 2000, shippingNet: 200, profitNet: 550, marginPercent: 20 });
  });
  it("requires explicit confirmation before filling missing purchase VAT", () => {
    const product = offer(); product.prices.purchase!.vatRate = null;
    expect(evaluate(product, { allocations: [allocation({ purchaseVatRate: 16, purchaseVatConfirmed: false })] }).totals.purchaseNet).toBeNull();
    const confirmed = evaluate(product, { allocations: [allocation({ purchaseVatRate: 16, purchaseVatIncluded: true, purchaseVatConfirmed: true })] });
    expect(confirmed.status).toBe("ready"); expect(confirmed.totals.purchaseNet).toBe(2000); expect(confirmed.warnings.join(" ")).toContain("явно подтверждён");
  });
  it("does not silently override known source VAT", () => {
    const result = evaluate(offer(), { allocations: [allocation({ purchaseVatRate: 0, purchaseVatIncluded: true, purchaseVatConfirmed: true })] });
    expect(result.totals.purchaseNet).toBe(2000); expect(result.status).toBe("needs_review"); expect(result.warnings.join(" ")).toContain("противоречит");
  });
  it("retains the source retail VAT when a conflicting form value is supplied", () => {
    const result = evaluate(offer(), { allocations: [allocation({ saleVatRate: 0 })] });
    expect(result.totals.revenueNet).toBe(2500); expect(result.status).toBe("needs_review");
    expect(result.warnings.join(" ")).toContain("НДС розничной цены противоречит");
  });
  it("refuses foreign-currency purchase arithmetic and does not report a partial total", () => {
    const product = offer(); product.prices.purchase!.currency = "USD";
    const result = evaluate(product);
    expect(result.totals.purchaseNet).toBeNull(); expect(result.totals.profitNet).toBeNull(); expect(result.status).toBe("incomplete");
  });
  it("counts same-offer allocations across all request rows before checking stock", () => {
    const product = offer({ quantity: 5 });
    const result = evaluateQuote({ lines: [line({ quantity: 3, allocations: [allocation({ quantity: 3 })] }), line({ id: "line-2", quantity: 3, allocations: [allocation({ quantity: 3 })] })] }, [product], context);
    expect(result.status).toBe("needs_review"); expect(result.lines.every(row => row.allocations[0].warnings.some(text => text.includes("Суммарно")))).toBe(true);
  });
  it("allows a confirmed split between own stock and a supplier", () => {
    const own = offer({ quantity: 2 }), supplier = offer({ id: "ct1:1", sourceType: "supplier", sourceId: "supplier:ct1", quantity: 10, delivery: ct1 });
    const result = evaluateQuote(quote({ quantity: 5, allocations: [allocation(), allocation({ offerId: supplier.id, quantity: 3 })] }), [own, supplier], context);
    expect(result.lines[0].allocatedQuantity).toBe(5); expect(result.lines[0].shortageQuantity).toBe(0); expect(result.status).toBe("ready");
  });
  it("accepts confirmed canonical identity with alternate naming but still blocks a mismatching unit", () => {
    const supplier = offer({ id: "ct1:2", productId: "onec:1", name: "Выключатель C16 Sirius", article: "006020", onecCode: "", sourceType: "supplier", delivery: ct1 });
    const draft = quote({ allocations: [allocation({ offerId: supplier.id })] });
    expect(evaluateQuote(draft, [offer(), supplier], context).status).toBe("ready");
    expect(evaluateQuote(draft, [offer(), { ...supplier, unit: "уп" }], context).status).toBe("needs_review");
    expect(evaluateQuote(quote({ allocations: [allocation({ offerId: supplier.id, confirmed: false })] }), [offer(), supplier], context).status).toBe("needs_review");
  });
  it("reports an uncovered quantity and keeps the quotation incomplete", () => {
    const result = evaluate(offer(), { quantity: 5 });
    expect(result.lines[0].shortageQuantity).toBe(3); expect(result.totals.complete).toBe(false); expect(result.status).toBe("incomplete");
  });
  it("blocks known unit mismatch even with a same-unit override", () => {
    const result = evaluate(offer({ unit: "уп" }), { allocations: [allocation({ confirmedUnit: "шт" })] });
    expect(result.status).toBe("needs_review"); expect(result.warnings.join(" ")).toContain("Единицы заявки");
  });
  it("permits a missing source unit only when explicitly confirmed in requested units", () => {
    expect(evaluate(offer({ unit: "" })).status).toBe("needs_review");
    expect(evaluate(offer({ unit: "" }), { allocations: [allocation({ confirmedUnit: "шт" })] }).status).toBe("ready");
  });
  it("requires review for stale or test data even if all arithmetic is complete", () => {
    expect(evaluate(offer({ updatedAt: "2026-10-25T10:00:00Z" })).status).toBe("needs_review");
    expect(evaluateQuote(quote(), [offer()], { ...context, environment: "test" }).status).toBe("needs_review");
    expect(evaluateQuote(quote(), [offer()], { ...context, environment: "unknown" }).status).toBe("needs_review");
    const product = offer(); product.prices.purchase!.updatedAt = "2026-10-25T10:00:00Z";
    expect(evaluate(product).status).toBe("needs_review");
    expect(evaluate(offer({ quantity: null, available: null, stockConfirmed: false })).status).toBe("needs_review");
  });
  it("requires review when an individual source price timestamp is implausibly in the future", () => {
    const product = offer(); product.prices.purchase!.updatedAt = "2026-10-28T10:00:00Z";
    expect(evaluate(product).warnings.join(" ")).toContain("Дата закупочной цены находится в будущем");
    product.prices.purchase!.updatedAt = NOW; product.prices.retail!.updatedAt = "2026-10-28T10:00:00Z";
    expect(evaluate(product).status).toBe("needs_review");
    expect(evaluate(product).warnings.join(" ")).toContain("Дата розничной цены находится в будущем");
  });
  it("marks precision overflow as incomplete rather than emitting unsafe financial totals", () => {
    const product = offer({ quantity: 1_000_000 }); product.prices.purchase!.amount = 1_000_000_000; product.prices.retail!.amount = 1_000_000_000;
    const result = evaluate(product, { quantity: 1_000_000, allocations: [allocation({ quantity: 1_000_000 })] });
    expect(result.status).toBe("incomplete"); expect(result.totals.purchaseNet).toBeNull(); expect(result.warnings.join(" ")).toContain("точность расчёта");
  });
  it("keeps unconfirmed selections and a missed delivery deadline in review", () => {
    expect(evaluate(offer(), { allocations: [allocation({ confirmed: false })] }).status).toBe("needs_review");
    expect(evaluate(offer({ sourceType: "supplier", delivery: ct1 }), { requiredBy: "2026-10-28" }).warnings.join(" ")).toContain("позже требуемого");
  });
  it("detects a missing selected offer rather than trusting the client's quoted values", () => {
    const result = evaluateQuote(quote(), [], context);
    expect(result.lines[0].allocations[0].offer).toBeNull(); expect(result.totals.profitNet).toBeNull(); expect(result.status).toBe("incomplete");
  });
});
