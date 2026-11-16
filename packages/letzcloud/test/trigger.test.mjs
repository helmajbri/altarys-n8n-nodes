// Activating the trigger twice leaves one LetzCloud endpoint, deactivating removes it, and a
// delivery that fails signature v2 produces no workflow item -- for a provider key and for a
// customer key. Runs against dist/.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { LetzCloudTrigger, MAX_ENDPOINT_PAGES } = require('../dist/nodes/LetzCloudTrigger/LetzCloudTrigger.node.js');
const { signV2, verifySignatureV2, DEFAULT_TOLERANCE_SECONDS, MAX_TOLERANCE_SECONDS } = require(
	'../dist/nodes/LetzCloudTrigger/signature.js',
);
const { rememberEvent, MAX_REMEMBERED_EVENTS } = require('../dist/nodes/LetzCloudTrigger/dedupe.js');

// The shared vectors every sender and verifier reproduces: one byte-identical copy in this
// repository, pinned by hash.
const VECTORS_SHA256 = '1910a28ed1ea338402bec8ca8bb977e906cf871946d8607f0b956e19defb48ac';
const vectorsBytes = readFileSync(join(repoRoot, 'packages/letzbill/test/fixtures/webhook_signature_v2_vectors.json'));

const BASE = 'https://cloud.example.com';
const WEBHOOK_URL = 'https://n8n.example.com/webhook/7c1d2e3f/webhook';
const node = { id: '1', name: 'LetzCloud Trigger', type: 'letzCloudTrigger', typeVersion: 1, position: [0, 0], parameters: {} };
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('the vectors file is the pinned shared copy', () => {
	assert.equal(createHash('sha256').update(vectorsBytes).digest('hex'), VECTORS_SHA256);
});

const vectors = JSON.parse(vectorsBytes.toString('utf8'));

for (const v of vectors.vectors) {
	test(`signature v2 reproduces vector ${v.name}`, () => {
		const body = Buffer.from(v.body_hex, 'hex');
		assert.equal(signV2(v.secret, String(v.timestamp), body), v.expected_v2);
		const base = { timestamp: String(v.timestamp), signature: v.expected_v2, rawBody: body, secret: v.secret };
		assert.deepEqual(verifySignatureV2({ ...base, nowSeconds: v.timestamp + 300, toleranceSeconds: 300 }), { ok: true });
		assert.deepEqual(
			verifySignatureV2({ ...base, nowSeconds: v.timestamp - 301, toleranceSeconds: 300 }),
			{ ok: false, reason: 'timestamp_outside_tolerance' },
		);
		const tampered = Buffer.from(body);
		tampered[tampered.length - 1] ^= 0x01;
		assert.deepEqual(
			verifySignatureV2({ ...base, rawBody: tampered, nowSeconds: v.timestamp, toleranceSeconds: 300 }),
			{ ok: false, reason: 'signature_mismatch' },
		);
	});
}

test('v1 alone is not accepted, and a tolerance off the 1..900 range refuses every delivery', () => {
	const c = vectors.v1_control;
	const body = Buffer.from(c.body_utf8, 'utf8');
	const now = 1700000000;
	const check = (over) =>
		verifySignatureV2({ timestamp: String(now), signature: c.expected_v1, rawBody: body, secret: c.secret, nowSeconds: now, toleranceSeconds: 300, ...over });
	assert.deepEqual(check({}), { ok: false, reason: 'signature_mismatch' });
	assert.deepEqual(check({ signature: undefined }), { ok: false, reason: 'missing_parameters' });
	assert.deepEqual(check({ secret: '' }), { ok: false, reason: 'no_secret' });
	assert.equal(MAX_TOLERANCE_SECONDS, 900);
	assert.equal(DEFAULT_TOLERANCE_SECONDS, 300);
	for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 901]) {
		assert.deepEqual(check({ toleranceSeconds: bad }), { ok: false, reason: 'bad_tolerance' }, String(bad));
	}
	const v = vectors.vectors[0];
	const ok = { timestamp: String(v.timestamp), signature: v.expected_v2, rawBody: Buffer.from(v.body_hex, 'hex'), secret: v.secret, toleranceSeconds: 300 };
	assert.deepEqual(verifySignatureV2({ ...ok, nowSeconds: Number.NaN }), { ok: false, reason: 'timestamp_outside_tolerance' });
});

