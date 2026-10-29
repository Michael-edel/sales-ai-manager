import test from 'node:test';
import assert from 'node:assert/strict';
import {pairCatalogDevice} from './catalog-pairing.mjs';
const id='11111111-1111-4111-8111-111111111111',hash='a'.repeat(64);
test('registers only the fingerprint after local user opens pairing',async()=>{
 const calls=[],registered=[];
 const fetchLocal=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.endsWith('/pairing')?{id,hash}:{ok:true}));};
 await pairCatalogDevice({fetchLocal,register:async value=>registered.push(value)});
 assert.deepEqual(registered,[{id,hash}]);assert.equal(calls.length,2);assert.equal(calls.every(x=>x.url.startsWith('http://127.0.0.1:4381/api/ai-sync/')),true);assert.equal(calls.every(x=>x.options.credentials==='omit'),true);
});
test('does not register when pairing was not enabled or the response is unexpected',async()=>{
 let registered=0;const register=async()=>{registered++;};
 await assert.rejects(pairCatalogDevice({fetchLocal:async()=>new Response('',{status:403}),register}));
 await assert.rejects(pairCatalogDevice({fetchLocal:async()=>new Response(JSON.stringify({id,hash,secret:'unexpected'})),register}));
 assert.equal(registered,0);
});
