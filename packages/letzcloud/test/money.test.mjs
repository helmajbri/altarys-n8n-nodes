// Every amount in the node's output is integer minor units with a currency beside it (Rule 8 of
// the appliance's money contract), including the usage rows that take the currency of the report.
// Runs against the built package (dist/).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(packageDir, 'openapi/scope.manifest.json'), 'utf8'));
const openapi = JSON.parse(readFileSync(join(packageDir, manifest.openapi), 'utf8'));
const { operationSpecs } = require('../dist/nodes/LetzCloud/generated/operations.js');
const runtime = require('../dist/nodes/LetzCloud/shared/runtime.js');

const schemas = openapi.components.schemas;
const minorRe = new RegExp(manifest.money.minorUnitField);
const majorRe = new RegExp(manifest.money.majorUnitField);
const currencyRe = new RegExp(manifest.money.currencyField);
const minorAlso = new Set(Object.values(manifest.money.minorUnitFields).flatMap((t) => Object.keys(t)));

const node = { id: '1', name: 'LetzCloud', type: 'letzCloud', typeVersion: 1, position: [0, 0], parameters: {} };
const single = { getNode: () => node, getItemIndex: () => 0 };

function deref(s) {
	let out = s ?? {};
	while (out.$ref) out = schemas[out.$ref.split('/').pop()];
	return out;
}

/** A response instance shaped by the schema, with every field present. */
function sample(schema, name = '', depth = 0) {
	let s = deref(schema);
	if (Array.isArray(s.anyOf)) {
		const parts = s.anyOf.map(deref).filter((x) => x.type !== 'null');
		s = parts[0] ?? {};
	}
	if (Array.isArray(s.enum)) return s.enum[0];
	if (depth > 6) return null;
	if (s.type === 'integer') return 1250;
	if (s.type === 'number') return 12.5;
	if (s.type === 'boolean') return false;
	if (s.type === 'string') return currencyRe.test(name) ? 'EUR' : `${name}-value`;
	if (s.type === 'array') return [sample(s.items, name, depth + 1)];
	if (s.properties) {
		const out = {};
		for (const [k, v] of Object.entries(s.properties)) out[k] = sample(v, k, depth + 1);
		return out;
	}
	return {};
}

/** Every amount that is not integer minor units with a currency in the same object. */
function moneyViolations(value, path = '') {
	const found = [];
	if (Array.isArray(value)) {
		value.forEach((v, i) => found.push(...moneyViolations(v, `${path}[${i}]`)));
		return found;
	}
	if (value === null || typeof value !== 'object') return found;
	const keys = Object.keys(value);
	const hasCurrency = keys.some((k) => currencyRe.test(k));
	for (const k of keys) {
		const v = value[k];
		// An object under an amount-like name (a recurring top-up's `amount`) holds the amount and
		// its currency; the amount inside it is checked on the next level.
		const scalar = v === null || typeof v !== 'object';
		const minor = scalar && (minorRe.test(k) || (minorAlso.has(k) && majorRe.test(k)));
		if (minor) {
			if (v !== null && !Number.isInteger(v)) found.push(`${path}.${k} is not an integer`);
			if (!hasCurrency) found.push(`${path}.${k} has no currency beside it`);
		} else if (scalar && majorRe.test(k) && v !== null && !Number.isInteger(v)) {
			found.push(`${path}.${k} is a major-unit amount`);
		}
		found.push(...moneyViolations(v, `${path}.${k}`));
	}
	return found;
}

async function asOutput(spec, item) {
	let items = [{ json: item }];
	items = await runtime.inheritCurrency(spec.inheritCurrency).call(single, items);
	items = await runtime.omitMoneyFields(spec.outputOmit).call(single, items);
	return items[0].json;
}

const withOutput = operationSpecs.filter((s) => s.itemSchema);

test('the billing reads are among the operations whose output is checked', () => {
	const keys = withOutput.map((s) => `${s.resource}.${s.operation}`);
	for (const expected of ['invoice.getAll', 'usage.get', 'wallet.get']) assert.ok(keys.includes(expected), expected);
});

for (const spec of withOutput) {
	test(`${spec.resource}.${spec.operation}: output amounts are integer minor units with a currency`, async () => {
		const out = await asOutput(spec, sample(schemas[spec.itemSchema]));
		assert.deepEqual(moneyViolations(out), []);
	});
}

test('the check can fail: without the copied currency a usage plan row has an amount and no currency', () => {
	const report = sample(schemas.L3UsageReportResponse);
	const found = moneyViolations(report);
	assert.ok(found.some((v) => v.startsWith('.plans[0].amount_cents has no currency')), found.join('\n'));
	assert.ok(found.some((v) => v.startsWith('.plans[0].charges[0].amount_cents has no currency')), found.join('\n'));
	const wallet = sample(schemas.L3WalletResponse);
	wallet.balance.amount = 12.5;
	assert.ok(moneyViolations(wallet).some((v) => v.includes('.balance.amount is not an integer')));
});

test('usage rows take the currency of the report, and keep their own when they have one', async () => {
	const spec = operationSpecs.find((s) => s.resource === 'usage' && s.operation === 'get');
	assert.deepEqual([...spec.inheritCurrency].sort(), ['plans[].charges[]=currency', 'plans[]=currency']);
	const out = await asOutput(spec, {
		period: 'current_month',
		currency: 'EUR',
		usage_amount_cents: 1500,
		plans: [{ plan: 'vm', name: 'VMs', amount_cents: 1500, charges: [{ metric_code: 'cpu', name: 'CPU', quantity: 3.5, amount_cents: 1500 }] }],
		metrics: [{ metric_code: 'cpu', total_value: 3.5, amount_cents: 1500, currency: 'USD' }],
	});
	assert.equal(out.plans[0].currency, 'EUR');
	assert.equal(out.plans[0].charges[0].currency, 'EUR');
	assert.equal(out.metrics[0].currency, 'USD');
	assert.deepEqual(moneyViolations(out), []);
	// A report with no cost (cost_reason set) has no currency and no plan rows to fill.
	const empty = await asOutput(spec, { period: 'last_month', currency: null, usage_amount_cents: null, plans: [] });
	assert.deepEqual(empty.plans, []);
});

test('invoices and the wallet carry integer minor units with their currency', async () => {
	const invoices = operationSpecs.find((s) => s.resource === 'invoice' && s.operation === 'getAll');
	assert.equal(invoices.root, 'data');
	assert.equal(invoices.itemSchema, 'L3InvoiceItem');
	const invoice = await asOutput(invoices, { id: 'x', amount_cents: 12000, currency: 'EUR', status: 'paid' });
	assert.deepEqual(moneyViolations(invoice), []);
	const wallet = operationSpecs.find((s) => s.resource === 'wallet' && s.operation === 'get');
	const balance = await asOutput(wallet, { wallet_id: 'w', balance: { amount: 2500, currency: 'EUR' }, recurring_top_up: null });
	assert.deepEqual(moneyViolations(balance), []);
});

test('no operation sends an amount', () => {
	for (const spec of operationSpecs) assert.deepEqual(spec.minorUnitInputs, [], `${spec.resource}.${spec.operation}`);
});
