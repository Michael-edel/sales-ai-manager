import { describe,expect,it } from "vitest";
import { applySupplierUpdates } from "./supplier-sync-plan";
import type { CatalogOffer } from "./catalog-selection";
const at="2026-10-28T10:00:00.000Z", later="2026-10-29T10:00:00.000Z";
const offer:CatalogOffer={id:"a",productId:"linked",name:"manual-name",article:"A",brand:"Brand",onecCode:"",unit:"шт",sourceId:"supplier:a",sourceName:"supplier",sourceType:"supplier",warehouseName:"",quantity:3,available:true,stockConfirmed:true,updatedAt:at,prices:{purchase:{amount:100,currency:"KZT",vatIncluded:true,vatRate:null,updatedAt:at},wholesale:null,retail:null},delivery:{type:"unknown",timezone:"Asia/Almaty",windows:[],shippingCost:null,notes:""}};
const change={id:"a",sourceId:"supplier:a",quantity:5,available:true,stockConfirmed:true,updatedAt:later,prices:{purchase:{amount:120,currency:"KZT",vatIncluded:true,vatRate:null,updatedAt:later},wholesale:null,retail:null}};
describe("supplier price and quantity update plan",()=>{
 it("preserves all product and confirmed-link metadata",()=>{const result=applySupplierUpdates([offer],new Map([["a",change]])); expect(result.applied).toEqual(["a"]);expect(result.offers[0]).toMatchObject({id:"a",productId:"linked",name:"manual-name",quantity:5,prices:{purchase:{amount:120}}});expect(offer.quantity).toBe(3);});
 it("never mutates an own-stock offer or crosses suppliers",()=>{expect(()=>applySupplierUpdates([{...offer,sourceType:"warehouse"}],new Map([["a",change]]))).toThrow();expect(()=>applySupplierUpdates([offer],new Map([["a",{...change,sourceId:"supplier:b"}]]))).toThrow();});
 it("rejects stale and unvalidated fields",()=>{expect(()=>applySupplierUpdates([offer],new Map([["a",{...change,updatedAt:"2026-10-01T00:00:00Z"}]]))).toThrow();expect(()=>applySupplierUpdates([offer],new Map([["a",{...change,name:"overwrite"}]]))).toThrow();expect(()=>applySupplierUpdates([offer],new Map([["a",{...change,quantity:-10}]]))).toThrow();});
});
