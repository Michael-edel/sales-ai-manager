// Exercise the deployed private KDF on Cloudflare, not Node's more permissive
// crypto implementation. No real accounts, application data or passwords used.
import { randomBytes, randomUUID, scryptSync, pbkdf2Sync, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

if (!process.env.CLOUDFLARE_API_TOKEN)
  throw new Error('Cloudflare deployment credentials are required for the runtime check.');

// Use exactly the account that the main deployment config targets. Wrangler
// gives that explicit config precedence over a possibly stale CI account env.
const deploymentConfig = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
const accountId = deploymentConfig.match(/^account_id\s*=\s*"([a-f0-9]{32})"\s*$/m)?.[1];
if (!accountId) throw new Error('The deployed application account could not be confirmed.');
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const name = 'michael-auth-probe-' + randomUUID().replaceAll('-', '').slice(0, 12);
const folder = await mkdtemp(path.join(tmpdir(), 'michael-auth-probe-'));
const config = path.join(folder, 'wrangler.json');
const token = randomBytes(32).toString('hex');
const password = ' Тест-' + randomBytes(20).toString('hex') + '-🔐 ';
const salt = randomBytes(16);
const fixture = {
  password, salt: salt.toString('base64'),
  scrypt: scryptSync(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('base64'),
  pbkdf2: Object.fromEntries([100000, 600000].map(iterations =>
    [iterations, pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64')])),
};
const redact = text => [token, password, fixture.scrypt, ...Object.values(fixture.pbkdf2)]
  .reduce((value, secret) => value.replaceAll(secret, '[redacted fixture]'), String(text));
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], {
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', () => reject(new Error('Could not launch the Cloudflare runtime check.')));
    child.on('close', code => code === 0 ? resolve(output)
      : reject(new Error(`Cloudflare command failed (${code}): ${redact(output).slice(-2500)}`)));
  });
}
const source = `
const fixture = ${JSON.stringify(fixture)};
export default { async fetch(request, env) {
  if (request.method !== 'POST') return new Response('Not found', {status:404});
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return new Response('Unauthorized', {status:401});
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(authorization.slice(7)));
  const digest = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== env.PROBE_TOKEN_HASH) return new Response('Unauthorized', {status:401});
  const stub = env.PASSWORD_KDF.get(env.PASSWORD_KDF.idFromName('password-kdf-v1'));
  const checks = [];
  async function call(payload, expectedStatus=200) {
    const response = await stub.fetch('https://password-kdf.internal/v1/password', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    });
    if (response.status !== expectedStatus) throw new Error('KDF response status ' + response.status);
    return expectedStatus === 200 ? response.json() : null;
  }
  try {
    checks.push((await call({operation:'derive-scrypt',password:fixture.password,salt:fixture.salt})).hash === fixture.scrypt);
    checks.push((await call({operation:'verify-scrypt',password:fixture.password,salt:fixture.salt,hash:fixture.scrypt})).matches === true);
    checks.push((await call({operation:'verify-scrypt',password:fixture.password+'x',salt:fixture.salt,hash:fixture.scrypt})).matches === false);
    for (const iterations of [100000,600000]) {
      checks.push((await call({operation:'verify-pbkdf2',password:fixture.password,salt:fixture.salt,hash:fixture.pbkdf2[iterations],iterations})).matches === true);
    }
    await call({operation:'derive-scrypt',password:fixture.password,salt:fixture.salt,N:131072},400);
    checks.push(true);
    if (!checks.every(Boolean)) throw new Error('KDF fixture comparison failed');
    return Response.json({ok:true,checks:checks.length});
  } catch {
    return Response.json({ok:false,completedChecks:checks.length}, {status:500});
  }
}};
`;
let attempted = false;
let failure;
try {
  await writeFile(path.join(folder, 'probe.mjs'), source);
  await writeFile(config, JSON.stringify({
    name, main: './probe.mjs', compatibility_date: '2026-06-15', workers_dev: true,
    account_id: accountId,
    vars: { PROBE_TOKEN_HASH: createHash('sha256').update(token).digest('hex') },
    durable_objects: { bindings: [{ name: 'PASSWORD_KDF', class_name: 'PasswordKdf', script_name: 'sales-ai-manager' }] },
  }));
  attempted = true;
  const output = await run(['deploy', '--config', config]);
  const url = (output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/g) || [])
    .find(value => new URL(value).hostname.startsWith(name + '.'));
  if (!url) throw new Error('The temporary runtime-check address was not confirmed.');
  console.log('Temporary runtime probe deployed: ' + name);
  let response;
  // A newly created workers.dev route can return 404 briefly after the upload
  // succeeds. Retry only that routing state, never a failed crypto comparison.
  for (const delay of [0, 2000, 4000, 8000, 16000, 16000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(60000) });
    if (response.status !== 404) break;
    await response.body?.cancel();
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true || result.checks !== 6)
    throw new Error(`Deployed password runtime check failed (HTTP ${response.status}; completed ${Number.isInteger(result?.completedChecks) ? result.completedChecks : 0}/6).`);
  console.log('Cloudflare password runtime: six native/legacy fixture checks passed.');
} catch (error) {
  failure = error;
  throw error;
} finally {
  // Only remove our uniquely named, data-free probe; never the application or DO.
  try {
    if (attempted && /^michael-auth-probe-[a-f0-9]{12}$/.test(name)) {
      // Wrangler delete also lists legacy Workers Sites KV namespaces. This
      // data-free probe has none, so use the Workers Scripts API directly and
      // retain the existing narrow token permissions.
      const deleted = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${name}?force=true`, {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN }, signal: AbortSignal.timeout(30000),
      });
      const result = await deleted.json().catch(() => null);
      if (!deleted.ok || result?.success === false)
        throw new Error(`Temporary runtime probe deletion failed (HTTP ${deleted.status}).`);
      console.log('Temporary runtime probe removed: ' + name);
    }
  } catch (error) {
    // A cleanup failure must not hide the original deployment/crypto failure.
    if (!failure) throw error;
    console.error('Temporary runtime-check cleanup failed: ' + redact(error.message));
  } finally {
    const absoluteFolder = path.resolve(folder);
    if (path.dirname(absoluteFolder) !== path.resolve(tmpdir()) || !path.basename(absoluteFolder).startsWith('michael-auth-probe-'))
      throw new Error('Unsafe temporary runtime-check directory.');
    await rm(absoluteFolder, { recursive: true, force: true });
  }
}
