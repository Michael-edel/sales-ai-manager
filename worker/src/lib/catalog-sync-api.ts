import {verifySyncDevice,registerSyncDevice,revokeSyncDevice} from './catalog-sync-device';
import {beginPageSync,stagePage,stageNewPage,commitPageSync,abortPageSync} from './catalog-page-sync';
import type {SupplierUpdate} from './supplier-sync-plan';
type Env={DB:D1Database};
type User={id:number;role:string};
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function jsonBody(request:Request,max=200_000):Promise<Record<string,unknown>>{
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw Error('invalid');
 if(Number(request.headers.get('content-length'))>max)throw Error('invalid');
 const reader=request.body?.getReader();if(!reader)throw Error('invalid');const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('invalid');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('invalid');return parsed;
}
function keys(body:Record<string,unknown>,allowed:string[]){return Object.keys(body).every(k=>allowed.includes(k))&&allowed.every(k=>Object.hasOwn(body,k));}

/** Experimental only. Do not deploy until pairing, rate limits and integration tests are complete. */
export async function handleSyncDeviceRequest(request:Request,env:Env):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith('/api/catalog-sync/device/'))return null;
 if(request.headers.has('Origin'))return response({detail:'Недопустимый источник запроса.'},403);
 const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if(!token)return response({detail:'Нет доступа к синхронизации.'},401);
 const device=await verifySyncDevice(env,token);if(!device)return response({detail:'Нет доступа к синхронизации.'},401);
 try {
  if(request.method==='GET'&&url.pathname==='/api/catalog-sync/device/status'){
   const active=await env.DB.prepare("SELECT i.id,i.exported_at,i.environment,i.expected_count,i.storage_version FROM catalog_state s JOIN catalog_imports i ON i.id=s.active_snapshot_id WHERE s.id=1 AND i.status='complete' AND EXISTS(SELECT 1 FROM catalog_sync_devices d JOIN app_users u ON u.id=d.created_by AND u.role='admin' AND u.is_active=1 WHERE d.id=? AND d.created_by=? AND d.revoked_at IS NULL)").bind(device.id,device.created_by).first();
   return response({active});
  }
  if(request.method==='GET'&&url.pathname==='/api/catalog-sync/device/pages'){
   const snapshot=url.searchParams.get('snapshot');if(!snapshot||!idPattern.test(snapshot))return response({detail:'Неверные параметры.'},400);
   const guard="EXISTS(SELECT 1 FROM catalog_sync_devices d JOIN app_users u ON u.id=d.created_by AND u.role='admin' AND u.is_active=1 WHERE d.id=? AND d.created_by=? AND d.revoked_at IS NULL)";
   const rows=await env.DB.prepare("SELECT p.batch_index FROM catalog_state s JOIN catalog_imports i ON i.id=s.active_snapshot_id JOIN catalog_pages p ON p.snapshot_id=i.id WHERE s.id=1 AND i.id=? AND i.status='complete' AND NOT EXISTS(SELECT 1 FROM catalog_page_refs WHERE snapshot_id=i.id) AND "+guard+" UNION ALL SELECT r.batch_index FROM catalog_state s JOIN catalog_imports i ON i.id=s.active_snapshot_id JOIN catalog_page_refs r ON r.snapshot_id=i.id WHERE s.id=1 AND i.id=? AND i.status='complete' AND "+guard+" ORDER BY batch_index LIMIT 10001").bind(snapshot,device.id,device.created_by,snapshot,device.id,device.created_by).all<{batch_index:number}>();
   if(rows.results.length>10000)return response({detail:'Слишком много страниц.'},413);
   if(!rows.results.length)return response({detail:'Каталог отсутствует или изменился.'},409);
   return response({indexes:rows.results.map(row=>row.batch_index)});
  }
  const page=url.pathname.match(/^\/api\/catalog-sync\/device\/pages\/(\d+)$/);
  if(request.method==='GET'&&page){
   const snapshot=url.searchParams.get('snapshot');const index=Number(page[1]);
   if(!snapshot||!idPattern.test(snapshot)||!Number.isSafeInteger(index)||index>10000)return response({detail:'Неверные параметры.'},400);
   const guard="EXISTS(SELECT 1 FROM catalog_sync_devices d JOIN app_users u ON u.id=d.created_by AND u.role='admin' AND u.is_active=1 WHERE d.id=? AND d.created_by=? AND d.revoked_at IS NULL)";
   const row=await env.DB.prepare("SELECT p.batch_index,p.payload_json FROM catalog_state s JOIN catalog_imports i ON i.id=s.active_snapshot_id JOIN catalog_pages p ON p.snapshot_id=i.id WHERE s.id=1 AND i.id=? AND i.status='complete' AND p.batch_index=? AND NOT EXISTS(SELECT 1 FROM catalog_page_refs WHERE snapshot_id=i.id) AND "+guard+" UNION ALL SELECT p.batch_index,p.payload_json FROM catalog_state s JOIN catalog_imports i ON i.id=s.active_snapshot_id JOIN catalog_page_refs r ON r.snapshot_id=i.id JOIN catalog_pages p ON p.snapshot_id=r.content_snapshot_id AND p.batch_index=r.batch_index WHERE s.id=1 AND i.id=? AND i.status='complete' AND r.batch_index=? AND "+guard).bind(snapshot,index,device.id,device.created_by,snapshot,index,device.id,device.created_by).first<{batch_index:number;payload_json:string}>();
   return row?response({index:row.batch_index,offers:JSON.parse(row.payload_json)}):response({detail:'Страница отсутствует или каталог изменился.'},404);
  }
  if(request.method==='POST'&&url.pathname==='/api/catalog-sync/device/runs'){
   const b=await jsonBody(request,4096);if(!keys(b,['baseId','expectedPages','exportedAt','addedCount'])||typeof b.baseId!=='string'||typeof b.expectedPages!=='number'||typeof b.exportedAt!=='string'||typeof b.addedCount!=='number')return response({detail:'Неверные параметры.'},400);
   return response(await beginPageSync(env,b.baseId,device,b.expectedPages,b.exportedAt,b.addedCount),201);
  }
  const newPage=url.pathname.match(/^\/api\/catalog-sync\/device\/runs\/([^/]+)\/new-pages\/(\d+)$/);
  if(request.method==='PUT'&&newPage){const b=await jsonBody(request,1_800_000);if(!idPattern.test(newPage[1])||!keys(b,['offers'])||!Array.isArray(b.offers))return response({detail:'Неверные параметры.'},400);await stageNewPage(env,newPage[1],device,Number(newPage[2]),b.offers);return response({ok:true});}
  const stage=url.pathname.match(/^\/api\/catalog-sync\/device\/runs\/([^/]+)\/pages\/(\d+)$/);
  if(request.method==='PUT'&&stage){
   const b=await jsonBody(request);if(!idPattern.test(stage[1])||!keys(b,['updates'])||!Array.isArray(b.updates))return response({detail:'Неверные параметры.'},400);
   await stagePage(env,stage[1],device,Number(stage[2]),b.updates as SupplierUpdate[]);return response({ok:true});
  }
  const commit=url.pathname.match(/^\/api\/catalog-sync\/device\/runs\/([^/]+)\/commit$/);
  if(request.method==='POST'&&commit){if(!idPattern.test(commit[1]))return response({detail:'Неверные параметры.'},400);const b=await jsonBody(request,128);if(Object.keys(b).length)return response({detail:'Неверные параметры.'},400);await commitPageSync(env,commit[1],device);return response({ok:true});}
  const abort=url.pathname.match(/^\/api\/catalog-sync\/device\/runs\/([^/]+)\/abort$/);
  if(request.method==='POST'&&abort){if(!idPattern.test(abort[1]))return response({detail:'Неверные параметры.'},400);const b=await jsonBody(request,128);if(Object.keys(b).length)return response({detail:'Неверные параметры.'},400);await abortPageSync(env,abort[1],device);return response({ok:true});}
  return response({detail:'Маршрут не найден.'},404);
 }catch(error){
  if(String(error).includes('used_bytes>=0')||String(error).includes('HISTORY_STORAGE_LIMIT'))return response({detail:'Достигнут безопасный лимит хранения истории. Обновление остановлено.',errorCode:'HISTORY_STORAGE_LIMIT'},409);
  return response({detail:'Синхронизация не выполнена. Проверьте доступ и актуальность каталога.'},409);
 }
}

/** Admin browser handler; device secret is never accepted here, only its digest. */
export async function handleSyncAdminRequest(request:Request,env:Env,user:User):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith('/api/catalog-sync/admin/'))return null;
 if(user.role!=='admin'||request.headers.get('Origin')!==url.origin)return response({detail:'Недостаточно прав.'},403);
 try{
  if(request.method==='POST'&&url.pathname==='/api/catalog-sync/admin/devices'){
   const b=await jsonBody(request,4096);if(!keys(b,['id','hash'])||typeof b.id!=='string'||typeof b.hash!=='string')return response({detail:'Неверные параметры.'},400);
   return response(await registerSyncDevice(env,user.id,b.id,b.hash),201);
  }
  const revoke=url.pathname.match(/^\/api\/catalog-sync\/admin\/devices\/([^/]+)\/revoke$/);
  if(request.method==='POST'&&revoke){const b=await jsonBody(request,128);if(Object.keys(b).length||!idPattern.test(revoke[1]))return response({detail:'Неверные параметры.'},400);return response({revoked:await revokeSyncDevice(env,user.id,revoke[1])});}
  return response({detail:'Маршрут не найден.'},404);
 }catch{return response({detail:'Не удалось изменить подключение.'},409);}
}