/**
 * An in-memory appliance holding the provider's and the customers' endpoints on their own
 * routes, answering like the real ones: no URL filter on the list, the secret returned once.
 */
function fakeAppliance({ filler = 0 } = {}) {
	const sides = { '/api/v1/webhooks': new Map(), '/api/v1/l3/webhooks': new Map() };
	let next = 0;
	const calls = [];
	const newId = () => {
		next += 1;
		return `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
	};
	for (let i = 0; i < filler; i++) {
		const id = newId();
		sides['/api/v1/webhooks'].set(id, { id, url: `https://other.example.com/hook/${i}`, event_types: ['instance.created'], active: true });
	}
	async function handle(options) {
		calls.push(`${options.method} ${options.url}`);
		assert.equal(options.baseURL, BASE);
		for (const [base, endpoints] of Object.entries(sides)) {
			if (options.method === 'GET' && options.url === `${base}/event_types`) {
				const types = base.includes('/l3/') ? ['instance.created', 'invoice.finalized'] : ['instance.created'];
				return { statusCode: 200, headers: {}, body: { items: types.map((t) => ({ type: t, object_type: t.split('.')[0], description: t, payload_schema: 'x' })), total: types.length } };
			}
			if (options.method === 'GET' && options.url === `${base}/endpoints`) {
				assert.equal(options.qs.url, undefined, 'the list takes no url filter');
				const all = [...endpoints.values()];
				const { page, per_page: perPage } = options.qs;
				assert.ok(perPage <= 100);
				const items = all.slice((page - 1) * perPage, page * perPage);
				return { statusCode: 200, headers: {}, body: { items, total: all.length, page, per_page: perPage } };
			}
			if (options.method === 'POST' && options.url === `${base}/endpoints`) {
				const id = newId();
				const endpoint = { id, url: options.body.url, event_types: options.body.event_types, active: true };
				endpoints.set(id, endpoint);
				return { statusCode: 201, headers: {}, body: { ...endpoint, configured_secret: true, secret: `whsec_fake_${next}` } };
			}
			if (options.method === 'DELETE' && options.url.startsWith(`${base}/endpoints/`)) {
				const id = decodeURIComponent(options.url.slice(`${base}/endpoints/`.length));
				if (!endpoints.has(id)) return { statusCode: 404, headers: {}, body: { error: { code: 'RES_NOT_FOUND', type: 'resource', message: 'Webhook endpoint not found' } } };
				endpoints.delete(id);
				return { statusCode: 204, headers: {}, body: '' };
			}
		}
		return { statusCode: 404, headers: {}, body: { detail: 'Not Found' } };
	}
	return { provider: sides['/api/v1/webhooks'], customer: sides['/api/v1/l3/webhooks'], calls, handle };
}

function hookContext(appliance, staticData, { events = ['instance.created'], subscribeAs = 'provider', baseUrl = BASE, webhookUrl = WEBHOOK_URL } = {}) {
	return {
		getNode: () => node,
		getNodeWebhookUrl: () => webhookUrl,
		getWorkflowStaticData: () => staticData,
		getNodeParameter: (name, fallback) => (name === 'events' ? events : name === 'subscribeAs' ? subscribeAs : fallback),
		getCredentials: async () => ({ baseUrl, apiKey: 'bff_sa_test' }),
		logger: silentLogger,
		helpers: {
			httpRequestWithAuthentication: async function (type, options) {
				assert.equal(type, 'letzCloudApi');
				return appliance.handle(options);
			},
		},
	};
}

const trigger = new LetzCloudTrigger();
const hooks = trigger.webhookMethods.default;

async function activate(ctx) {
	if (!(await hooks.checkExists.call(ctx))) await hooks.create.call(ctx);
}

