// Activating the trigger twice leaves one LetzBill endpoint, deactivating removes
// it, and a delivery that fails signature v2 produces no workflow item. Runs against dist/.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const { LetzBillTrigger } = require('../dist/nodes/LetzBillTrigger/LetzBillTrigger.node.js');
const { signV2, verifySignatureV2, DEFAULT_TOLERANCE_SECONDS, MAX_TOLERANCE_SECONDS } = require(
	'../dist/nodes/LetzBillTrigger/signature.js',
);
const { rememberEvent, MAX_REMEMBERED_EVENTS } = require('../dist/nodes/LetzBillTrigger/dedupe.js');

// A byte-identical copy of the shared vectors file every sender and verifier reproduces.
const VECTORS_SHA256 = '1910a28ed1ea338402bec8ca8bb977e906cf871946d8607f0b956e19defb48ac';
const vectorsBytes = readFileSync(join(packageDir, 'test/fixtures/webhook_signature_v2_vectors.json'));

const WEBHOOK_URL = 'https://n8n.example.com/webhook/0f6c2c1e/webhook';
const node = { id: '1', name: 'LetzBill Trigger', type: 'letzBillTrigger', typeVersion: 1, position: [0, 0], parameters: {} };
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('the vectors file is the pinned shared copy', () => {
	assert.equal(createHash('sha256').update(vectorsBytes).digest('hex'), VECTORS_SHA256);
});

const vectors = JSON.parse(vectorsBytes.toString('utf8'));

for (const v of vectors.vectors) {
	test(`signature v2 reproduces vector ${v.name}`, () => {
		const body = Buffer.from(v.body_hex, 'hex');
		assert.equal(body.toString('utf8'), v.body_utf8);
		assert.equal(signV2(v.secret, String(v.timestamp), body), v.expected_v2);
		const base = { timestamp: String(v.timestamp), signature: v.expected_v2, rawBody: body, secret: v.secret };
		assert.deepEqual(verifySignatureV2({ ...base, nowSeconds: v.timestamp, toleranceSeconds: 300 }), { ok: true });
		assert.deepEqual(
			verifySignatureV2({ ...base, nowSeconds: v.timestamp + 300, toleranceSeconds: 300 }),
			{ ok: true },
		);
		assert.deepEqual(
			verifySignatureV2({ ...base, nowSeconds: v.timestamp + 301, toleranceSeconds: 300 }),
			{ ok: false, reason: 'timestamp_outside_tolerance' },
		);
		const tampered = Buffer.from(body);
		tampered[0] ^= 0x01;
		assert.deepEqual(
			verifySignatureV2({ ...base, rawBody: tampered, nowSeconds: v.timestamp, toleranceSeconds: 300 }),
			{ ok: false, reason: 'signature_mismatch' },
		);
	});
}

test('v1 alone is not accepted, and malformed headers are refused', () => {
	const c = vectors.v1_control;
	const body = Buffer.from(c.body_utf8, 'utf8');
	const now = 1700000000;
	const check = (over) =>
		verifySignatureV2({ timestamp: String(now), signature: c.expected_v1, rawBody: body, secret: c.secret, nowSeconds: now, toleranceSeconds: 300, ...over });
	assert.deepEqual(check({}), { ok: false, reason: 'signature_mismatch' });
	assert.deepEqual(check({ timestamp: undefined }), { ok: false, reason: 'missing_parameters' });
	assert.deepEqual(check({ signature: undefined }), { ok: false, reason: 'missing_parameters' });
	assert.deepEqual(check({ timestamp: '+5' }), { ok: false, reason: 'bad_timestamp' });
	assert.deepEqual(check({ timestamp: '5.0' }), { ok: false, reason: 'bad_timestamp' });
	assert.deepEqual(check({ timestamp: '1234567890123456' }), { ok: false, reason: 'bad_timestamp' });
	assert.deepEqual(check({ secret: '' }), { ok: false, reason: 'no_secret' });
	assert.equal(DEFAULT_TOLERANCE_SECONDS, 300);
});

