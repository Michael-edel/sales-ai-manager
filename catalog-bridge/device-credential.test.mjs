import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rmdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createDeviceCredential} from './device-credential.mjs';
test('protects device credential using current Windows user and never overwrites it',{skip:process.platform!=='win32'},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'device-test-')),folder=join(parent,'protected'),store=join(folder,'credential.bin');
 const script=fileURLToPath(new URL('./device-credential.ps1',import.meta.url));
 const run=action=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-StorePath',store],{input:JSON.stringify({action}),encoding:'utf8',windowsHide:true});
 try{
  const init=run('initialize');assert.equal(init.status,0,init.stderr);const info=JSON.parse(init.stdout);
  const read=run('read');assert.equal(read.status,0,read.stderr);const stored=JSON.parse(read.stdout);
  assert.equal(stored.id,info.id);assert.equal(createHash('sha256').update(stored.secret).digest('hex'),info.hash);
  assert.equal((await readFile(store)).includes(Buffer.from(stored.secret)),false);
  assert.equal((await createDeviceCredential({storePath:store}).read()).id,info.id);
  assert.notEqual(run('initialize').status,0);
 }finally{await unlink(store).catch(()=>{});await rmdir(folder).catch(()=>{});await rmdir(parent);}
});
