// AC-AUT-001.12a: operations come from the OpenAPI document, and a renamed field fails the build.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { GeneratorError, generate, isSentenceCase, titleCase } from '../../../tools/generate-operations.mjs';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(packageDir, rel), 'utf8');
const manifest = JSON.parse(read('openapi/scope.manifest.json'));
const freshOpenapi = () => JSON.parse(read(manifest.openapi));
const { mustFail } = JSON.parse(read('test/fixtures/openapi-mutations.json'));

function applyMutation(doc, m) {
	const schemas = doc.components.schemas;
	switch (m.kind) {
		case 'renameProperty': {
			const s = schemas[m.schema];
			assert.ok(s?.properties?.[m.from], `fixture: ${m.schema}.${m.from} must exist`);
			const renamed = {};
			for (const [k, v] of Object.entries(s.properties)) renamed[k === m.from ? m.to : k] = v;
			s.properties = renamed;
			if (s.required) s.required = s.required.map((r) => (r === m.from ? m.to : r));
			break;
		}
		case 'setProperty':
			assert.ok(schemas[m.schema], `fixture: ${m.schema} must exist`);
			schemas[m.schema].properties[m.property] = m.to;
			break;
		case 'renamePath':
			assert.ok(doc.paths[m.from], `fixture: path ${m.from} must exist`);
			doc.paths[m.to] = doc.paths[m.from];
			delete doc.paths[m.from];
			break;
		case 'addHeader':
			doc.paths[m.path][m.method].parameters.push({
				name: 'Idempotency-Key',
				in: 'header',
				required: false,
				schema: { type: 'string' },
			});
			break;
		case 'removeParameter': {
			const op = doc.paths[m.path][m.method];
			const before = op.parameters.length;
			op.parameters = op.parameters.filter((p) => p.name !== m.parameter);
			assert.equal(op.parameters.length, before - 1, `fixture: ${m.parameter} must exist`);
			break;
		}
		default:
			throw new Error(`unknown mutation ${m.kind}`);
	}
	return doc;
}

test('the committed operations are what the generator writes from the snapshot', () => {
	const output = generate({ manifest, openapi: freshOpenapi() });
	assert.equal(read(manifest.output), output);
});

test('every scope-map operation the node offers is generated, none twice', () => {
	const keys = manifest.operations.map((o) => `${o.method} ${o.path}`);
	assert.equal(new Set(keys).size, keys.length);
	assert.equal(keys.length, 40);
});

for (const mutation of mustFail) {
	test(`the generator refuses ${mutation.name}`, () => {
		const original = JSON.stringify(freshOpenapi());
		const mutated = applyMutation(freshOpenapi(), mutation);
		assert.notEqual(JSON.stringify(mutated), original, 'the fixture must change the document');
		assert.throws(
			() => generate({ manifest, openapi: mutated }),
			(e) =>
				e instanceof GeneratorError && e.problems.some((p) => p.includes(mutation.expect)),
		);
	});
}

test('casing checks reproduce the lint libraries', () => {
	assert.equal(titleCase('get by external ID'), 'Get by External ID');
	assert.equal(titleCase('top up'), 'Top Up');
	assert.ok(isSentenceCase('Get customer by external ID'));
	assert.ok(!isSentenceCase('Get Customer'));
	assert.ok(!isSentenceCase('Create one-off invoice'));
});
