import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDeviceRunner} from './device-runner.mjs';
test('pairing returns only a digest and status never leaks the credential',async()=>{
 const secret='a'.repeat(64),id='11111111-1111-4111-8111-111111111111';
 const runner=createDeviceRunner({credential:{read:async()=>({id,secret})},journal:{read:async()=>null,write:async()=>{},clear:async()=>{}},requestFactory:()=>async()=>{throw Error(secret);}});
 assert.deepEqual(await runner.pairingInfo(),{id,hash:createHash('sha256').update(secret).digest('hex')});
 await assert.rejects(runner.submit({}),e=>!e.message.includes(secret));
 assert.equal(JSON.stringify(runner.status()).includes(secret),false);
});
