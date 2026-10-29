import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applySupplierUpdates } from "./supplier-sync-plan";
import type { CatalogOffer } from "./catalog-selection";
const fixture = process.env.MICHAEL_CATALOG_FIXTURE;
describe.skipIf(!fixture)("real private supplier baseline",()=>{
 it("updates a supplier offer without changing warehouse or product metadata",()=>{
  const data=JSON.parse(readFileSync(fixture!,"utf8")) as {offers:CatalogOffer[]};
  const prior=data.offers.find(o=>o.sourceType==="supplier" && o.sourceId==="supplier:220volt" && o.prices.purchase?.amount && o.quantity!==null)!;
  const own=data.offers.find(o=>o.sourceType==="warehouse")!;
  expect(prior).toBeTruthy(); expect(own).toBeTruthy();
  const observed="2026-10-30T10:00:00.000Z";
  const candidate={id:prior.id,sourceId:prior.sourceId,quantity:prior.quantity,available:prior.available,stockConfirmed:prior.stockConfirmed,updatedAt:observed,prices:{...prior.prices,purchase:{...prior.prices.purchase!,amount:prior.prices.purchase!.amount+1,updatedAt:observed}}};
  const result=applySupplierUpdates([prior,own],new Map([[candidate.id,candidate]]));
  expect(result.offers[0].productId).toBe(prior.productId); expect(result.offers[0].name).toBe(prior.name); expect(result.offers[0].prices.purchase!.amount).toBe(prior.prices.purchase!.amount+1);expect(result.offers[1]).toBe(own);
 });
});
