import {createHash} from 'node:crypto';
import {planSupplierDelta} from './supplier-delta.mjs';

/** Network transport is deliberately injected: this module never reads or logs credentials. */
export async function synchronizeSuppliers({request, snapshot, journal, cache}) {
  if(typeof request!=='function'||!journal?.read||!journal?.write||!journal?.clear) throw new Error('Синхронизация не настроена.');
  const status=await request('GET','status');
  const active=status.active;
  if(!active?.id||active.storage_version!==2)throw new Error('Активный каталог не поддерживает обновление.');
  let pending=await journal.read();
  if(pending?.id===active.id){await journal.clear();pending=null;}
  let pages;
  if(cache?.id===active.id&&Array.isArray(cache.pages))pages=cache.pages;
  else{
    const listing=await request('GET',`pages?snapshot=${encodeURIComponent(active.id)}`);
    if(!Array.isArray(listing.indexes)||!listing.indexes.length||listing.indexes.length>10000||new Set(listing.indexes).size!==listing.indexes.length||listing.indexes.some(i=>!Number.isSafeInteger(i)||i<0))throw new Error('Некорректный список страниц.');
    pages=[];
    // Bound parallelism rather than overwhelming the free database and network.
    for(let i=0;i<listing.indexes.length;i+=4){
      const rows=await Promise.all(listing.indexes.slice(i,i+4).map(index=>request('GET',`pages/${index}?snapshot=${encodeURIComponent(active.id)}`)));
      for(const [n,row] of rows.entries()){
        const index=listing.indexes[i+n];
        if(row.index!==index||!Array.isArray(row.offers)||row.offers.length>100)throw new Error('Некорректная страница каталога.');
        pages.push(row);
      }
    }
    if(cache){cache.id=active.id;cache.pages=pages;}
  }
  const position=new Map(), offers=[];
  for(const page of pages)for(const offer of page.offers){if(position.has(offer.id))throw new Error('Повтор товара в облачном каталоге.');position.set(offer.id,page.index);offers.push(offer);}
  if(offers.length!==active.expected_count)throw new Error('Облачный каталог прочитан не полностью.');
  const plan=planSupplierDelta({schemaVersion:1,sourceSystem:'michael-cabinet',offers},snapshot);
  const groups=new Map();for(const change of plan.changes){const index=position.get(change.id);if(index===undefined)throw new Error('Не найдена страница предложения.');if(!groups.has(index))groups.set(index,[]);groups.get(index).push(change);}
  const current=new Map(snapshot.offers.map(offer=>[offer.id,offer]));
  const baselineById=new Map(offers.map(offer=>[offer.id,offer]));
  const unit=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase('ru');
  const newOffers=plan.added.map(item=>current.get(item.id)).filter(offer=>{
    if(!offer||offer.onecCode)return false;
    if(offer.productId===offer.id)return true;
    const anchor=baselineById.get(offer.productId);
    return anchor?.sourceType==='warehouse'&&unit(offer.unit)&&unit(offer.unit)===unit(anchor.unit);
  });
  const pendingAdded=plan.added.length-newOffers.length,newPages=[];
  let nextIndex=Math.max(...pages.map(page=>page.index))+1;
  for(let i=0;i<newOffers.length;i+=100){if(nextIndex>10000)throw new Error('Слишком много страниц каталога.');newPages.push([nextIndex++,newOffers.slice(i,i+100)]);}
  if(!groups.size&&!newPages.length){if(pending?.id){await request('POST',`runs/${pending.id}/abort`,{});await journal.clear();}return {changed:0,pages:0,added:0,pendingAdded,missing:plan.missing.length,older:plan.older.length,activeId:active.id};}
  const ordered=[...groups].sort((a,b)=>a[0]-b[0]);
  const fingerprint=createHash('sha256').update(JSON.stringify([active.id,ordered,newPages])).digest('hex');
  if(!pending||pending.baseId!==active.id||pending.fingerprint!==fingerprint){
    if(pending?.id){await request('POST',`runs/${pending.id}/abort`,{});await journal.clear();pending=null;}
    const run=await request('POST','runs',{baseId:active.id,expectedPages:ordered.length+newPages.length,addedCount:newOffers.length,exportedAt:snapshot.exportedAt});
    if(!run?.id||run.baseId!==active.id)throw new Error('Не удалось подготовить обновление.');
    pending={baseId:active.id,id:run.id,fingerprint};await journal.write(pending);
  }
  for(const [index,updates] of ordered)await request('PUT',`runs/${pending.id}/pages/${index}`,{updates});
  for(const [index,offers] of newPages)await request('PUT',`runs/${pending.id}/new-pages/${index}`,{offers});
  try{await request('POST',`runs/${pending.id}/commit`,{});}catch(error){
    const after=await request('GET','status');if(after.active?.id!==pending.id)throw error;
  }
  if(cache){
    const pageMap=new Map(pages.map(page=>[page.index,page]));
    for(const [index,updates] of ordered){const offersById=new Map(pageMap.get(index).offers.map(offer=>[offer.id,offer]));for(const update of updates)Object.assign(offersById.get(update.id),update);}
    for(const [index,offers] of newPages)pages.push({index,offers});
    cache.id=pending.id;cache.pages=pages;
  }
  await journal.clear();
  return {changed:plan.changes.length,pages:ordered.length+newPages.length,added:newOffers.length,pendingAdded,missing:plan.missing.length,older:plan.older.length,activeId:pending.id};
}
