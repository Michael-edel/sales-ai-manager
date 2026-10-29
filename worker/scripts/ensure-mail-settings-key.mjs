// Run in the serialized deploy job. The generated key exists only in memory and
// Wrangler's stdin; it is never an argument, file, artifact or log entry.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export async function ensureMailSettingsKey({ configText, run, random = randomBytes }) {
  const accountId = configText.match(/^account_id\s*=\s*"([a-f0-9]{32})"\s*$/m)?.[1];
  const workerName = configText.match(/^name\s*=\s*"([a-z0-9-]+)"\s*$/m)?.[1];
  if (!accountId || !workerName) throw new Error('The configured deployment account and Worker could not be confirmed.');
  const config = fileURLToPath(new URL('../wrangler.toml', import.meta.url));
  const common = ['--config', config, '--name', workerName];
  const secrets = JSON.parse(await run(['secret', 'list', '--format', 'json', ...common], undefined, accountId));
  if (!Array.isArray(secrets) || secrets.some(item => !item || typeof item.name !== 'string')) throw new Error('Could not verify existing Worker secret names.');
  if (secrets.some(item => item.name === 'SMTP_SETTINGS_KEY')) return { created: false };
  const generated = random(32);
  try {
    await run(['secret', 'put', 'SMTP_SETTINGS_KEY', ...common], generated.toString('base64') + '\n', accountId);
    const confirmed = JSON.parse(await run(['secret', 'list', '--format', 'json', ...common], undefined, accountId));
    if (!Array.isArray(confirmed) || !confirmed.some(item => item.name === 'SMTP_SETTINGS_KEY')) throw new Error('Worker secret creation was not confirmed.');
    return { created: true };
  } finally { generated.fill(0); }
}
async function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error('Cloudflare deployment credentials are required.');
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const run = (args, input, accountId) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], {
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', exceeded = false;
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 1024 * 1024) { exceeded = true; child.kill(); } });
    child.stderr.on('data', () => {}); // Never echo diagnostics from a command that handles a secret.
    child.stdin.on('error', () => {});
    child.on('error', () => reject(new Error('Could not launch Worker secret provisioning.')));
    child.on('close', code => code === 0 && !exceeded ? resolve(output) : reject(new Error('Worker secret provisioning failed. Check deployment token permissions.')));
    child.stdin.end(input || '');
  });
  const configText = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const result = await ensureMailSettingsKey({ configText, run });
  console.log(result.created ? 'SMTP settings encryption secret created.' : 'SMTP settings encryption secret already exists; preserved.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Could not ensure the SMTP settings encryption secret. No key was printed or saved.'); process.exitCode = 1; });
}
