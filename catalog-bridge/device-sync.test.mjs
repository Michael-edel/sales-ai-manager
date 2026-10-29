import test from 'node:test';
import assert from 'node:assert/strict';
import {synchronizeSuppliers} from './device-sync.mjs';
const at='2026-10-28T10:00:00.000Z',later='2026-10-29T10:00:00.000Z';
const offer=(id,type='supplier')=>({id,productId:id,name:id,unit:'шт',sourceId:type+':a',sourceName:'A',sourceType:type,quantity:5,available:true,stockConfirmed:true,updatedAt:at,prices:{purchase:{amount:100,currency:'KZT',vatIncluded:true,vatRate:null,updatedAt:at},retail:null,wholesale:null}});
const snapshot=(offers)=>({schemaVersion:1,sourceSystem:'michael-cabinet',exportedAt:later,offers});
function fixture(){
 let active='base',pending=null,staged=[],stagedNew=[],journalValue=null,failStage=false,loseCommit=false;
 const pages=[{index:0,offers:[offer('supplier:1'),offer('warehouse:1','warehouse')]},{index:1,offers:[offer('supplier:2')]}],calls=[];
 const journal={read:async()=>journalValue,write:async x=>{journalValue=x;},clear:async()=>{journalValue=null;}};
 const request=async(method,path,body)=>{calls.push([method,path]);
  if(path==='status')return {active:{id:active,storage_version:2,expected_count:pages.reduce((n,p)=>n+p.offers.length,0)}};
  if(path.startsWith('pages?'))return {indexes:pages.map(p=>p.index)};
  if(path.startsWith('pages/'))return structuredClone(pages.find(p=>p.index===Number(path.match(/pages\/(\d+)/)[1])));
  if(path==='runs'){pending={id:'run-1',baseId:active};return pending;}
  if(path.endsWith('/abort')){pending=null;staged=[];stagedNew=[];return {ok:true};}
  if(path.endsWith('/commit')){active=pending.id;for(const [index,updates] of staged)for(const update of updates)Object.assign(pages[index].offers.find(o=>o.id===update.id),update);for(const [index,offers] of stagedNew)pages.push({index,offers});if(loseCommit){loseCommit=false;throw Error('connection lost');}return {ok:true};}
  if(path.includes('/new-pages/')){const index=Number(path.split('/').at(-1));stagedNew=stagedNew.filter(x=>x[0]!==index);stagedNew.push([index,body.offers]);return {ok:true};}
  if(path.includes('/pages/')){if(failStage){failStage=false;throw Error('connection lost');}const index=Number(path.split('/').at(-1));staged=staged.filter(x=>x[0]!==index);staged.push([index,body.updates]);return {ok:true};}
  throw Error('unexpected request');
 };
 return {request,journal,calls,pages,failStage:()=>{failStage=true;},loseCommit:()=>{loseCommit=true;},pending:()=>journalValue};
}
test('no-op makes no cloud revision',async()=>{const f=fixture(),out=await synchronizeSuppliers({request:f.request,journal:f.journal,snapshot:snapshot(f.pages.flatMap(p=>p.offers))});assert.equal(out.changed,0);assert.equal(f.calls.some(c=>c[0]!=='GET'),false);});
test('updates only supplier differences, handles lost commit reply, preserves own stock',async()=>{const f=fixture(),next=structuredClone(f.pages.flatMap(p=>p.offers));next[0].quantity=9;next[0].updatedAt=later;next[0].prices.purchase.amount=120;next[0].prices.purchase.updatedAt=later;next[1].quantity=99;f.loseCommit();const out=await synchronizeSuppliers({request:f.request,journal:f.journal,snapshot:snapshot(next)});assert.equal(out.changed,1);assert.equal(out.pages,1);assert.equal(f.pages[0].offers[0].prices.purchase.amount,120);assert.equal(f.pages[0].offers[1].quantity,5);assert.equal(f.pending(),null);});
test('retries a staged run without creating a second revision',async()=>{const f=fixture(),next=structuredClone(f.pages.flatMap(p=>p.offers));next[0].quantity=6;next[0].updatedAt=later;f.failStage();await assert.rejects(synchronizeSuppliers({request:f.request,journal:f.journal,snapshot:snapshot(next)}));assert.equal(f.pending().id,'run-1');await synchronizeSuppliers({request:f.request,journal:f.journal,snapshot:snapshot(next)});assert.equal(f.calls.filter(c=>c[1]==='runs').length,1);});
test('cleans an abandoned run when the observed changes disappear',async()=>{const f=fixture(),next=structuredClone(f.pages.flatMap(p=>p.offers));next[0].quantity=6;next[0].updatedAt=later;f.failStage();await assert.rejects(synchronizeSuppliers({request:f.request,journal:f.journal,snapshot:snapshot(next)}));const unchanged=structuredClone(f.pages.flatMap(p=>p.offers));const result=await synchronizeSuppliers({request:f.request,journal:f.journal,snapshot:snapshot(unchanged)});assert.equal(result.changed,0);assert.equal(f.pending(),null);assert.equal(f.calls.some(c=>c[1].endsWith('/abort')),true);});
test('reuses the unchanged baseline in memory and refreshes it after a committed revision',async()=>{const f=fixture(),cache={},next=structuredClone(f.pages.flatMap(p=>p.offers));await synchronizeSuppliers({request:f.request,journal:f.journal,snapshot:snapshot(next),cache});const reads=f.calls.filter(c=>c[1].startsWith('pages')).length;await synchronizeSuppliers({request:f.request,journal:f.journal,snapshot:snapshot(next),cache});assert.equal(f.calls.filter(c=>c[1].startsWith('pages')).length,reads);next[0].quantity=7;next[0].updatedAt=later;await synchronizeSuppliers({request:f.request,journal:f.journal,snapshot:snapshot(next),cache});const after=await synchronizeSuppliers({request:f.request,journal:f.journal,snapshot:snapshot(next),cache});assert.equal(after.changed,0);assert.equal(f.calls.filter(c=>c[1].startsWith('pages')).length,reads);});
test('adds new products with a valid warehouse link and flags incompatible units',async()=>{const f=fixture(),next=structuredClone(f.pages.flatMap(p=>p.offers));next.push(offer('supplier:3'),{...offer('supplier:4'),productId:'warehouse:1'},{...offer('supplier:5'),productId:'warehouse:1',unit:'м'});const out=await synchronizeSuppliers({request:f.request,journal:f.journal,snapshot:snapshot(next)});assert.equal(out.added,2);assert.equal(out.pendingAdded,1);assert.equal(f.pages.at(-1).offers[0].id,'supplier:3');});
