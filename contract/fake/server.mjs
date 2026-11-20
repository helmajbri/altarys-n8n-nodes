// Fake LetzBill and fake LetzCloud for the contract suite: only the webhook endpoint routes the
// triggers call, and a sender that signs deliveries like the products do. Shapes follow the
// products' own route and schema files; the PR that added this file cites them at path:line.
// A control listener (plain HTTP, private network only) lets the suite read state and ask for
// deliveries. Everything is configured from the environment; nothing has a default.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import { checkVectors, signV1, signV2 } from '../lib/signer.mjs';

function required(name) {
	const value = process.env[name];
	if (value === undefined || value === '') {
		console.error(`fake server not configured: ${name} is not set`);
		process.exit(2);
	}
	return value;
}

const cfg = {
	tlsKey: readFileSync(required('FAKE_TLS_KEY')),
	tlsCert: readFileSync(required('FAKE_TLS_CERT')),
	ca: readFileSync(required('FAKE_CA_FILE')),
	letzbillPort: Number(required('FAKE_LETZBILL_PORT')),
	letzcloudPort: Number(required('FAKE_LETZCLOUD_PORT')),
	controlPort: Number(required('FAKE_CONTROL_PORT')),
	keys: {
		letzbill: required('FAKE_LETZBILL_KEY'),
		'letzcloud-provider': required('FAKE_LETZCLOUD_PROVIDER_KEY'),
		'letzcloud-customer': required('FAKE_LETZCLOUD_CUSTOMER_KEY'),
	},
	eventTypes: {
		letzbill: required('FAKE_LETZBILL_EVENT_TYPES').split(','),
		'letzcloud-provider': required('FAKE_LETZCLOUD_EVENT_TYPES').split(','),
		'letzcloud-customer': required('FAKE_LETZCLOUD_EVENT_TYPES').split(','),
	},
};

// The sender must reproduce the shared vectors before it signs anything.
const vectorCheck = checkVectors(required('FAKE_VECTORS_FILE'), required('FAKE_VECTORS_SHA256'));
if (vectorCheck.failed.length > 0) {
	console.error(`fake sender fails vectors: ${vectorCheck.failed.join(', ')}`);
	process.exit(3);
}
console.log(`fake sender reproduces ${vectorCheck.count} shared vectors`);

const ORG_ID = randomUUID();
const realms = {};
for (const name of Object.keys(cfg.keys)) {
	realms[name] = { endpoints: new Map(), created: 0, deleted: 0, lastValid: new Map() };
}
const requests = [];
let seq = 0;
let authRefused = 0;

function send(res, status, body) {
	if (status === 204 || body === undefined) {
		res.writeHead(status).end();
		return;
	}
	const text = JSON.stringify(body);
	res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
	res.end(text);
}

async function readBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const raw = Buffer.concat(chunks).toString('utf8');
	if (raw === '') return {};
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function bearer(req) {
	const header = String(req.headers.authorization ?? '');
	return header.startsWith('Bearer ') ? header.slice(7) : '';
}

/** Which realm the key belongs to, or undefined. A key never opens another realm. */
function realmOfKey(key) {
	return Object.keys(cfg.keys).find((name) => cfg.keys[name] === key);
}

function record(realm, req, url, status) {
	seq += 1;
	requests.push({ seq, realm, method: req.method, path: url.pathname, query: url.search, status, at: Date.now() });
}

function nowIso() {
	return new Date().toISOString();
}

function newSecret() {
	return `whsec_${randomBytes(24).toString('hex')}`;
}

function intParam(url, name, fallback) {
	const raw = url.searchParams.get(name);
	if (raw === null) return fallback;
	const value = Number(raw);
	return Number.isInteger(value) ? value : Number.NaN;
}

