// Every amount in the node's output is integer minor units with a currency,
// and the node refuses to send an amount that is not. Runs against the built package (dist/).
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
const { operationSpecs } = require('../dist/nodes/LetzBill/generated/operations.js');
const runtime = require('../dist/nodes/LetzBill/shared/runtime.js');

const schemas = openapi.components.schemas;
const minorRe = new RegExp(manifest.money.minorUnitField);
const majorRe = new RegExp(manifest.money.majorUnitField);
const currencyRe = new RegExp(manifest.money.currencyField);
const notMoneyNames = new Set(Object.values(manifest.money.notMoney).flatMap((t) => Object.keys(t)));

const node = { id: '1', name: 'LetzBill', type: 'letzBill', typeVersion: 1, position: [0, 0], parameters: {} };
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
		const isDecimal = parts.some((x) => x.type === 'number') && parts.some((x) => x.type === 'string');
		if (isDecimal) return '12.50';
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

/** Every amount found, with the object holding it. */
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
		if (minorRe.test(k)) {
			if (v !== null && !Number.isInteger(v)) found.push(`${path}.${k} is not an integer`);
			if (!hasCurrency) found.push(`${path}.${k} has no currency beside it`);
		} else if (majorRe.test(k) && !notMoneyNames.has(k) && v !== null && !Number.isInteger(v)) {
			found.push(`${path}.${k} is a major-unit amount`);
		}
		found.push(...moneyViolations(v, `${path}.${k}`));
	}
	return found;
}

const withOutput = operationSpecs.filter((s) => s.itemSchema);

test('there are operations with JSON output to check', () => {
	assert.ok(withOutput.length >= 30, `only ${withOutput.length} operations have an item schema`);
});

for (const spec of withOutput) {
	test(`${spec.resource}.${spec.operation}: output amounts are integer minor units with a currency`, async () => {
		const item = sample(schemas[spec.itemSchema]);
		const out = await runtime.omitMoneyFields(spec.outputOmit).call(single, [{ json: item }]);
		assert.deepEqual(moneyViolations(out[0].json), []);
	});
}

test('the check can fail: without the omissions a wallet carries a major-unit amount', () => {
	const item = sample(schemas.WalletResponse);
	assert.ok(moneyViolations(item).some((v) => v.includes('rate_amount')));
});

test('a decimal minor-unit amount is refused before it is sent', async () => {
	const guard = runtime.requireIntegerMinorUnits(['amount_cents', 'fees[].unit_amount_cents']);
	await assert.rejects(guard.call(single, { url: '/x', body: { amount_cents: 12.5 } }), /minor units/);
	await assert.rejects(
		guard.call(single, { url: '/x', body: { fees: [{ unit_amount_cents: 100 }, { unit_amount_cents: 9.99 }] } }),
		/minor units/,
	);
	await assert.rejects(guard.call(single, { url: '/x', body: { amount_cents: '1250' } }), /minor units/);
	const ok = await guard.call(single, { url: '/x', body: { amount_cents: 1250, fees: [{ unit_amount_cents: 0 }] } });
	assert.equal(ok.body.amount_cents, 1250);
});

test('every operation that takes an amount in minor units checks it', () => {
	for (const spec of operationSpecs) {
		for (const path of spec.minorUnitInputs) assert.match(path, minorRe);
	}
	const withMoneyIn = operationSpecs.filter((s) => s.minorUnitInputs.length).map((s) => `${s.resource}.${s.operation}`);
	for (const expected of ['payment.create', 'payment.refund', 'invoice.createOneOff', 'creditNote.create']) {
		assert.ok(withMoneyIn.includes(expected), `${expected} does not check its amounts`);
	}
});
