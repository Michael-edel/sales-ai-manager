import {applySupplierUpdates,type SupplierUpdate} from "./supplier-sync-plan";
import {normalizeCatalogText,normalizedUnit,validateCatalogOffer,type CatalogOffer} from "./catalog-selection";
interface Env {DB:D1Database}
interface Base {id:string;source_system:string;exported_at:string;environment:string;expected_count:number;received_count:number;storage_version:number}
interface Run {id:string;base_snapshot_id:string;device_id:string;expected_pages:number;added_count:number;applied_pages:number;status:string}
interface Device {id:string;created_by:number}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SYNC_STORAGE_BUDGET=300_000_000;
async function active(env:Env):Promise<Base|null>{return env.DB.prepare("SELECT i.* FROM catalog_state s JOIN catalog_imports i ON i.id=s.active_snapshot_id WHERE s.id=1 AND i.status='complete'").first<Base>();}
async function getRun(env:Env,id:string):Promise<Run>{const r=await env.DB.prepare("SELECT * FROM catalog_sync_runs WHERE id=?").bind(id).first<Run>();if(!r)throw Error('Sync not found');return r;}
/** Prototype: caller must authenticate, validate input, enforce rate limits, and
 * serialize competing workers. This module has no HTTP routes or credentials. */
export async function beginPageSync(env:Env,expectedBase:string,device:Device,expectedPages:number,exportedAt:string,addedCount=0){
 const base=await active(env);if(!base||base.id!==expectedBase||base.storage_version!==2)throw Error('Active catalog changed');
 if(!device||!UUID.test(device.id)||!Number.isSafeInteger(device.created_by)||device.created_by<1||!Number.isInteger(expectedPages)||expectedPages<1||expectedPages>1000||!Number.isSafeInteger(addedCount)||addedCount<0||base.expected_count+addedCount>100000||!Number.isFinite(Date.parse(exportedAt))||Date.parse(exportedAt)<=Date.parse(base.exported_at)||Date.parse(exportedAt)>Date.now()+300000)throw Error('Invalid sync');
 const id=crypto.randomUUID(),claim=crypto.randomUUID(),now=new Date().toISOString(),cutoff=new Date(Date.now()-5*60_000).toISOString();
 await env.DB.batch([
  env.DB.prepare("UPDATE catalog_sync_budget SET used_bytes=(SELECT COALESCE(SUM(length(CAST(payload_json AS BLOB))+length(CAST(search_text AS BLOB))+length(CAST(exact_keys AS BLOB))+length(CAST(offer_keys AS BLOB))+length(CAST(product_keys AS BLOB))),0) FROM catalog_pages) WHERE id=1"),
  env.DB.prepare("UPDATE catalog_sync_devices SET last_started_at=?,rate_claim=? WHERE id=? AND created_by=? AND revoked_at IS NULL AND (last_started_at IS NULL OR last_started_at<=?) AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND role='admin' AND is_active=1) AND EXISTS(SELECT 1 FROM catalog_state WHERE id=1 AND active_snapshot_id=?) AND EXISTS(SELECT 1 FROM catalog_sync_budget WHERE id=1 AND used_bytes<?)").bind(now,claim,device.id,device.created_by,cutoff,device.created_by,base.id,SYNC_STORAGE_BUDGET),
  env.DB.prepare("INSERT INTO catalog_imports(id,source_system,exported_at,environment,expected_count,received_count,status,created_by,storage_version) SELECT ?,source_system,?,environment,expected_count+?,received_count,'uploading',?,2 FROM catalog_imports WHERE id=? AND EXISTS(SELECT 1 FROM catalog_state WHERE id=1 AND active_snapshot_id=?) AND EXISTS(SELECT 1 FROM catalog_sync_devices d JOIN app_users u ON u.id=d.created_by AND u.is_active=1 AND u.role='admin' WHERE d.id=? AND d.created_by=? AND d.revoked_at IS NULL AND d.rate_claim=?)").bind(id,exportedAt,addedCount,device.created_by,base.id,base.id,device.id,device.created_by,claim),
  env.DB.prepare("INSERT INTO catalog_sync_runs(id,base_snapshot_id,device_id,expected_pages,added_count,status) SELECT ?,?,?,?,?,'staging' WHERE EXISTS(SELECT 1 FROM catalog_imports WHERE id=?)").bind(id,base.id,device.id,expectedPages,addedCount,id),
  env.DB.prepare("INSERT INTO catalog_page_refs(snapshot_id,batch_index,content_snapshot_id) SELECT ?,p.batch_index,p.snapshot_id FROM catalog_pages p WHERE p.snapshot_id=? AND NOT EXISTS(SELECT 1 FROM catalog_page_refs WHERE snapshot_id=?) AND EXISTS(SELECT 1 FROM catalog_sync_runs WHERE id=?) UNION ALL SELECT ?,r.batch_index,r.content_snapshot_id FROM catalog_page_refs r WHERE r.snapshot_id=? AND EXISTS(SELECT 1 FROM catalog_sync_runs WHERE id=?)").bind(id,base.id,base.id,id,id,base.id,id),
 ]);
 const r=await env.DB.prepare('SELECT * FROM catalog_sync_runs WHERE id=?').bind(id).first<Run>();
 if(!r){const budget=await env.DB.prepare('SELECT used_bytes FROM catalog_sync_budget WHERE id=1').first<{used_bytes:number}>();if((budget?.used_bytes||0)>=SYNC_STORAGE_BUDGET)throw Error('HISTORY_STORAGE_LIMIT');throw Error('Active catalog changed or rate limited');}
 if(r.base_snapshot_id!==base.id)throw Error('Active catalog changed');
 const pages=await env.DB.prepare("SELECT COUNT(*) AS n FROM catalog_page_refs WHERE snapshot_id=?").bind(id).first<{n:number}>();
 if(!pages?.n)throw Error('No catalog pages');return {id,baseId:base.id,pages:pages.n};
}