// LetzBill: envelope {success, message, data, errors}; list data {items, total, page, per_page,
// total_pages, has_next}; the url filter is a case-insensitive substring match.
async function letzbill(req, res) {
	const url = new URL(req.url, 'https://fake');
	const realmName = 'letzbill';
	const realm = realms[realmName];
	const done = (status, body) => {
		record(realmName, req, url, status);
		send(res, status, body);
	};
	if (realmOfKey(bearer(req)) !== realmName) {
		authRefused += 1;
		return done(401, { detail: 'Invalid or missing API key' });
	}
	const envelope = (data) => ({ success: true, message: null, data, errors: null });
	const view = (e) => ({
		id: e.id,
		organization_id: ORG_ID,
		webhook_url: e.url,
		url: e.url,
		signature_algo: 1,
		active: true,
		max_attempts: 5,
		event_types: e.event_types,
		deleted_at: null,
		created_at: e.created_at,
		updated_at: e.created_at,
	});
	if (req.method === 'GET' && url.pathname === '/api/v1/webhooks/event_types') {
		return done(200, envelope(cfg.eventTypes[realmName].map((type) => ({ type, description: type }))));
	}
	if (url.pathname === '/api/v1/webhooks/endpoints') {
		if (req.method === 'GET') {
			const page = intParam(url, 'page', 1);
			const perPage = intParam(url, 'per_page', intParam(url, 'page_size', 100));
			if (!(page >= 1) || !(perPage >= 1 && perPage <= 500)) return done(422, { detail: 'bad paging' });
			const needle = (url.searchParams.get('url') ?? '').toLowerCase();
			const all = [...realm.endpoints.values()].filter((e) => e.url.toLowerCase().includes(needle));
			const items = all.slice((page - 1) * perPage, page * perPage).map(view);
			const totalPages = Math.ceil(all.length / perPage);
			return done(
				200,
				envelope({ items, total: all.length, page, per_page: perPage, total_pages: totalPages, has_next: page < totalPages }),
			);
		}
		if (req.method === 'POST') {
			const body = await readBody(req);
			const target = typeof body?.url === 'string' ? body.url : '';
			if (!/^https?:\/\/[^/]/i.test(target) || !Array.isArray(body.event_types)) {
				return done(422, { detail: 'url and event_types are required' });
			}
			const endpoint = { id: randomUUID(), url: target, event_types: body.event_types, secret: newSecret(), created_at: nowIso() };
			realm.endpoints.set(endpoint.id, endpoint);
			realm.created += 1;
			return done(201, envelope({ ...view(endpoint), webhook_secret: endpoint.secret }));
		}
	}
	const match = /^\/api\/v1\/webhooks\/endpoints\/([^/]+)$/.exec(url.pathname);
	if (match && req.method === 'DELETE') {
		const id = decodeURIComponent(match[1]);
		if (!realm.endpoints.delete(id)) return done(404, { detail: 'Webhook endpoint not found' });
		realm.deleted += 1;
		return done(204);
	}
	return done(404, { detail: 'Not Found' });
}

// LetzCloud: bare bodies; list {items, total, page, per_page} with per_page at most 100; a
// provider key opens /api/v1/webhooks, a customer key /api/v1/l3/webhooks, never the other.
async function letzcloud(req, res) {
	const url = new URL(req.url, 'https://fake');
	const keyRealm = realmOfKey(bearer(req));
	const base = url.pathname.startsWith('/api/v1/l3/webhooks') ? '/api/v1/l3/webhooks' : '/api/v1/webhooks';
	const realmName = base === '/api/v1/l3/webhooks' ? 'letzcloud-customer' : 'letzcloud-provider';
	const realm = realms[realmName];
	const done = (status, body) => {
		record(realmName, req, url, status);
		send(res, status, body);
	};
	if (req.method === 'GET' && url.pathname === '/.well-known/letzcloud-appliance') {
		return done(200, { appliance_public_key: 'contract-test-key', fingerprint: 'contract-test-fingerprint' });
	}
	if (!url.pathname.startsWith(base)) return done(404, { detail: 'Not Found' });
	if (keyRealm === undefined || keyRealm === 'letzbill') {
		authRefused += 1;
		return done(401, { detail: 'Invalid or missing API key' });
	}
	if (keyRealm !== realmName) {
		authRefused += 1;
		return done(403, { detail: 'This key cannot use these routes' });
	}
	const view = (e) => ({
		id: e.id,
		...(realmName === 'letzcloud-provider' ? { organization_id: ORG_ID } : {}),
		url: e.url,
		event_types: e.event_types,
		active: true,
		max_attempts: 5,
		configured_secret: true,
		created_at: e.created_at,
		updated_at: e.created_at,
	});
	if (req.method === 'GET' && url.pathname === `${base}/event_types`) {
		const items = cfg.eventTypes[realmName].map((type) => ({ type, description: type }));
		return done(200, { items, total: items.length });
	}
	if (url.pathname === `${base}/endpoints`) {
		if (req.method === 'GET') {
			const page = intParam(url, 'page', 1);
			const perPage = intParam(url, 'per_page', 20);
			if (!(page >= 1) || !(perPage >= 1 && perPage <= 100)) return done(422, { detail: 'bad paging' });
			const all = [...realm.endpoints.values()];
			const items = all.slice((page - 1) * perPage, page * perPage).map(view);
			return done(200, { items, total: all.length, page, per_page: perPage });
		}
		if (req.method === 'POST') {
			const body = await readBody(req);
			const target = typeof body?.url === 'string' ? body.url : '';
			if (!/^https:\/\/[^/]/i.test(target) || !Array.isArray(body.event_types)) {
				return done(422, { detail: 'an https url and event_types are required' });
			}
			const endpoint = { id: randomUUID(), url: target, event_types: body.event_types, secret: newSecret(), created_at: nowIso() };
			realm.endpoints.set(endpoint.id, endpoint);
			realm.created += 1;
			return done(201, {
				...view(endpoint),
				secret: endpoint.secret,
				warning: 'Store this secret securely. It cannot be retrieved again.',
			});
		}
	}
	const match = new RegExp(`^${base}/endpoints/([^/]+)$`).exec(url.pathname);
	if (match && req.method === 'DELETE') {
		const id = decodeURIComponent(match[1]);
		if (!realm.endpoints.delete(id)) return done(404, { detail: 'Webhook endpoint not found' });
		realm.deleted += 1;
		return done(204);
	}
	return done(404, { detail: 'Not Found' });
}

