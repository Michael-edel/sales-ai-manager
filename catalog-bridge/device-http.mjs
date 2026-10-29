const ROOT='https://ai.michael.kz/api/catalog-sync/device/';
async function readResponse(res,limit){
 if(Number(res.headers.get('content-length'))>limit)throw new Error('Слишком большой ответ каталога.');
 const reader=res.body?.getReader();if(!reader)throw new Error('Пустой ответ каталога.');
 const parts=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('Слишком большой ответ каталога.');}parts.push(value);}}finally{reader.releaseLock();}
 try{const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('Некорректный ответ каталога.');}
}
/** Secret stays in the local process; requests cannot redirect or change destination. */
export function createDeviceRequest({secret,fetchImpl=fetch,timeoutMs=30000}){
 if(typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret)||typeof fetchImpl!=='function')throw new Error('Подключение устройства не настроено.');
 return async(method,path,body)=>{
  if(!['GET','POST','PUT'].includes(method)||typeof path!=='string'||!/^[-a-z0-9/?=&%]+$/i.test(path)||path.includes('..'))throw new Error('Неверный запрос синхронизации.');
  const url=new URL(path,ROOT);if(!url.href.startsWith(ROOT)||url.origin!=='https://ai.michael.kz')throw new Error('Неверный адрес синхронизации.');
  let res;try{res=await fetchImpl(url,{method,redirect:'manual',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:`Bearer ${secret}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{throw new Error('Сайт недоступен; обновление можно повторить.');}
  if(!res.ok){
   if(res.status===409){try{const message=await readResponse(res,4096);if(message?.errorCode==='HISTORY_STORAGE_LIMIT')throw new Error('Достигнут лимит хранения истории. Обновление остановлено.');}catch(error){if(error?.message==='Достигнут лимит хранения истории. Обновление остановлено.')throw error;}}
   throw new Error(`Синхронизация отклонена (HTTP ${res.status}).`);
  }
  return readResponse(res,2_000_000);
 };
}
