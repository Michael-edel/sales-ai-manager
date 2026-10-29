import {createDeviceRunner} from './device-runner.mjs';

/** Pairing must first be enabled from the local Cabinet's same-origin UI.
 * The cloud receives only a public fingerprint while the 5-minute window is open.
 */
export function createLocalSyncService({credential,journal,requestFactory,now=()=>Date.now()}){
 const runner=createDeviceRunner({credential,journal,...(requestFactory?{requestFactory}:{})});
 let pairingUntil=0, paired=null, lastObservation=null;
 function validateSnapshot(snapshot){if(!snapshot||snapshot.schemaVersion!==1||snapshot.sourceSystem!=='michael-cabinet'||!Array.isArray(snapshot.offers)||snapshot.offers.length<1||snapshot.offers.length>100000||typeof snapshot.exportedAt!=='string'||!Number.isFinite(Date.parse(snapshot.exportedAt)))throw new Error('Каталог прочитан не полностью.');}
 return {
  validateSnapshot,
  status(){return {...runner.status(),pairingOpen:pairingUntil>now(),paired,lastObservation};},
  async preparePairing(){await runner.pairingInfo();pairingUntil=now()+5*60*1000;return {expiresAt:new Date(pairingUntil).toISOString()};},
  async checkConnection(){paired=await runner.check();return paired;},
  async pairingInfo(){if(pairingUntil<=now())throw new Error('Сначала разрешите подключение в локальном кабинете.');return runner.pairingInfo();},
  async completePairing(){if(pairingUntil<=now())throw new Error('Время подключения истекло.');if(!await runner.check())throw new Error('Сайт ещё не подтвердил подключение устройства.');pairingUntil=0;paired=true;},
  async observe(snapshot){
   validateSnapshot(snapshot);
   lastObservation=new Date(now()).toISOString();
   const result=await runner.submit(snapshot);paired=true;return result;
  },
 };
}
