import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planSupplierDelta} from './supplier-delta.mjs';
const at='2026-10-28T10:00:00.000Z', next='2026-10-29T10:00:00.000Z';
const price=(amount,time=at)=>({amount,currency:'KZT',vatIncluded:true,vatRate:null,updatedAt:time});
const item=(id,sourceId='supplier:a',changes={})=>({id,sourceId,sourceType:'supplier',quantity:3,available:true,stockConfirmed:true,updatedAt:at,prices:{purchase:price(100),wholesale:null,retail:null},...changes});
const snapshot=offers=>({schemaVersion:1,sourceSystem:'michael-cabinet',environment:'test',exportedAt:next,offers});
test('exact source identity: change prices and stock; never alter own warehouse',()=>{
 const base=snapshot([item('a'),item('w','warehouse:onec',{sourceType:'warehouse'})]);
 const latest=snapshot([item('a','supplier:a',{quantity:8,updatedAt:next,prices:{purchase:price(120,next),wholesale:null,retail:null}}),item('w','warehouse:onec',{sourceType:'warehouse',quantity:100})]);
 const before=JSON.stringify([base,latest]);const plan=planSupplierDelta(base,latest);
 assert.equal(plan.changes.length,1);assert.equal(plan.changes[0].prices.purchase.amount,120);assert.equal(plan.changes[0].quantity,8);assert.equal(JSON.stringify([base,latest]),before);
});
test('missing and new supplier records are explicit and never treated as deletions',()=>{
 const plan=planSupplierDelta(snapshot([item('old')]),snapshot([item('new')]));
 assert.deepEqual(plan.missing,[{id:'old',sourceId:'supplier:a'}]);assert.deepEqual(plan.added,[{id:'new',sourceId:'supplier:a'}]);assert.equal(plan.changes.length,0);
});
test('reject duplicate or mismatched identities and older source data',()=>{
 assert.throws(()=>planSupplierDelta(snapshot([item('a'),item('a')]),snapshot([])),/Повтор/);
 assert.throws(()=>planSupplierDelta(snapshot([item('a')]),snapshot([item('a','supplier:b')])),/Источник/);
 const plan=planSupplierDelta(snapshot([item('a','supplier:a',{updatedAt:next})]),snapshot([item('a','supplier:a',{quantity:8})]));
 assert.equal(plan.changes.length,0);assert.equal(plan.older.length,1);
});
test('unconfirmed quantities remain unknown and equal data do not generate changes',()=>{
 const base=snapshot([item('a')]);assert.equal(planSupplierDelta(base,base).changes.length,0);
 const incoming=item('a','supplier:a',{quantity:null,available:null,stockConfirmed:false,updatedAt:next});
 const change=planSupplierDelta(base,snapshot([incoming])).changes[0];assert.equal(change.quantity,null);assert.equal(change.available,null);assert.equal(change.stockConfirmed,false);
});

test('an unchanged feed observation does not create a full new snapshot',()=>{
 const base=snapshot([item('a')]);const later=item('a','supplier:a',{updatedAt:next,prices:{purchase:price(100,next),wholesale:null,retail:null}});
 assert.equal(planSupplierDelta(base,snapshot([later])).changes.length,0);
});
