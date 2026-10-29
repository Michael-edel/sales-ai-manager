import {createHash} from 'node:crypto';
import {createDeviceRequest} from './device-http.mjs';
import {synchronizeSuppliers} from './device-sync.mjs';

/** Experimental: caller controls pairing and schedules observations from its own browser storage. */
export function createDeviceRunner({credential,journal,requestFactory=createDeviceRequest}){
 let running=false,lastResult=null,lastError=null,lastAttempt=null;const cache={id:null,pages:null};
 async function pairingInfo(){
  let value;
  try{value=await credential.read();}catch{return credential.initialize();}
  return {id:value.id,hash:createHash('sha256').update(value.secret).digest('hex')};
 }
 async function submit(snapshot){
  if(running)throw new Error('Передача уже выполняется.');
  running=true;lastAttempt=new Date().toISOString();lastError=null;
  try{
   const device=await credential.read(),request=requestFactory({secret:device.secret});
   lastResult=await synchronizeSuppliers({request,snapshot,journal,cache});return lastResult;
  }catch(error){lastError=error?.message==='Достигнут лимит хранения истории. Обновление остановлено.'?error.message:'Передача не выполнена. Проверьте подключение и состояние каталога.';throw new Error(lastError);}
  finally{running=false;}
 }
 async function check(){try{const value=await credential.read(),request=requestFactory({secret:value.secret});await request('GET','status');return true;}catch{return false;}}
 return {pairingInfo,submit,check,status:()=>({running,lastAttempt,lastError,lastResult})};
}
