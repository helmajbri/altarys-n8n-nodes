// The action node against the scope map: idempotency only where LetzBill honours it, page /
// per_page paging, readable plan-gate refusals, and the AI-tool flag. Runs against dist/.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LetzBill } = require('../dist/nodes/LetzBill/LetzBill.node.js');
const { generatedProperties, operationSpecs } = require('../dist/nodes/LetzBill/generated/operations.js');
const runtime = require('../dist/nodes/LetzBill/shared/runtime.js');
const { describeLetzBillRefusal } = require('../dist/nodes/LetzBill/shared/refusal.js');
const { LetzBillApi } = require('../dist/credentials/LetzBillApi.credentials.js');

const node = { id: '1', name: 'LetzBill', type: 'letzBill', typeVersion: 1, position: [0, 0], parameters: {} };

function single(parameters = {}) {
	return {
		getNode: () => node,
		getItemIndex: () => 0,
		getExecutionId: () => '41',
		getWorkflow: () => ({ id: 'wf7', active: true }),
		getNodeParameter: (name, fallback) => (name in parameters ? parameters[name] : fallback),
	};
}

function optionFor(resource, operation) {
	const prop = generatedProperties.find(
		(p) => p.name === 'operation' && p.displayOptions?.show?.resource?.includes(resource),
	);
	return prop.options.find((o) => o.value === operation);
}

test('the action node is usable as an AI tool', () => {
	assert.equal(new LetzBill().description.usableAsTool, true);
});

test('Idempotency-Key goes only where the scope map says LetzBill honours it', async () => {
	const header = operationSpecs.filter((s) => s.idempotency === 'header').map((s) => `${s.method} ${s.path}`);
	assert.deepEqual(header.sort(), [
		'POST /api/v1/credit_notes',
		'POST /api/v1/invoices/{invoice_id}/send',
	]);
	for (const spec of operationSpecs) {
		const option = optionFor(spec.resource, spec.operation);
		let options = { url: option.routing.request.url, headers: {}, body: {} };
		for (const preSend of option.routing.send?.preSend ?? []) {
			options = await preSend.call(single(), options);
		}
		const key = `${spec.resource}.${spec.operation}`;
		assert.equal('Idempotency-Key' in options.headers, spec.idempotency === 'header', key);
		assert.equal('idempotency_key' in options.body, spec.idempotency === 'body:idempotency_key', key);
	}
});

test('a derived idempotency key is stable for the same item and fits the LetzBill pattern', async () => {
	const send = runtime.applyIdempotencyKey('header');
	const a = await send.call(single(), { url: '/x', headers: {} });
	const b = await send.call(single(), { url: '/x', headers: {} });
	assert.equal(a.headers['Idempotency-Key'], b.headers['Idempotency-Key']);
	assert.match(a.headers['Idempotency-Key'], /^[A-Za-z0-9_.:-]{1,255}$/);
	const given = await send.call(single({ idempotencyKey: 'order-42' }), { url: '/x', headers: {} });
	assert.equal(given.headers['Idempotency-Key'], 'order-42');
	await assert.rejects(send.call(single({ idempotencyKey: 'has space' }), { url: '/x', headers: {} }));
	const refund = runtime.applyIdempotencyKey('body', 'idempotency_key');
	const r = await refund.call(single({ idempotencyKey: 'refund-9' }), { url: '/x', body: { amount_cents: 100 } });
	assert.deepEqual(r.body, { amount_cents: 100, idempotency_key: 'refund-9' });
});

test('usage events are idempotent by transaction ID, which the node requires', () => {
	const create = operationSpecs.find((s) => s.resource === 'usageEvent' && s.operation === 'create');
	assert.equal(create.idempotency, 'natural:transaction_id');
	const field = generatedProperties.find(
		(p) => p.name === 'transactionId' && p.displayOptions?.show?.operation?.includes('create') &&
			p.displayOptions?.show?.resource?.includes('usageEvent'),
	);
	assert.equal(field.required, true);
});

