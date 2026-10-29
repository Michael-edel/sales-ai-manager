type Env={DB:D1Database};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hex=/^[a-f0-9]{64}$/;
export async function tokenHash(secret:string):Promise<string>{const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");}
/** No HTTP handler: callers must verify administrator session and Origin before
 * registration, and provide a short-lived, local-user-approved pairing flow. */
export async function registerSyncDevice(env:Env,adminId:number,id:string,hash:string){
 if(!Number.isSafeInteger(adminId)||adminId<1||!uuid.test(id)||!hex.test(hash))throw Error("Invalid device request");
 const existing=await env.DB.prepare("SELECT d.id FROM catalog_sync_devices d JOIN app_users u ON u.id=d.created_by AND u.role='admin' AND u.is_active=1 WHERE d.id=? AND d.token_hash=? AND d.created_by=? AND d.revoked_at IS NULL").bind(id,hash,adminId).first<{id:string}>();
 if(existing)return {id};
 const result=await env.DB.prepare("INSERT INTO catalog_sync_devices(id,token_hash,created_by,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM app_users WHERE id=? AND role='admin' AND is_active=1) AND (SELECT COUNT(*) FROM catalog_sync_devices WHERE revoked_at IS NULL)<3").bind(id,hash,adminId,new Date().toISOString(),adminId).run();
 if(result.meta.changes!==1)throw Error("Device registration refused");
 return {id};
}
export async function verifySyncDevice(env:Env,secret:string){
 if(!/^[a-f0-9]{64}$/.test(secret))return null;
 const hash=await tokenHash(secret);
 return env.DB.prepare("SELECT d.id,d.created_by FROM catalog_sync_devices d JOIN app_users u ON u.id=d.created_by AND u.role='admin' AND u.is_active=1 WHERE d.token_hash=? AND d.revoked_at IS NULL").bind(hash).first<{id:string;created_by:number}>();
}
export async function revokeSyncDevice(env:Env,adminId:number,id:string){
 if(!uuid.test(id)||!Number.isSafeInteger(adminId)||adminId<1)throw Error("Invalid device request");
 const result=await env.DB.prepare("UPDATE catalog_sync_devices SET revoked_at=? WHERE id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND role='admin' AND is_active=1)").bind(new Date().toISOString(),id,adminId).run();
 return result.meta.changes===1;
}