/** Remove only this device's unactivated staging data; historical snapshots stay intact. */
export async function abortPageSync(env:Env,id:string,device:Device){
 if(!UUID.test(id)||!device||!UUID.test(device.id))throw Error('Invalid sync');
 const run=await env.DB.prepare('SELECT * FROM catalog_sync_runs WHERE id=?').bind(id).first<Run>();if(!run)return;
 if(run.device_id!==device.id)throw Error('Cannot cancel sync');
 if(run.status==='complete')return;
 if(run.status!=='staging')throw Error('Cannot cancel sync');
 const guard="EXISTS(SELECT 1 FROM catalog_sync_runs s JOIN catalog_sync_devices d ON d.id=s.device_id AND d.revoked_at IS NULL JOIN app_users u ON u.id=d.created_by AND u.role='admin' AND u.is_active=1 WHERE s.id=? AND s.device_id=? AND d.created_by=? AND s.status='staging') AND NOT EXISTS(SELECT 1 FROM catalog_state WHERE id=1 AND active_snapshot_id=?)";
 await env.DB.batch([
  env.DB.prepare('DELETE FROM catalog_page_refs WHERE snapshot_id=? AND '+guard).bind(id,id,device.id,device.created_by,id),
  env.DB.prepare('DELETE FROM catalog_sync_pages WHERE sync_id=? AND '+guard).bind(id,id,device.id,device.created_by,id),
  env.DB.prepare('DELETE FROM catalog_pages WHERE snapshot_id=? AND '+guard).bind(id,id,device.id,device.created_by,id),
  env.DB.prepare("DELETE FROM catalog_imports WHERE id=? AND status='uploading' AND "+guard).bind(id,id,device.id,device.created_by,id),
  env.DB.prepare('DELETE FROM catalog_sync_runs WHERE id=? AND '+guard).bind(id,id,device.id,device.created_by,id),
 ]);
 if(await env.DB.prepare('SELECT id FROM catalog_sync_runs WHERE id=?').bind(id).first())throw Error('Cannot cancel sync');
}
export async function stagePage(env:Env,id:string,device:Device,index:number,updates:SupplierUpdate[]){
 if(!UUID.test(id)||!device||!UUID.test(device.id)||!Number.isInteger(index)||index<0||!Array.isArray(updates)||!updates.length||updates.length>100||new Set(updates.map(u=>u.id)).size!==updates.length)throw Error('Invalid page update');
 const run=await getRun(env,id),base=await active(env);if(run.status!=='staging'||base?.id!==run.base_snapshot_id)throw Error('Active catalog changed');
 if(run.device_id!==device.id||!(await env.DB.prepare("SELECT d.id FROM catalog_sync_devices d JOIN app_users u ON u.id=d.created_by AND u.role='admin' AND u.is_active=1 WHERE d.id=? AND d.created_by=? AND d.revoked_at IS NULL").bind(device.id,device.created_by).first()))throw Error('Device revoked or unauthorized');
 const bytes=new TextEncoder().encode(JSON.stringify(updates)),hash=await crypto.subtle.digest('SHA-256',bytes);
 const checksum=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
 const prior=await env.DB.prepare("SELECT checksum FROM catalog_sync_pages WHERE sync_id=? AND batch_index=?").bind(id,index).first<{checksum:string}>();
 if(prior){if(prior.checksum!==checksum)throw Error('Conflicting page replay');return;}
 const row=await env.DB.prepare("SELECT p.* FROM catalog_page_refs r JOIN catalog_pages p ON p.snapshot_id=r.content_snapshot_id AND p.batch_index=r.batch_index WHERE r.snapshot_id=? AND r.batch_index=?").bind(id,index).first<{offer_count:number;payload_json:string;search_text:string;exact_keys:string;offer_keys:string;product_keys:string}>();
 if(!row)throw Error('Page not found');const old=JSON.parse(row.payload_json) as CatalogOffer[];
 const result=applySupplierUpdates(old,new Map(updates.map(u=>[u.id,u])));if(result.applied.length!==updates.length)throw Error('Update does not belong to page');
 const data=JSON.stringify(result.offers),pageBytes=new TextEncoder().encode(data+row.search_text+row.exact_keys+row.offer_keys+row.product_keys).length;if(pageBytes>1800000)throw Error('Page too large');
 await env.DB.batch([
  env.DB.prepare("INSERT INTO catalog_sync_pages(sync_id,batch_index,checksum) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM catalog_sync_runs s JOIN catalog_state c ON c.id=1 AND c.active_snapshot_id=s.base_snapshot_id JOIN catalog_sync_devices d ON d.id=s.device_id AND d.revoked_at IS NULL JOIN app_users u ON u.id=d.created_by AND u.role='admin' AND u.is_active=1 WHERE s.id=? AND s.device_id=? AND d.created_by=? AND s.status='staging' AND s.applied_pages<s.expected_pages)").bind(id,index,checksum,id,device.id,device.created_by),
  env.DB.prepare("UPDATE catalog_sync_budget SET used_bytes=CASE WHEN used_bytes+?>? THEN -1 ELSE used_bytes+? END WHERE id=1 AND EXISTS(SELECT 1 FROM catalog_sync_pages WHERE sync_id=? AND batch_index=? AND checksum=?)").bind(pageBytes,SYNC_STORAGE_BUDGET,pageBytes,id,index,checksum),
  env.DB.prepare("INSERT INTO catalog_pages(snapshot_id,batch_index,offer_count,payload_json,search_text,exact_keys,offer_keys,product_keys) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM catalog_sync_pages WHERE sync_id=? AND batch_index=? AND checksum=?)").bind(id,index,row.offer_count,data,row.search_text,row.exact_keys,row.offer_keys,row.product_keys,id,index,checksum),
  env.DB.prepare("UPDATE catalog_page_refs SET content_snapshot_id=? WHERE snapshot_id=? AND batch_index=? AND EXISTS(SELECT 1 FROM catalog_sync_pages WHERE sync_id=? AND batch_index=? AND checksum=?)").bind(id,id,index,id,index,checksum),
  env.DB.prepare("UPDATE catalog_sync_runs SET applied_pages=applied_pages+1 WHERE id=? AND EXISTS(SELECT 1 FROM catalog_sync_pages WHERE sync_id=? AND batch_index=? AND checksum=?)").bind(id,id,index,checksum),
 ]);
 const saved=await env.DB.prepare("SELECT checksum FROM catalog_sync_pages WHERE sync_id=? AND batch_index=?").bind(id,index).first<{checksum:string}>();if(saved?.checksum!==checksum)throw Error('Page not staged');
}