test('Return All pages with page / per_page and Limit maps to per_page', async () => {
	const lists = operationSpecs.filter((s) => s.output === 'list');
	assert.ok(lists.length >= 9);
	for (const spec of lists) {
		const show = (p) =>
			p.displayOptions?.show?.resource?.includes(spec.resource) &&
			p.displayOptions?.show?.operation?.includes(spec.operation);
		const returnAll = generatedProperties.find((p) => p.name === 'returnAll' && show(p));
		const limit = generatedProperties.find((p) => p.name === 'limit' && show(p));
		assert.equal(typeof returnAll.routing.operations.pagination, 'function', spec.operation);
		assert.deepEqual(limit.routing.send, { type: 'query', property: 'per_page' });
		assert.ok(limit.typeOptions.maxValue <= spec.maxPerPage);
	}
	const pages = [];
	const paginate = runtime.paginateByPage(2);
	const results = await paginate.call(
		{
			makeRoutingRequest: async (requestData) => {
				pages.push({ ...requestData.options.qs });
				const page = requestData.options.qs.page;
				return page < 3 ? [{ json: { page } }, { json: { page } }] : [{ json: { page } }];
			},
		},
		{ options: { qs: { search: 'march' } } },
	);
	assert.equal(results.length, 5);
	assert.deepEqual(pages, [
		{ search: 'march', page: 1, per_page: 2 },
		{ search: 'march', page: 2, per_page: 2 },
		{ search: 'march', page: 3, per_page: 2 },
	]);
});

test('destructive operations are their own operations and say what they do', () => {
	const destructive = operationSpecs.filter((s) => s.destructive).map((s) => `${s.resource}.${s.operation}`);
	assert.deepEqual(destructive.sort(), [
		'creditNote.void',
		'customer.delete',
		'invoice.void',
		'payment.refund',
		'subscription.terminate',
		'webhookEndpoint.delete',
	]);
	for (const key of destructive) {
		const [resource, operation] = key.split('.');
		assert.ok(optionFor(resource, operation).description.split('. ').length >= 2, key);
	}
});

test('a plan gate reads as a plan gate, with the upgrade path', async () => {
	const body = {
		detail: {
			status: 403,
			error: 'Forbidden',
			code: 'FEATURE_NOT_AVAILABLE',
			type: 'feature',
			message: 'Your plan does not include credit notes.',
			feature_code: 'fb_credit_notes',
			current_plan: 'starter',
			upgrade_url: '/settings/billing/upgrade',
		},
	};
	const refusal = describeLetzBillRefusal(403, body);
	assert.equal(refusal.kind, 'plan');
	assert.match(refusal.description, /fb_credit_notes/);
	assert.match(refusal.description, /\/settings\/billing\/upgrade/);
	await assert.rejects(
		runtime.checkResponse.call(single(), [], { statusCode: 403, headers: {}, body }),
		(e) => e.message.includes('plan') && e.httpCode === '403',
	);
	const passed = await runtime.checkResponse.call(single(), [{ json: { id: 'x' } }], { statusCode: 200, headers: {}, body: {} });
	assert.equal(passed.length, 1);
});

test('role, lifecycle, quota and validation refusals are told apart', () => {
	const role = describeLetzBillRefusal(403, { detail: { type: 'role', code: 'permission_required', required_permission: 'invoice:write' } });
	assert.equal(role.kind, 'permission');
	assert.match(role.description, /invoice:write/);
	const lifecycle = describeLetzBillRefusal(403, { code: 'ORG_SUSPENDED', type: 'lifecycle', message: 'Organization is suspended.' });
	assert.equal(lifecycle.kind, 'lifecycle');
	const quota = describeLetzBillRefusal(402, { detail: { code: 'QUOTA_EXCEEDED', upgrade_url: '/settings/billing/upgrade' } });
	assert.equal(quota.kind, 'quota');
	const invalid = describeLetzBillRefusal(422, { detail: [{ loc: ['body', 'external_id'], msg: 'Field required' }] });
	assert.equal(invalid.kind, 'input');
	assert.match(invalid.description, /'external_id': Field required/);
	for (const r of [role, lifecycle, quota, invalid, describeLetzBillRefusal(500, 'oops')]) {
		assert.doesNotMatch(`${r.message} ${r.description}`, /\b(error|problem|failure|mistake)\b/i);
	}
});

test('the credential sends the key as a bearer token and tests with a read-only call', () => {
	const credential = new LetzBillApi();
	assert.equal(credential.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.equal(credential.test.request.method, 'GET');
	assert.equal(credential.test.request.url, '/api/v1/webhooks/event_types');
	const key = credential.properties.find((p) => p.name === 'apiKey');
	assert.equal(key.typeOptions.password, true);
});
