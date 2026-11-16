// Operations come from the OpenAPI document, limited to the scope map, and a renamed or missing
// field, path or parameter fails the build.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { GeneratorError, generate } from '../../../tools/generate-operations.mjs';

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
			assert.ok(schemas[m.schema]?.properties?.[m.property], `fixture: ${m.schema}.${m.property} must exist`);
			schemas[m.schema].properties[m.property] = m.to;
			break;
		case 'renamePath':
			assert.ok(doc.paths[m.from], `fixture: path ${m.from} must exist`);
			doc.paths[m.to] = doc.paths[m.from];
			delete doc.paths[m.from];
			break;
		case 'addHeader': {
			const op = doc.paths[m.path][m.method];
			op.parameters = [
				...(op.parameters ?? []),
				{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' } },
			];
			break;
		}
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

// The operation rows of the LetzCloud scope map. Webhook rows are the trigger's (handWritten).
const SCOPE_MAP_OPERATIONS = [
	'GET /api/v1/vms',
	'GET /api/v1/vms/{vm_id}',
	'POST /api/v1/vms',
	'PUT /api/v1/vms/{vm_id}/state',
	'DELETE /api/v1/vms/{vm_id}',
	'GET /api/v1/storage/volumes',
	'GET /api/v1/storage/volumes/{volume_id}',
	'POST /api/v1/storage/volumes',
	'DELETE /api/v1/storage/volumes/{volume_id}',
	'GET /api/v1/storage/snapshots',
	'POST /api/v1/storage/snapshots',
	'DELETE /api/v1/storage/snapshots/{snapshot_id}',
	'GET /api/v1/network/networks',
	'GET /api/v1/network/networks/{network_id}',
	'POST /api/v1/network/networks',
	'DELETE /api/v1/network/networks/{network_id}',
	'GET /api/v1/kubernetes/clusters',
	'GET /api/v1/kubernetes/clusters/{cluster_id}',
	'POST /api/v1/kubernetes/clusters',
	'DELETE /api/v1/kubernetes/clusters/{cluster_id}',
	'GET /api/v1/containers',
	'GET /api/v1/containers/{container_id}',
	'POST /api/v1/containers',
	'DELETE /api/v1/containers/{container_id}',
	'GET /api/v1/databases',
	'GET /api/v1/databases/{cluster_id}',
	'POST /api/v1/databases',
	'DELETE /api/v1/databases/{cluster_id}',
	'GET /api/v1/dns/zones',
	'GET /api/v1/dns/zones/{zone_id}/records',
	'POST /api/v1/dns/zones/{zone_id}/records',
	'PUT /api/v1/dns/zones/{zone_id}/records/{record_id}',
	'DELETE /api/v1/dns/zones/{zone_id}/records/{record_id}',
	'GET /api/v1/l3/billing/invoices',
	'GET /api/v1/l3/billing/usage',
	'GET /api/v1/l3/billing/wallet',
];

const SCOPE_MAP_TRIGGER = [
	'GET /api/v1/webhooks/event_types',
	'POST /api/v1/webhooks/endpoints',
	'DELETE /api/v1/webhooks/endpoints/{endpoint_id}',
	'GET /api/v1/l3/webhooks/event_types',
	'POST /api/v1/l3/webhooks/endpoints',
	'GET /api/v1/l3/webhooks/endpoints',
	'DELETE /api/v1/l3/webhooks/endpoints/{endpoint_id}',
];

test('the node offers exactly the operation rows of the scope map, each once', () => {
	const generated = manifest.operations.filter((o) => !o.custom).map((o) => `${o.method} ${o.path}`);
	assert.equal(new Set(generated).size, generated.length);
	assert.deepEqual([...generated].sort(), [...SCOPE_MAP_OPERATIONS].sort());
});

test('the wait operations and the trigger read only scope-map routes', () => {
	const allowed = new Set([...SCOPE_MAP_OPERATIONS, ...SCOPE_MAP_TRIGGER]);
	for (const o of manifest.operations.filter((x) => x.custom)) {
		for (const used of o.uses) assert.ok(allowed.has(`${used.method} ${used.path}`), `${o.value}: ${used.path}`);
	}
	const handWritten = manifest.handWritten.map((r) => `${r.method} ${r.path}`);
	for (const route of SCOPE_MAP_TRIGGER) assert.ok(handWritten.includes(route), route);
	// The discovery route is the one route outside the map: it needs no key.
	for (const route of handWritten) {
		assert.ok(allowed.has(route) || route === 'GET /.well-known/letzcloud-appliance', route);
	}
});

for (const mutation of mustFail) {
	test(`the generator refuses ${mutation.name}`, () => {
		const original = JSON.stringify(freshOpenapi());
		const mutated = applyMutation(freshOpenapi(), mutation);
		assert.notEqual(JSON.stringify(mutated), original, 'the fixture must change the document');
		assert.throws(
			() => generate({ manifest, openapi: mutated }),
			(e) => e instanceof GeneratorError && e.problems.some((p) => p.includes(mutation.expect)),
		);
	});
}

test('the generator refuses a manifest without a service name', () => {
	const { service: _service, ...rest } = manifest;
	assert.throws(
		() => generate({ manifest: rest, openapi: freshOpenapi() }),
		(e) => e instanceof GeneratorError && e.problems.some((p) => p.includes("'service'")),
	);
});

test('the snapshot carries no internal planning references', () => {
	const text = read(manifest.openapi) + read('openapi/scope.manifest.json');
	assert.doesNotMatch(text, /\b(BR|SPEC|ADR|PR|AUTH|REQ|D-W3|B-W3)-[A-Z0-9]/);
	assert.doesNotMatch(text, /\.py\b/);
});