for (const subscribeAs of ['provider', 'customer']) {
	test(`${subscribeAs} key: activating twice leaves exactly one endpoint; deactivating removes it`, async () => {
		const appliance = fakeAppliance();
		const staticData = {};
		const ctx = hookContext(appliance, staticData, { subscribeAs });
		await activate(ctx);
		await activate(ctx);
		const mine = appliance[subscribeAs];
		const other = appliance[subscribeAs === 'provider' ? 'customer' : 'provider'];
		assert.equal(mine.size, 1);
		assert.equal(other.size, 0);
		assert.equal(staticData.subscribeAs, subscribeAs);
		assert.equal(typeof staticData.endpointSecret, 'string');
		await hooks.delete.call(ctx);
		assert.equal(mine.size, 0);
		assert.equal(staticData.endpointId, undefined);
		assert.equal(staticData.endpointSecret, undefined);
	});
}

test('a lost secret or changed events replaces the endpoint instead of adding one', async () => {
	const appliance = fakeAppliance();
	await activate(hookContext(appliance, {}));
	const fresh = {};
	await activate(hookContext(appliance, fresh));
	assert.equal(appliance.provider.size, 1);
	assert.equal([...appliance.provider.values()][0].id, fresh.endpointId);
	await activate(hookContext(appliance, fresh, { events: ['instance.created', 'instance.deleted'] }));
	assert.equal(appliance.provider.size, 1);
	assert.deepEqual([...appliance.provider.values()][0].event_types, ['instance.created', 'instance.deleted']);
});

test('the endpoint is found past the first page of the list', async () => {
	const appliance = fakeAppliance({ filler: 150 });
	const staticData = {};
	await activate(hookContext(appliance, staticData));
	await activate(hookContext(appliance, staticData));
	const ours = [...appliance.provider.values()].filter((e) => e.url === WEBHOOK_URL);
	assert.equal(ours.length, 1);
	assert.equal(appliance.provider.size, 151);
	assert.ok(appliance.calls.includes('GET /api/v1/webhooks/endpoints'));
	assert.ok(MAX_ENDPOINT_PAGES >= 1);
});

test('switching Subscribe As removes the endpoint on the side it was on', async () => {
	const appliance = fakeAppliance();
	const staticData = {};
	await activate(hookContext(appliance, staticData, { subscribeAs: 'provider' }));
	assert.equal(appliance.provider.size, 1);
	await activate(hookContext(appliance, staticData, { subscribeAs: 'customer' }));
	assert.equal(appliance.provider.size, 0);
	assert.equal(appliance.customer.size, 1);
	assert.equal(staticData.subscribeAs, 'customer');
});

test('the trigger refuses an http:// appliance URL or webhook URL before registering anything', async () => {
	const appliance = fakeAppliance();
	await assert.rejects(hooks.checkExists.call(hookContext(appliance, {}, { baseUrl: 'http://cloud.example.com' })), /https/);
	assert.deepEqual(appliance.calls, []);
	await assert.rejects(hooks.create.call(hookContext(appliance, {}, { webhookUrl: 'http://n8n.example.com/webhook/x' })), /https/);
	assert.deepEqual(appliance.calls, []);
});

