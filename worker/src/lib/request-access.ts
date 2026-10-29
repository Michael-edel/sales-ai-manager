export type RequestActor = { id: number; role: string };
type AccessEnv = { DB: D1Database; REQUEST_USER?: RequestActor };
export class RequestAccessError extends Error {
  readonly status = 404;
  constructor() { super("Заявка не найдена."); }
}
/** A missing server actor is never interpreted as administrator access. */
export function requestScope(user: RequestActor | undefined, alias = "r"): { sql: string; bindings: number[] } {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid internal request alias");
  if (user?.role === "admin") return { sql: "1 = 1", bindings: [] };
  if (!user || !Number.isSafeInteger(user.id) || user.id < 1) return { sql: "1 = 0", bindings: [] };
  return { sql: `${alias}.assigned_user_id = ?`, bindings: [user.id] };
}
export async function hasRequestAccess(env: AccessEnv, user: RequestActor | undefined, id: number): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id < 1) return false;
  const scope = requestScope(user);
  return Boolean(await env.DB.prepare(`SELECT r.id FROM requests r WHERE r.id = ? AND ${scope.sql}`).bind(id, ...scope.bindings).first());
}
export async function requireRequestAccess(env: AccessEnv, id: number): Promise<void> {
  if (!await hasRequestAccess(env, env.REQUEST_USER, id)) throw new RequestAccessError();
}
export async function hasClientAccess(env: AccessEnv, id: number): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id < 1) return false;
  if (env.REQUEST_USER?.role === "admin") return Boolean(await env.DB.prepare("SELECT id FROM crm_clients WHERE id=?").bind(id).first());
  const scope = requestScope(env.REQUEST_USER);
  return Boolean(await env.DB.prepare(`SELECT r.id FROM requests r WHERE r.client_id=? AND ${scope.sql} LIMIT 1`).bind(id, ...scope.bindings).first());
}
