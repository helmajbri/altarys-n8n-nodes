// For a throwaway n8n only: sets up the instance owner and creates a public API key with the
// scopes the suite needs, then writes the key to a file. A real instance gets its key from its
// own secret store instead; this script refuses an instance that already has an owner.
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

function required(name) {
	const value = process.env[name];
	if (!value) throw new Error(`bootstrap not configured: ${name} is not set`);
	return value;
}

// --wait-only: wait until n8n answers ready, then stop (used after a restart).
const waitOnly = process.argv.includes('--wait-only');
const base = required('BOOT_N8N_URL').replace(/\/+$/, '');

const SCOPES = [
	'credential:create',
	'credential:delete',
	'workflow:create',
	'workflow:read',
	'workflow:delete',
	'workflow:activate',
	'workflow:deactivate',
	'execution:list',
	'execution:read',
];

const deadline = Date.now() + 180000;
for (;;) {
	const ok = await fetch(`${base}/healthz/readiness`).then((r) => r.status === 200, () => false);
	if (ok) break;
	if (Date.now() > deadline) throw new Error('n8n did not become ready within 180 s');
	await sleep(2000);
}
console.log('n8n is ready');
if (waitOnly) process.exit(0);

const email = required('BOOT_OWNER_EMAIL');
const password = required('BOOT_OWNER_PASSWORD');
const keyFile = required('BOOT_KEY_FILE');

const setup = await fetch(`${base}/rest/owner/setup`, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ email, firstName: 'Contract', lastName: 'Suite', password }),
});
if (setup.status !== 200) throw new Error(`owner setup: HTTP ${setup.status} ${(await setup.text()).slice(0, 300)}`);
const cookie = setup.headers
	.getSetCookie()
	.map((c) => c.split(';')[0])
	.find((c) => c.startsWith('n8n-auth='));
if (!cookie) throw new Error('owner setup returned no n8n-auth cookie');

const created = await fetch(`${base}/rest/api-keys`, {
	method: 'POST',
	headers: { 'content-type': 'application/json', cookie },
	body: JSON.stringify({ label: 'contract suite', scopes: SCOPES, expiresAt: null }),
});
const text = await created.text();
if (created.status !== 200) throw new Error(`api key: HTTP ${created.status} ${text.slice(0, 300)}`);
const body = JSON.parse(text);
const rawApiKey = body?.data?.rawApiKey ?? body?.rawApiKey;
if (!rawApiKey) throw new Error('n8n returned no rawApiKey');
writeFileSync(keyFile, rawApiKey, { mode: 0o600 });
console.log(`owner set up; public API key with ${SCOPES.length} scopes written to ${keyFile}`);
