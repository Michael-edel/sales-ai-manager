import {readFile,writeFile,rename,unlink,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fingerprint=/^[a-f0-9]{64}$/;
function validate(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='baseId,fingerprint,id'||!uuid.test(value.id)||!uuid.test(value.baseId)||!fingerprint.test(value.fingerprint))throw new Error('Некорректный журнал синхронизации.');
 return {id:value.id,baseId:value.baseId,fingerprint:value.fingerprint};
}
/** Only run identifiers and a content hash; no catalog, credential or session. */
export function createFileJournal(path){
 return {
  async read(){try{const raw=await readFile(path,'utf8');if(raw.length>1024)throw Error();return validate(JSON.parse(raw));}catch(e){if(e?.code==='ENOENT')return null;throw new Error('Не удалось прочитать журнал синхронизации.');}},
  async write(value){const data=validate(value);await mkdir(dirname(path),{recursive:true});const tmp=path+'.'+randomBytes(8).toString('hex')+'.tmp';try{await writeFile(tmp,JSON.stringify(data),{encoding:'utf8',flag:'wx',mode:0o600});await rename(tmp,path);}finally{await unlink(tmp).catch(()=>{});}},
  async clear(){await unlink(path).catch(e=>{if(e?.code!=='ENOENT')throw e;});},
 };
}
