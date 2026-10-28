import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAiCatalogSnapshot} from './export.mjs';

const stamp = '2026-10-27T08:00:00.000Z';
const zero = '00000000-0000-0000-0000-000000000000';
const ref = '12345678-1234-1234-1234-1234567890ab';
const stockMeta = {warehouseKey:'1fa50cd4-9962-11e7-9a36-4c72b98ae351',warehouseName:'Экибастуз',period:'2026-10-27T13:00:00',timeZoneId:'Asia/Almaty',fetchedAt:stamp};
function warehouse() {
  return {id:'warehouse%3Aonec-nkt:' + ref,externalId:ref,sourceId:'warehouse:onec-nkt',sourceName:'1С · тестовая база',sourceType:'warehouse',
    name:'Выключатель Sirius',sku:'000123',onecArticle:'006096',brand:'SIRIUS',stock:12,available:true,onecListed:true,onecFetchedAt:stamp,
    updatedAt:stamp,currency:'KZT',details:{baseUnit:'шт'},onecStock:{...stockMeta},
    onecPricing:{complete:true,register:'ЦеныНоменклатуры',entitySet:'InformationRegister_ЦеныНоменклатуры_RecordType',currency:'KZT',currencyKey:'bedb6964-9780-11e7-9a35-4c72b98ae351',period:stockMeta.period,timeZoneId:stockMeta.timeZoneId,fetchedAt:stamp,
      columns:[['purchase','c5b7c90b-9e90-11e7-9a37-4c72b98ae351'],['wholesale','c5b7c90e-9e90-11e7-9a37-4c72b98ae351'],['retail','c5b7c90d-9e90-11e7-9a37-4c72b98ae351']].map(([slot,refKey])=>({slot,refKey,includesVat:true}))},
    onecPrices:['purchase','wholesale','retail'].map((slot,i)=>({slot,amount:100+i*20,characteristicKey:zero,packagingKey:zero,packagingName:null,period:stockMeta.period}))};
}
function supplier(overrides={}) { return {id:'supplier:ct1:lamp',sourceId:'supplier:svetotehnika-1',sourceName:'Светотехника-1',sourceType:'supplier',name:'Выключатель Sirius',sku:'006096',brand:'Sirius',currency:'KZT',stock:5,available:true,supplierPurchasePrice:90,price:null,retailPrice:null,updatedAt:stamp,details:{baseUnit:'шт'},...overrides}; }
const run = (products, extra={}) => buildAiCatalogSnapshot({products,suppliers:[],...extra},{exportedAt:stamp});

test('whitelist excludes secrets, customers, raw sources and mapping evidence without changing input', () => {
  const a=warehouse(),b=supplier({apiKey:'secret-supplier',details:{baseUnit:'шт',description:'private-description',images:['secret-url']},raw:{token:'secret-raw'}});
  const state={products:[a,b],suppliers:[{id:b.sourceId,name:'Светотехника-1',apiKey:'secret-key'}],settings:{password:'secret-password'},leads:[{name:'private-client'}],pins:[{title:'private-pin'}],matching:{links:[{ownId:a.id,offerId:b.id,confirmed:true,unitConfirmed:true,evidence:'private-evidence'}]}};
  const before=JSON.stringify(state),result=buildAiCatalogSnapshot(state,{exportedAt:stamp}),serialized=JSON.stringify(result);
  assert.equal(JSON.stringify(state),before);
  assert.doesNotMatch(serialized,/secret-|private-|apiKey|password|evidence|description|images/);
  assert.deepEqual(Object.keys(result),['schemaVersion','sourceSystem','exportedAt','environment','offers']);
  assert.equal(result.offers[1].productId,a.id);
  assert.equal(result.offers[1].id,b.id);
});