test('the event picker reads the catalogue of the chosen side', async () => {
	const appliance = fakeAppliance();
	const load = (subscribeAs) => trigger.methods.loadOptions.getEventTypes.call(hookContext(appliance, {}, { subscribeAs }));
	assert.deepEqual((await load('provider')).map((o) => o.value), ['instance.created']);
	assert.deepEqual((await load('customer')).map((o) => o.value), ['instance.created', 'invoice.finalized']);
	assert.deepEqual(appliance.calls, ['GET /api/v1/webhooks/event_types', 'GET /api/v1/l3/webhooks/event_types']);
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

const envelope = (eventId) =>
	JSON.stringify({
		webhook_type: 'invoice.finalized',
		object_type: 'invoice',
		invoice: { id: 'inv-1', amount_cents: 12000, currency: 'EUR' },
		metadata: { event_id: eventId, timestamp: '2026-11-16T10:00:00+00:00', api_version: 'v1' },
	});

test('a delivery signed with the stored secret becomes one workflow item', async () => {
	const staticData = { endpointId: 'e1', endpointSecret: 'whsec_fake_1', subscribeAs: 'customer' };
	const { rawBody, headers } = signedDelivery('whsec_fake_1', envelope('ev1'));
	const { ctx } = webhookContext(staticData, headers, rawBody);
	const result = await trigger.webhook.call(ctx);
	assert.equal(result.workflowData[0].length, 1);
	assert.equal(result.workflowData[0][0].json.invoice.amount_cents, 12000);
	assert.equal(result.workflowData[0][0].json.invoice.currency, 'EUR');
});

test('a tampered, wrongly signed, stale or unsigned delivery produces no workflow item', async () => {
	const staticData = { endpointId: 'e1', endpointSecret: 'whsec_fake_1' };
	const body = envelope('ev2');
	const cases = [];
	{
		const d = signedDelivery('whsec_fake_1', body);
		cases.push(['tampered body', d.headers, Buffer.from(body.replace('12000', '1'), 'utf8')]);
	}
	{
		const d = signedDelivery('whsec_other', body);
		cases.push(['wrong secret', d.headers, d.rawBody]);
	}
	{
		const d = signedDelivery('whsec_fake_1', body, Math.floor(Date.now() / 1000) - 3600);
		cases.push(['an hour old', d.headers, d.rawBody]);
	}
	{
		const d = signedDelivery('whsec_fake_1', body, Math.floor(Date.now() / 1000) + 3600);
		cases.push(['an hour ahead', d.headers, d.rawBody]);
	}
	cases.push(['unsigned', {}, Buffer.from(body, 'utf8')]);
	cases.push(['v1 header only', { 'x-webhook-signature': 'abc', 'x-webhook-timestamp': String(Math.floor(Date.now() / 1000)) }, Buffer.from(body, 'utf8')]);
	for (const [label, headers, rawBody] of cases) {
		const { ctx, response } = webhookContext(staticData, headers, rawBody);
		const result = await trigger.webhook.call(ctx);
		assert.equal(result.workflowData, undefined, label);
		assert.equal(result.noWebhookResponse, true, label);
		assert.equal(response.statusCode, 401, label);
	}
	// Without a stored secret nothing verifies.
	const d = signedDelivery('whsec_fake_1', body);
	const { ctx } = webhookContext({}, d.headers, d.rawBody);
	assert.equal((await trigger.webhook.call(ctx)).workflowData, undefined);
});

test('a delivery replayed inside the tolerance window produces no second item', async () => {
	const staticData = { endpointId: 'e1', endpointSecret: 'whsec_fake_1' };
	const run = async (delivery) => {
		const { ctx, response } = webhookContext(staticData, delivery.headers, delivery.rawBody);
		return { result: await trigger.webhook.call(ctx), response };
	};
	const first = signedDelivery('whsec_fake_1', envelope('ev-replay'));
	assert.equal((await run(first)).result.workflowData.length, 1);
	const replay = await run(first);
	assert.equal(replay.result.workflowData, undefined);
	assert.equal(replay.result.webhookResponse, 'Duplicate delivery ignored');
	assert.equal(replay.response.statusCode, 200);
	// The appliance's own retry: a fresh timestamp and signature, the same event ID.
	const retry = await run(signedDelivery('whsec_fake_1', envelope('ev-replay'), Math.floor(Date.now() / 1000) + 1));
	assert.equal(retry.result.workflowData, undefined);
	const other = await run(signedDelivery('whsec_fake_1', envelope('ev-other')));
	assert.equal(other.result.workflowData.length, 1);
});

test('remembered event IDs are pruned past the window and bounded in number', () => {
	const now = 1_800_000_000;
	const kept = rememberEvent({ old: now - 301, recent: now - 10, junk: 'x' }, 'new', now, now, 300);
	assert.deepEqual(Object.keys(kept.next).sort(), ['new', 'recent']);
	let seen = {};
	for (let i = 0; i < MAX_REMEMBERED_EVENTS + 20; i++) seen = rememberEvent(seen, `e${i}`, now + i, now, 300).next;
	assert.equal(Object.keys(seen).length, MAX_REMEMBERED_EVENTS);
	assert.ok(!('e0' in seen));
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
	const events = d.properties.find((p) => p.name === 'events');
	assert.deepEqual(events.typeOptions.loadOptionsDependsOn, ['subscribeAs']);
});
