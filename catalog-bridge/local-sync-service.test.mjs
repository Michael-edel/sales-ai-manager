import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalSyncService} from './local-sync-service.mjs';
test('local user enables pairing for five minutes, exposes only a fingerprint',async()=>{
 let clock=Date.parse('2026-10-29T10:00:00Z');const secret='a'.repeat(64),id='11111111-1111-4111-8111-111111111111';
 const service=createLocalSyncService({credential:{read:async()=>({id,secret})},journal:{read:async()=>null,write:async()=>{},clear:async()=>{}},requestFactory:()=>async()=>({active:{id:'test'}}),now:()=>clock});
 await assert.rejects(service.pairingInfo());await service.preparePairing();assert.equal(service.status().pairingOpen,true);
 const info=await service.pairingInfo();assert.equal(info.id,id);assert.equal(JSON.stringify(info).includes(secret),false);
 clock+=300001;await assert.rejects(service.pairingInfo());await assert.rejects(service.completePairing());
 await service.preparePairing();await service.completePairing();assert.equal(service.status().paired,true);await assert.rejects(service.pairingInfo());
 await assert.rejects(service.observe({offers:[]}));
});