test('only explicit product AND unit confirmation groups offers; lookalike article/brand is insufficient', () => {
  const a=warehouse(),b=supplier(),c=supplier({id:'another:offer'});
  for (const flags of [{confirmed:false,identityMatched:true,unitConfirmed:false},{confirmed:true,unitConfirmed:false}]) {
    assert.equal(run([a,b],{matching:{links:[{ownId:a.id,offerId:b.id,...flags}]}}).offers[1].productId,b.id);
  }
  assert.equal(run([a,b,c],{matching:{links:[{ownId:a.id,offerId:b.id,confirmed:true,unitConfirmed:true}]}}).offers[2].productId,c.id);
  const edited=supplier({detailsOverrides:{baseUnit:'м'}});
  assert.equal(run([a,edited],{matching:{links:[{ownId:a.id,offerId:edited.id,confirmed:true,unitConfirmed:true}]}}).offers[1].productId,edited.id);
  edited.detailsOverrides.baseUnit='штук';
  assert.equal(run([a,edited],{matching:{links:[{ownId:a.id,offerId:edited.id,confirmed:true,unitConfirmed:true}]}}).offers[1].productId,a.id);
  const d={...warehouse(),id:'warehouse%3Aonec-nkt:22345678-1234-1234-1234-1234567890ab',externalId:'22345678-1234-1234-1234-1234567890ab'};
  assert.throws(()=>run([a,d,b],{matching:{links:[a,d].map(p=>({ownId:p.id,offerId:b.id,confirmed:true,unitConfirmed:true}))}}),/противоречивые/);
});

test('test 1C stays test, physical quantity is separate, code never replaces article, taxes are not guessed', () => {
  const a=warehouse(),result=buildAiCatalogSnapshot({products:[a],suppliers:[]},{exportedAt:stamp,environment:'live'}),offer=result.offers[0];
  assert.equal(result.environment,'test');
  assert.equal(offer.onecCode,'000123'); assert.equal(offer.article,'006096');
  assert.equal(offer.quantity,12); assert.equal(offer.stockConfirmed,true); assert.match(offer.delivery.notes,/резерв/);
  assert.deepEqual(offer.prices.purchase,{amount:100,currency:'KZT',vatIncluded:true,vatRate:null,updatedAt:stamp});
  assert.equal(offer.prices.wholesale.amount,120); assert.equal(offer.prices.retail.amount,140);
  const outdated={...a,onecListed:false};
  assert.equal(run([outdated]).offers[0].quantity,null); assert.equal(run([outdated]).offers[0].prices.purchase,null);
});

test('one package/characteristic price and mixed snapshot proof are not quoted as a base-unit purchase', () => {
  const a=warehouse(); a.onecPrices[0].packagingKey=ref; a.onecPrices[0].packagingName='Коробка 20 шт';
  assert.equal(run([a]).offers[0].prices.purchase,null);
  a.onecPrices[0].packagingKey=zero; a.onecPrices[0].packagingName=null; a.onecPrices[0].characteristicKey=ref;
  assert.equal(run([a]).offers[0].prices.purchase,null);
  a.onecPrices[0].characteristicKey=zero; a.onecPricing.fetchedAt='2026-10-26T08:00:00.000Z';
  assert.equal(run([a]).offers[0].prices.purchase,null);
});

test('manual edits take priority but do not invent VAT or turn product names into articles', () => {
  const a=supplier({sku:'Выключатель Sirius',externalId:'Выключатель Sirius',name:'Изменённое имя',retailPrice:150,detailsOverrides:{baseUnit:'м'}});
  const offer=run([a]).offers[0];
  assert.equal(offer.name,'Изменённое имя'); assert.equal(offer.article,''); assert.equal(offer.unit,'м');
  assert.equal(offer.prices.purchase.amount,90); assert.equal(offer.prices.purchase.vatIncluded,true);
  assert.equal(offer.prices.retail.amount,150); assert.equal(offer.prices.retail.vatIncluded,null);
  a.detailsOverrides.baseUnit=''; assert.equal(run([a]).offers[0].unit,'');
  const p=supplier({brand:'038e0228-c69c-11ef-b720-28e424caa461',name:'Лампа',details:{}});
  assert.equal(run([p]).offers[0].brand,''); assert.equal(run([p]).offers[0].unit,'');
  assert.equal(run([supplier({brand:'SIRIUS'})]).offers[0].brand,'Sirius');
  assert.equal(run([supplier({sourceId:'supplier:elco',sku:'72',externalId:'72'})]).offers[0].article,'');
});