test('a tolerance that is not a number from 1 to the cap refuses every delivery', () => {
	const v = vectors.vectors[0];
	const body = Buffer.from(v.body_hex, 'hex');
	const check = (toleranceSeconds, nowSeconds = v.timestamp) =>
		verifySignatureV2({ timestamp: String(v.timestamp), signature: v.expected_v2, rawBody: body, secret: v.secret, nowSeconds, toleranceSeconds });
	assert.equal(MAX_TOLERANCE_SECONDS, 900);
	for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -5, 901, 1e9]) {
		assert.deepEqual(check(bad), { ok: false, reason: 'bad_tolerance' }, String(bad));
	}
	assert.deepEqual(check(900), { ok: true });
	assert.deepEqual(check(900, Number.NaN), { ok: false, reason: 'timestamp_outside_tolerance' });
});

/** An in-memory LetzBill holding webhook endpoints, answering like the real routes. */
function fakeLetzBill() {
	const endpoints = new Map();
	const pending = new Set();
	let next = 0;
	const calls = [];
	async function handle(options) {
		calls.push(`${options.method} ${options.url}`);
		assert.equal(options.baseURL, 'https://billing.example.com');
		const base = '/api/v1/webhooks/endpoints';
		if (options.method === 'GET' && options.url === base) {
			const filter = String(options.qs?.url ?? '');
			const items = [...endpoints.values()].filter((e) => e.webhook_url.includes(filter));
			return { statusCode: 200, headers: {}, body: { success: true, data: { items, total: items.length, page: 1, per_page: 500 } } };
		}
		if (options.method === 'POST' && options.url === base) {
			next += 1;
			const id = `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
			const endpoint = { id, webhook_url: options.body.url, event_types: options.body.event_types, active: true };
			endpoints.set(id, endpoint);
			return { statusCode: 201, headers: {}, body: { success: true, data: { ...endpoint, webhook_secret: `whsec_fake_${next}` } } };
		}
		if (options.method === 'DELETE' && options.url.startsWith(`${base}/`)) {
			const id = decodeURIComponent(options.url.slice(base.length + 1));
			if (!endpoints.has(id)) return { statusCode: 404, headers: {}, body: { detail: 'Webhook endpoint not found' } };
			if (pending.has(id) && options.qs?.force !== true) {
				return { statusCode: 409, headers: {}, body: { detail: 'Cannot delete endpoint with 1 pending deliveries.' } };
			}
			endpoints.delete(id);
			return { statusCode: 204, headers: {}, body: '' };
		}
		return { statusCode: 404, headers: {}, body: { detail: 'Not Found' } };
	}
	return { endpoints, pending, calls, handle };
}

function hookContext(letzbill, staticData, events = ['invoice.paid']) {
	return {
		getNode: () => node,
		getNodeWebhookUrl: () => WEBHOOK_URL,
		getWorkflowStaticData: () => staticData,
		getNodeParameter: (name, fallback) => (name === 'events' ? events : fallback),
		getCredentials: async () => ({ baseUrl: 'https://billing.example.com', apiKey: 'fb_test_key' }),
		logger: silentLogger,
		helpers: {
			httpRequestWithAuthentication: async function (type, options) {
				assert.equal(type, 'letzBillApi');
				return letzbill.handle(options);
			},
		},
	};
}

const trigger = new LetzBillTrigger();
const hooks = trigger.webhookMethods.default;

async function activate(ctx) {
	if (!(await hooks.checkExists.call(ctx))) await hooks.create.call(ctx);
}

test('activating twice leaves exactly one endpoint; deactivating removes it', async () => {
	const letzbill = fakeLetzBill();
	const staticData = {};
	const ctx = hookContext(letzbill, staticData);
	await activate(ctx);
	assert.equal(letzbill.endpoints.size, 1);
	await activate(ctx);
	assert.equal(letzbill.endpoints.size, 1);
	assert.equal(typeof staticData.endpointSecret, 'string');
	await hooks.delete.call(ctx);
	assert.equal(letzbill.endpoints.size, 0);
	assert.equal(staticData.endpointId, undefined);
	assert.equal(staticData.endpointSecret, undefined);
});

test('a lost secret or changed events replaces the endpoint instead of adding one', async () => {
	const letzbill = fakeLetzBill();
	await activate(hookContext(letzbill, {}));
	// Static data lost: the endpoint exists, but its secret is gone.
	const fresh = {};
	await activate(hookContext(letzbill, fresh));
	assert.equal(letzbill.endpoints.size, 1);
	const [only] = letzbill.endpoints.values();
	assert.equal(only.id, fresh.endpointId);
	// Events changed.
	await activate(hookContext(letzbill, fresh, ['invoice.paid', 'invoice.voided']));
	assert.equal(letzbill.endpoints.size, 1);
	assert.deepEqual([...letzbill.endpoints.values()][0].event_types, ['invoice.paid', 'invoice.voided']);
});

test('the trigger refuses a credential with a plain http:// API URL', async () => {
	const letzbill = fakeLetzBill();
	const ctx = hookContext(letzbill, {});
	ctx.getCredentials = async () => ({ baseUrl: 'http://billing.example.com', apiKey: 'fb_test_key' });
	await assert.rejects(hooks.checkExists.call(ctx), /https/);
	assert.deepEqual(letzbill.calls, []);
});

test('deactivating removes an endpoint that still has pending deliveries', async () => {
	const letzbill = fakeLetzBill();
	const staticData = {};
	const ctx = hookContext(letzbill, staticData);
	await activate(ctx);
	letzbill.pending.add(staticData.endpointId);
	await hooks.delete.call(ctx);
	assert.equal(letzbill.endpoints.size, 0);
});

function webhookContext(staticData, headers, rawBody) {
	const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, send() { return this; }, end() { return this; } };
	return {
		response,
		ctx: {
			getNode: () => node,
			getWorkflow: () => ({ id: 'wf-1', active: true }),
			getWorkflowStaticData: () => staticData,
			getNodeParameter: (name, fallback) => fallback,
			getRequestObject: () => ({ header: (n) => headers[n.toLowerCase()], rawBody }),
			getResponseObject: () => response,
			getBodyData: () => JSON.parse(rawBody.toString('utf8')),
			logger: silentLogger,
		},
	};
}

function signedDelivery(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
	const rawBody = Buffer.from(body, 'utf8');
	return {
		rawBody,
		headers: {
			'x-webhook-timestamp': String(timestamp),
			'x-webhook-signature-v2': signV2(secret, String(timestamp), rawBody),
		},
	};
}

test('a delivery signed with the stored secret becomes one workflow item', async () => {
	const staticData = { endpointId: 'e1', endpointSecret: 'whsec_fake_1' };
	const body = '{"webhook_type":"invoice.paid","object_type":"invoice","invoice":{"id":"i1","total_amount_cents":1250,"currency":"EUR"},"metadata":{"event_id":"ev1"}}';
	const { rawBody, headers } = signedDelivery('whsec_fake_1', body);
	const { ctx } = webhookContext(staticData, headers, rawBody);
	const result = await trigger.webhook.call(ctx);
	assert.equal(result.workflowData.length, 1);
	assert.equal(result.workflowData[0].length, 1);
	assert.equal(result.workflowData[0][0].json.metadata.event_id, 'ev1');
});

test('a tampered, replayed or unsigned delivery produces no workflow item', async () => {
	const staticData = { endpointId: 'e1', endpointSecret: 'whsec_fake_1' };
	const body = '{"webhook_type":"invoice.paid","metadata":{"event_id":"ev2"}}';
	const cases = [];
	{
		const d = signedDelivery('whsec_fake_1', body);
		cases.push(['tampered body', d.headers, Buffer.from(body.replace('ev2', 'ev3'), 'utf8')]);
	}
	{
		const d = signedDelivery('whsec_other', body);
		cases.push(['wrong secret', d.headers, d.rawBody]);
	}
	{
		const d = signedDelivery('whsec_fake_1', body, Math.floor(Date.now() / 1000) - 3600);
		cases.push(['replayed an hour later', d.headers, d.rawBody]);
	}
	cases.push(['unsigned', {}, Buffer.from(body, 'utf8')]);
	for (const [label, headers, rawBody] of cases) {
		const { ctx, response } = webhookContext(staticData, headers, rawBody);
		const result = await trigger.webhook.call(ctx);
		assert.equal(result.workflowData, undefined, label);
		assert.equal(result.noWebhookResponse, true, label);
		assert.equal(response.statusCode, 401, label);
	}
});

test('a delivery replayed inside the tolerance window produces no second item', async () => {
	const staticData = { endpointId: 'e1', endpointSecret: 'whsec_fake_1' };
	const body = '{"webhook_type":"invoice.paid","metadata":{"event_id":"ev-replay"}}';
	const first = signedDelivery('whsec_fake_1', body);
	const run = async (delivery) => {
		const { ctx, response } = webhookContext(staticData, delivery.headers, delivery.rawBody);
		return { result: await trigger.webhook.call(ctx), response };
	};
	const once = await run(first);
	assert.equal(once.result.workflowData.length, 1);
	// The same signed request again, a second later: inside the window, so it verifies.
	const replay = await run(first);
	assert.equal(replay.result.workflowData, undefined);
	assert.equal(replay.result.webhookResponse, 'Duplicate delivery ignored');
	assert.equal(replay.response.statusCode, 200);
	// LetzBill's own retry: fresh timestamp and signature, same event ID.
	const retry = await run(signedDelivery('whsec_fake_1', body, Math.floor(Date.now() / 1000) + 1));
	assert.equal(retry.result.workflowData, undefined);
	assert.ok('ev-replay' in staticData.seenEvents);
	// Another event is still delivered.
	const other = await run(signedDelivery('whsec_fake_1', body.replace('ev-replay', 'ev-other')));
	assert.equal(other.result.workflowData.length, 1);
});

test('remembered event IDs are pruned past the window and bounded in number', () => {
	const now = 1_800_000_000;
	const kept = rememberEvent({ old: now - 301, recent: now - 10, junk: 'x' }, 'new', now, now, 300);
	assert.equal(kept.duplicate, false);
	assert.deepEqual(Object.keys(kept.next).sort(), ['new', 'recent']);
	assert.equal(rememberEvent(kept.next, 'recent', now, now, 300).duplicate, true);
	let seen = {};
	for (let i = 0; i < MAX_REMEMBERED_EVENTS + 50; i++) seen = rememberEvent(seen, `e${i}`, now + i, now, 300).next;
	assert.equal(Object.keys(seen).length, MAX_REMEMBERED_EVENTS);
	assert.ok(!('e0' in seen));
	assert.ok(`e${MAX_REMEMBERED_EVENTS + 49}` in seen);
});

test('the trigger follows the trigger-node rules', () => {
	const d = trigger.description;
	assert.ok(d.name.endsWith('Trigger'));
	assert.ok(d.displayName.includes('Trigger'));
	assert.deepEqual(d.inputs, []);
	assert.equal(d.usableAsTool, undefined);
	for (const m of ['checkExists', 'create', 'delete']) assert.equal(typeof hooks[m], 'function');
	const tolerance = d.properties.find((p) => p.name === 'toleranceSeconds');
	assert.equal(tolerance.default, DEFAULT_TOLERANCE_SECONDS);
	assert.equal(tolerance.typeOptions.maxValue, MAX_TOLERANCE_SECONDS);
});
