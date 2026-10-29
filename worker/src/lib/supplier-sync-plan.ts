import { validateCatalogOffer, type CatalogOffer } from "./catalog-selection";

/** Private candidate pages only. Callers must authenticate, check the active
 * snapshot identity, and atomically activate every affected page. */
export type SupplierUpdate = Pick<CatalogOffer, "id" | "sourceId" | "quantity" | "available" | "stockConfirmed" | "updatedAt" | "prices">;
export function applySupplierUpdates(page: CatalogOffer[], updates: Map<string, SupplierUpdate>): { offers: CatalogOffer[]; applied: string[] } {
  const applied: string[] = [];
  const offers = page.map(previous => {
    const update = updates.get(previous.id);
    if (!update) return previous;
    if (update.id !== previous.id) throw new Error("Идентификатор товара не совпадает.");
    if (previous.sourceType !== "supplier" || previous.sourceId !== update.sourceId) throw new Error("Источник товара не совпадает.");
    if (Object.keys(update).some(key => !["id","sourceId","quantity","available","stockConfirmed","updatedAt","prices"].includes(key))) throw new Error("Недопустимое поле обновления.");
    const priorTime = previous.updatedAt ? Date.parse(previous.updatedAt) : null;
    const updateTime = update.updatedAt ? Date.parse(update.updatedAt) : null;
    if (priorTime !== null && (updateTime === null || !Number.isFinite(updateTime) || updateTime < priorTime)) throw new Error("Старые данные не могут заменить более новые.");
    for (const slot of ["purchase", "wholesale", "retail"] as const) {
      const oldPrice = previous.prices[slot], newPrice = update.prices?.[slot];
      if (oldPrice?.updatedAt && newPrice && (!newPrice.updatedAt || Date.parse(newPrice.updatedAt) < Date.parse(oldPrice.updatedAt))) throw new Error("Дата цены источника стала старше.");
    }
    if (update.stockConfirmed && (update.quantity === null || !update.updatedAt)) throw new Error("Нет подтверждения остатка.");
    if (update.quantity !== null && update.available !== null && update.available !== (update.quantity > 0)) throw new Error("Остаток и доступность противоречат друг другу.");
    const result = validateCatalogOffer({ ...previous, quantity:update.quantity, available:update.available, stockConfirmed:update.stockConfirmed, updatedAt:update.updatedAt, prices:update.prices });
    applied.push(previous.id);
    return result;
  });
  return {offers, applied};
}
