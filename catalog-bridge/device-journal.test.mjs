import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rmdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFileJournal} from './device-journal.mjs';
test('journal contains only run identifiers and a hash, persists and clears',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'catalog-sync-test-'));
 try{
  const path=join(dir,'journal.json'),j=createFileJournal(path),v={id:'11111111-1111-4111-8111-111111111111',baseId:'22222222-2222-4222-8222-222222222222',fingerprint:'a'.repeat(64)};
  assert.equal(await j.read(),null);await j.write(v);assert.deepEqual(await j.read(),v);assert.deepEqual(JSON.parse(await readFile(path,'utf8')),v);
  await assert.rejects(j.write({...v,secret:'do not write'}));await j.clear();assert.equal(await j.read(),null);
 }finally{await unlink(join(dir,'journal.json')).catch(()=>{});await rmdir(dir);}
});
