import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceRequest} from './device-http.mjs';
const key='f'.repeat(64);
test('keeps device requests on the fixed HTTPS destination and rejects redirects',async()=>{
 let seen;const request=createDeviceRequest({secret:key,fetchImpl:async(url,options)=>{seen={url:String(url),options};return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});}});
 assert.deepEqual(await request('POST','runs',{a:1}),{ok:true});assert.equal(seen.url,'https://ai.michael.kz/api/catalog-sync/device/runs');assert.equal(seen.options.redirect,'manual');
 await assert.rejects(request('GET','https://other.test/'));
 const rejected=createDeviceRequest({secret:key,fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://other.test'}})});
 await assert.rejects(rejected('GET','status'),e=>!e.message.includes(key));
});
test('bounds response size and conceals transport errors',async()=>{
 const oversized=createDeviceRequest({secret:key,fetchImpl:async()=>new Response('x',{headers:{'content-length':'3000000'}})});
 await assert.rejects(oversized('GET','status'),/большой/);
 const offline=createDeviceRequest({secret:key,fetchImpl:async()=>{throw Error(key);}});
 await assert.rejects(offline('GET','status'),e=>!e.message.includes(key));
});