function post(target, headers, body) {
	return new Promise((resolve, reject) => {
		const req = https.request(
			target,
			{ method: 'POST', headers: { ...headers, 'content-length': body.length }, ca: cfg.ca, timeout: 30000 },
			(res) => {
				const chunks = [];
				res.on('data', (c) => chunks.push(c));
				res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
			},
		);
		req.on('timeout', () => req.destroy(new Error('delivery timed out')));
		req.on('error', reject);
		req.end(body);
	});
}

function flipLastHex(hex) {
	const last = hex.at(-1);
	return hex.slice(0, -1) + (last === '0' ? '1' : '0');
}

/**
 * Sends one delivery to the single live endpoint of `realm` whose URL contains `urlContains`.
 * kind: valid (signed now) | replay (the last valid delivery's bytes and headers, unchanged) |
 * tamper-signature (one hex digit of v2 changed) | tamper-body (body changed after signing).
 */
async function deliver({ realm: realmName, urlContains, kind, eventId, eventType }) {
	const realm = realms[realmName];
	if (!realm) return { status: 400, error: `unknown realm ${realmName}` };
	const matches = [...realm.endpoints.values()].filter((e) => e.url.includes(urlContains));
	if (matches.length !== 1) return { status: 409, error: `${matches.length} live endpoints match`, matches: matches.length };
	const endpoint = matches[0];
	if (kind === 'replay') {
		const last = realm.lastValid.get(endpoint.id);
		if (!last) return { status: 409, error: 'no valid delivery to replay' };
		const answer = await post(endpoint.url, last.headers, last.body);
		return { ...answer, eventId: last.eventId, timestamp: last.timestamp };
	}
	const objectType = realmName === 'letzbill' ? 'invoice' : 'instance';
	const envelope = {
		webhook_type: eventType,
		object_type: objectType,
		[objectType]: { id: randomUUID() },
		metadata: { event_id: eventId, timestamp: nowIso(), api_version: 'contract-test' },
	};
	let body = Buffer.from(JSON.stringify(envelope), 'utf8');
	const timestamp = String(Math.floor(Date.now() / 1000));
	let v2 = signV2(endpoint.secret, timestamp, body);
	const v1 = signV1(endpoint.secret, body);
	if (kind === 'tamper-signature') v2 = flipLastHex(v2);
	if (kind === 'tamper-body') {
		envelope[objectType].id = randomUUID();
		body = Buffer.from(JSON.stringify(envelope), 'utf8');
	}
	if (!['valid', 'tamper-signature', 'tamper-body'].includes(kind)) return { status: 400, error: `unknown kind ${kind}` };
	const headers = {
		'content-type': 'application/json',
		'x-webhook-timestamp': timestamp,
		'x-webhook-signature-v2': v2,
		'x-webhook-signature': v1,
	};
	if (realmName === 'letzbill') {
		headers['x-webhook-event-type'] = eventType;
		headers['x-webhook-delivery-id'] = randomUUID();
	}
	const answer = await post(endpoint.url, headers, body);
	if (kind === 'valid') realm.lastValid.set(endpoint.id, { headers, body, eventId, timestamp });
	return { ...answer, eventId, timestamp };
}

async function control(req, res) {
	const url = new URL(req.url, 'http://control');
	try {
		if (req.method === 'GET' && url.pathname === '/_control/health') return send(res, 200, { ok: true });
		if (req.method === 'GET' && url.pathname === '/_control/state') {
			const out = {};
			for (const [name, realm] of Object.entries(realms)) {
				out[name] = {
					live: [...realm.endpoints.values()].map((e) => ({ id: e.id, url: e.url, event_types: e.event_types })),
					created: realm.created,
					deleted: realm.deleted,
				};
			}
			return send(res, 200, { seq, authRefused, realms: out });
		}
		if (req.method === 'POST' && url.pathname === '/_control/mark') return send(res, 200, { seq });
		if (req.method === 'GET' && url.pathname === '/_control/requests') {
			const since = Number(url.searchParams.get('since') ?? 0);
			return send(res, 200, requests.filter((r) => r.seq > since));
		}
		if (req.method === 'POST' && url.pathname === '/_control/deliver') {
			const body = await readBody(req);
			return send(res, 200, await deliver(body ?? {}));
		}
		return send(res, 404, { error: 'unknown control route' });
	} catch (error) {
		return send(res, 500, { error: String(error?.message ?? error) });
	}
}

const tls = { key: cfg.tlsKey, cert: cfg.tlsCert };
https.createServer(tls, (req, res) => void letzbill(req, res)).listen(cfg.letzbillPort, () =>
	console.log(`fake LetzBill on https :${cfg.letzbillPort}`),
);
https.createServer(tls, (req, res) => void letzcloud(req, res)).listen(cfg.letzcloudPort, () =>
	console.log(`fake LetzCloud on https :${cfg.letzcloudPort}`),
);
http.createServer((req, res) => void control(req, res)).listen(cfg.controlPort, () =>
	console.log(`control on http :${cfg.controlPort}`),
);