test('only known delivery rules exported; unknown cutoffs and source prices remain unknown', () => {
  const [ct,volt,elco]=run([supplier(),supplier({id:'volt',sourceId:'supplier:220volt'}),supplier({id:'elco',sourceId:'supplier:elco',supplierPurchasePrice:null,stock:null,available:true})]).offers;
  assert.deepEqual(ct.delivery.windows,[{deliveryWeekday:3,cutoffWeekday:5,cutoffTime:'15:00'}]); assert.equal(ct.delivery.shippingCost,0);
  assert.equal(volt.delivery.type,'unknown'); assert.deepEqual(volt.delivery.windows,[]); assert.equal(volt.delivery.shippingCost,0);
  assert.equal(elco.delivery.type,'unknown'); assert.equal(elco.delivery.shippingCost,null);
  assert.equal(elco.prices.purchase,null); assert.equal(elco.prices.retail,null); assert.equal(elco.stockConfirmed,false); assert.equal(elco.quantity,null);
});

test('explicit supplier base-unit attributes are exported without inferring package units or product links', () => {
  const fromSite = supplier({details:{baseUnit:'',attributes:[{name:'Базовая единица',value:'шт'},{name:'Вложение',value:'12'}]}});
  const before = JSON.stringify(fromSite), result = run([fromSite]).offers[0];
  assert.equal(result.unit,'шт'); assert.equal(result.productId,fromSite.id);
  assert.equal(JSON.stringify(fromSite),before);
  assert.equal(run([supplier({details:{attributes:[{name:'  БАЗОВАЯ   ЕДИНИЦА: ',value:'шт.'},{name:'Базовая единица',value:'штук'}]}})]).offers[0].unit,'шт.');
  assert.equal(run([supplier({details:{attributes:[{name:'Базовая единица',value:'шт'},{name:'Базовая единица',value:'м'}]}})]).offers[0].unit,'');
  assert.equal(run([supplier({name:'Выключатель 12 шт',details:{attributes:[{name:'Вложение',value:'12'},{name:'Количество в упаковке',value:'12 шт'},{name:'Базовая единица',value:'Не указано'}]}})]).offers[0].unit,'');
});

test('manual base-unit and attribute overrides take precedence over supplier attribute fallback', () => {
  const product = supplier({details:{baseUnit:'',attributes:[{name:'Базовая единица',value:'шт'}]},detailsOverrides:{baseUnit:'м'}});
  assert.equal(run([product]).offers[0].unit,'м');
  product.detailsOverrides.baseUnit=''; assert.equal(run([product]).offers[0].unit,'');
  product.detailsOverrides={attributes:[{name:'Базовая единица',value:'компл'}]}; assert.equal(run([product]).offers[0].unit,'компл');
  product.detailsOverrides.attributes=[]; assert.equal(run([product]).offers[0].unit,'');
  product.detailsOverrides={}; product.details.baseUnit='уп'; assert.equal(run([product]).offers[0].unit,'уп');
});

test('removed sources excluded; stale counts unconfirmed; source timestamp wins over manual edit timestamp', () => {
  const a=supplier({updatedAt:'2026-10-27T10:00:00Z'}),b=supplier({id:'stale',sourceId:'supplier:elco',stale:true});
  const result=run([a,b],{suppliers:[{id:a.sourceId,lastImport:'2026-10-20T08:00:00.000Z'}]});
  assert.equal(result.offers[0].prices.purchase.updatedAt,'2026-10-20T08:00:00.000Z');
  assert.equal(result.offers[1].stockConfirmed,false); assert.equal(result.offers[1].quantity,null);
  assert.equal(run([a],{suppliers:[{id:a.sourceId,deletedAt:stamp}]}).offers.length,0);
});

test('long source IDs stay collision-free; duplicate IDs fail closed', () => {
  const id='supplier:svetotehnika-1:' + encodeURIComponent('я'.repeat(750));
  assert.equal(run([supplier({id})]).offers[0].id,id);
  assert.throws(()=>run([supplier(),supplier()]),/Повтор идентификатора/);
});

test('legacy unnamed source uses its code and unsupported large source numbers fail explicitly', () => {
  assert.equal(run([supplier({sourceName:''})]).offers[0].sourceName,'supplier:svetotehnika-1');
  assert.throws(()=>run([supplier({stock:1000001})]),/Остаток превышает/);
  assert.throws(()=>run([supplier({stock:1e13})]),/Остаток превышает/);
  assert.throws(()=>run([supplier({supplierPurchasePrice:1000000001})]),/Цена превышает/);
  assert.throws(()=>run([supplier({retailPrice:1000000001})]),/Цена превышает/);
  assert.equal(run([supplier({stock:1000000,supplierPurchasePrice:1000000000})]).offers[0].prices.purchase.amount,1000000000);
});
