const local='http://127.0.0.1:4381/api/ai-sync/';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Called only after an administrator explicitly starts pairing in both apps. */
export async function pairCatalogDevice({fetchLocal=fetch,register}){
 const response=await fetchLocal(local+'pairing',{method:'GET',mode:'cors',credentials:'omit',cache:'no-store'});
 if(!response.ok)throw new Error('Сначала разрешите подключение в локальном кабинете.');
 const value=await response.json();
 if(!uuid.test(value?.id||'')||!/^[a-f0-9]{64}$/.test(value?.hash||'')||Object.keys(value).sort().join(',')!=='hash,id')throw new Error('Локальный кабинет вернул некорректное подтверждение.');
 await register({id:value.id,hash:value.hash});
 const done=await fetchLocal(local+'pairing-complete',{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}'});
 if(!done.ok)throw new Error('Подключение сохранено на сайте, но локальный кабинет не подтвердил его. Повторите подключение.');
 return true;
}