/** New links must point to an existing warehouse offer with the same unit. */
export async function stageNewPage(env:Env,id:string,device:Device,index:number,input:unknown[]){
 if(!UUID.test(id)||!device||!UUID.test(device.id)||!Number.isSafeInteger(index)||index<0||!Array.isArray(input)||!input.length||input.length>100)throw Error('Invalid new page');
 const offers=input.map(validateCatalogOffer);
 if(offers.some(o=>o.sourceType!=='supplier'||!!o.onecCode||(o.stockConfirmed&&(o.quantity===null||!o.updatedAt))||(o.quantity!==null&&o.available!==null&&o.available!==(o.quantity>0)))||new Set(offers.map(o=>o.id)).size!==offers.length)throw Error('Invalid new supplier offers');
 const run=await getRun(env,id),base=await active(env);
 if(run.status!=='staging'||base?.id!==run.base_snapshot_id||run.device_id!==device.id)throw Error('Active catalog changed');
 if(!(await env.DB.prepare("SELECT d.id FROM catalog_sync_devices d JOIN app_users u ON u.id=d.created_by AND u.role='admin' AND u.is_active=1 WHERE d.id=? AND d.created_by=? AND d.revoked_at IS NULL").bind(device.id,device.created_by).first()))throw Error('Device revoked or unauthorized');
 const anchors=new Map<string,CatalogOffer|null>();
 for(const offer of offers.filter(o=>o.productId!==o.id)){
  if(!offer.unit)throw Error('Linked offer unit missing');
  if(!anchors.has(offer.productId)){
   const page=await env.DB.prepare("SELECT p.payload_json FROM catalog_page_refs r JOIN catalog_pages p ON p.snapshot_id=r.content_snapshot_id AND p.batch_index=r.batch_index WHERE r.snapshot_id=? AND instr(p.offer_keys,?)>0 LIMIT 1").bind(id,JSON.stringify(offer.productId)).first<{payload_json:string}>();
   anchors.set(offer.productId,page?(JSON.parse(page.payload_json) as CatalogOffer[]).find(o=>o.id===offer.productId)||null:null);
  }
  const anchor=anchors.get(offer.productId);
  if(!anchor||anchor.sourceType!=='warehouse'||!anchor.unit||normalizedUnit(anchor.unit)!==normalizedUnit(offer.unit))throw Error('Linked warehouse offer not verified');
 }
 const encoded=JSON.stringify(offers),ids=JSON.stringify(offers.map(o=>o.id)),products=JSON.stringify(offers.map(o=>o.productId));
 const rows=offers.map(o=>({search:normalizeCatalogText([o.name,o.article,o.onecCode,o.brand].join(' ')),article:normalizeCatalogText(o.article),code:normalizeCatalogText(o.onecCode)}));
 const search=rows.map(r=>r.search).join('\n'),exact=JSON.stringify([...new Set(rows.flatMap(r=>[r.article,r.code]).filter(Boolean))]);
 const pageBytes=new TextEncoder().encode(encoded+ids+products+search+exact).length;if(pageBytes>1800000)throw Error('Page too large');
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encoded)),checksum=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
 const prior=await env.DB.prepare('SELECT checksum,added_count FROM catalog_sync_pages WHERE sync_id=? AND batch_index=?').bind(id,index).first<{checksum:string;added_count:number}>();
 if(prior){if(prior.checksum!==checksum||prior.added_count!==offers.length)throw Error('Conflicting page replay');return;}
 await env.DB.batch([
  env.DB.prepare("INSERT INTO catalog_sync_pages(sync_id,batch_index,checksum,added_count) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM catalog_sync_runs s JOIN catalog_state c ON c.id=1 AND c.active_snapshot_id=s.base_snapshot_id JOIN catalog_imports i ON i.id=s.id JOIN catalog_sync_devices d ON d.id=s.device_id AND d.revoked_at IS NULL JOIN app_users u ON u.id=d.created_by AND u.role='admin' AND u.is_active=1 WHERE s.id=? AND s.device_id=? AND d.created_by=? AND s.status='staging' AND s.applied_pages<s.expected_pages AND i.received_count+?<=i.expected_count) AND NOT EXISTS(SELECT 1 FROM catalog_page_refs WHERE snapshot_id=? AND batch_index=?) AND NOT EXISTS(SELECT 1 FROM catalog_page_refs r JOIN catalog_pages p ON p.snapshot_id=r.content_snapshot_id AND p.batch_index=r.batch_index JOIN json_each(p.offer_keys) existing JOIN json_each(?) incoming ON existing.value=incoming.value WHERE r.snapshot_id=?)").bind(id,index,checksum,offers.length,id,device.id,device.created_by,offers.length,id,index,ids,id),
  env.DB.prepare("UPDATE catalog_sync_budget SET used_bytes=CASE WHEN used_bytes+?>? THEN -1 ELSE used_bytes+? END WHERE id=1 AND EXISTS(SELECT 1 FROM catalog_sync_pages WHERE sync_id=? AND batch_index=? AND checksum=?)").bind(pageBytes,SYNC_STORAGE_BUDGET,pageBytes,id,index,checksum),
  env.DB.prepare("INSERT INTO catalog_pages(snapshot_id,batch_index,offer_count,payload_json,search_text,exact_keys,offer_keys,product_keys) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM catalog_sync_pages WHERE sync_id=? AND batch_index=? AND checksum=? AND added_count=?)").bind(id,index,offers.length,encoded,search,exact,ids,products,id,index,checksum,offers.length),
  env.DB.prepare("INSERT INTO catalog_page_refs(snapshot_id,batch_index,content_snapshot_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM catalog_pages WHERE snapshot_id=? AND batch_index=?)").bind(id,index,id,id,index),
  env.DB.prepare("UPDATE catalog_imports SET received_count=received_count+? WHERE id=? AND EXISTS(SELECT 1 FROM catalog_sync_pages WHERE sync_id=? AND batch_index=? AND checksum=?)").bind(offers.length,id,id,index,checksum),
  env.DB.prepare("UPDATE catalog_sync_runs SET applied_pages=applied_pages+1 WHERE id=? AND EXISTS(SELECT 1 FROM catalog_sync_pages WHERE sync_id=? AND batch_index=? AND checksum=?)").bind(id,id,index,checksum),
 ]);
 const saved=await env.DB.prepare('SELECT checksum FROM catalog_sync_pages WHERE sync_id=? AND batch_index=?').bind(id,index).first<{checksum:string}>();if(saved?.checksum!==checksum)throw Error('New page not staged');
}

