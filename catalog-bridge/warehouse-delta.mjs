// Existing production stock only. Never translate the test source or delete missing rows.
const SOURCE='warehouse:onec-work-torg2026';
const ID=/^warehouse%3Aonec-work-torg2026:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const quantity=value=>value===null||(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e6);
const price=value=>value==null?null:[value.amount,value.currency,value.vatIncluded,value.vatRate];
const content=o=>JSON.stringify([o.quantity,o.available,o.stockConfirmed,...['purchase','wholesale','retail'].map(k=>price(o.prices?.[k]))]);
function index(offers) {
 const result=new Map();
 for(const offer of offers){if(!offer||typeof offer.id!=='string'||result.has(offer.id))throw Error('Некорректные или повторные идентификаторы каталога.');result.set(offer.id,offer);}
 return result;
}
function valid(o){return o?.sourceType==='warehouse'&&o.sourceId===SOURCE&&ID.test(o.id)&&!o.id.toLowerCase().endsWith(':00000000-0000-0000-0000-000000000000')&&o.productId===o.id&&o.warehouseName==='Экибастуз';}
export function planWarehouseDelta(baseline,next){
 if(baseline?.environment!=='live'||next?.environment!=='live'||!Array.isArray(baseline.offers)||!Array.isArray(next.offers))throw Error('Рабочая база не подтверждена.');
 const before=index(baseline.offers),after=index(next.offers),changes=[],missing=[],added=[],older=[],metadataChanged=[];
 for(const [id,old] of before){
  if(old.sourceId!==SOURCE)continue;
  if(!valid(old))throw Error('Некорректный исходный товар склада.');
  const now=after.get(id);if(!now){missing.push(id);continue;}if(!valid(now))throw Error('Источник товара изменился.');
  if(['name','article','onecCode','unit'].some(key=>String(old[key]??'')!==String(now[key]??''))){metadataChanged.push(id);continue;}
  if(!quantity(now.quantity)||typeof now.stockConfirmed!=='boolean'||(now.available!==null&&typeof now.available!=='boolean')||(now.quantity!==null&&now.available!==null&&now.available!==(now.quantity>0))||(now.stockConfirmed&&(now.quantity===null||time(now.updatedAt)===null)))throw Error('Некорректный остаток склада.');
  if(content(old)===content(now))continue;
  const oldTime=time(old.updatedAt),newTime=time(now.updatedAt);if(oldTime!==null&&(newTime===null||newTime<oldTime)){older.push(id);continue;}
  for(const slot of ['purchase','wholesale','retail']){const prior=old.prices?.[slot],value=now.prices?.[slot];if(value&&(typeof value.amount!=='number'||!Number.isFinite(value.amount)||value.amount<=0||value.currency!=='KZT'))throw Error('Некорректная цена склада.');if(prior?.updatedAt&&value&&(time(value.updatedAt)===null||time(value.updatedAt)<time(prior.updatedAt)))throw Error('Дата цены стала старше.');}
  changes.push({id,sourceId:SOURCE,quantity:now.quantity,available:now.available,stockConfirmed:now.stockConfirmed,updatedAt:now.updatedAt,prices:now.prices});
 }
 for(const [id,offer] of after)if(offer.sourceId===SOURCE&&!before.has(id)){if(!valid(offer))throw Error('Некорректный новый товар склада.');added.push(id);}
 return {changes,missing,added,older,metadataChanged};
}
