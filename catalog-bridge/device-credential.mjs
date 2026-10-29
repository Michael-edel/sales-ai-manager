import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,isAbsolute} from 'node:path';
const script=fileURLToPath(new URL('./device-credential.ps1',import.meta.url));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** The device secret travels only through an anonymous pipe to this process. */
export function createDeviceCredential({storePath=join(process.env.LOCALAPPDATA||'', 'MichaelCatalogSync','credential.bin')}={}){
 if(process.platform!=='win32'||!isAbsolute(storePath))throw new Error('Защищённое подключение доступно только в Windows.');
 async function operation(action){
  return new Promise((resolve,reject)=>{
   const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-StorePath',storePath],{windowsHide:true,stdio:['pipe','pipe','ignore']});
   let out='',settled=false;const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
   const timer=setTimeout(()=>{child.kill();done(new Error('Истекло время проверки подключения устройства.'));},30000);
   child.stdout.on('data',chunk=>{out+=chunk.toString('utf8');if(out.length>4096){child.kill();done(new Error('Некорректный ответ защищённого хранилища.'));}});
   child.on('error',()=>done(new Error('Не удалось открыть защищённое хранилище.')));
   child.on('close',code=>{if(code!==0)return done(new Error('Не удалось открыть защищённое хранилище.'));try{const data=JSON.parse(out);if(!uuid.test(data.id)||!(action==='read'?/^[a-f0-9]{64}$/.test(data.secret):/^[a-f0-9]{64}$/.test(data.hash)))throw Error();done(null,data);}catch{done(new Error('Некорректный ответ защищённого хранилища.'));}});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({action}));
  });
 }
 return {initialize:()=>operation('initialize'),read:()=>operation('read')};
}