/** This prototype must not be activated until the catalog read path supports page references. */
export async function commitPageSync(env:Env,id:string,device:Device){
 if(!UUID.test(id)||!device||!UUID.test(device.id))throw Error('Invalid sync');const run=await getRun(env,id),current=await active(env);
 if(run.device_id!==device.id||!(await env.DB.prepare("SELECT d.id FROM catalog_sync_devices d JOIN app_users u ON u.id=d.created_by AND u.role='admin' AND u.is_active=1 WHERE d.id=? AND d.created_by=? AND d.revoked_at IS NULL").bind(device.id,device.created_by).first()))throw Error('Device revoked or unauthorized');
 if(run.status==='complete'&&current?.id===id)return;
 if(run.status!=='staging'||current?.id!==run.base_snapshot_id||run.applied_pages!==run.expected_pages)throw Error('Incomplete or conflicting sync');
 await env.DB.batch([
  env.DB.prepare("UPDATE catalog_imports SET status='complete' WHERE id=? AND status='uploading' AND received_count=expected_count AND expected_count=(SELECT COALESCE(SUM(p.offer_count),0) FROM catalog_page_refs r JOIN catalog_pages p ON p.snapshot_id=r.content_snapshot_id AND p.batch_index=r.batch_index WHERE r.snapshot_id=?) AND EXISTS(SELECT 1 FROM catalog_sync_runs s JOIN catalog_state c ON c.id=1 AND c.active_snapshot_id=s.base_snapshot_id JOIN catalog_sync_devices d ON d.id=s.device_id AND d.revoked_at IS NULL JOIN app_users u ON u.id=d.created_by AND u.role='admin' AND u.is_active=1 WHERE s.id=? AND s.device_id=? AND d.created_by=? AND s.status='staging' AND s.applied_pages=s.expected_pages)").bind(id,id,id,device.id,device.created_by),
  env.DB.prepare("UPDATE catalog_state SET active_snapshot_id=? WHERE id=1 AND active_snapshot_id=? AND EXISTS(SELECT 1 FROM catalog_imports WHERE id=? AND status='complete')").bind(id,run.base_snapshot_id,id),
  env.DB.prepare("UPDATE catalog_sync_runs SET status='complete' WHERE id=? AND EXISTS(SELECT 1 FROM catalog_state WHERE id=1 AND active_snapshot_id=?)").bind(id,id),
 ]);
 if((await active(env))?.id!==id)throw Error('Catalog activation failed');
}
