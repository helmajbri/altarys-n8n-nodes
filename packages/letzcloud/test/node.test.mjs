// The action node against the scope map: path IDs checked before the request, HTTPS only, page /
// page size paging, readable refusals, the wait operations, and the AI-tool flag. Runs against dist/.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LetzCloud } = require('../dist/nodes/LetzCloud/LetzCloud.node.js');
const { generatedProperties, operationSpecs } = require('../dist/nodes/LetzCloud/generated/operations.js');
const runtime = require('../dist/nodes/LetzCloud/shared/runtime.js');
const wait = require('../dist/nodes/LetzCloud/shared/wait.js');
const { describeLetzCloudRefusal } = require('../dist/nodes/LetzCloud/shared/refusal.js');

const UUID = '3f2b8c1e-5d4a-4f6b-9c2d-1a2b3c4d5e6f';
const BASE = 'https://cloud.example.com';

/** A stand-in for n8n's per-item execution context. IDs default to a valid UUID. */
function single(parameters = {}, { itemIndex = 0 } = {}) {
	const node = { id: 'node-a', name: 'LetzCloud', type: 'letzCloud', typeVersion: 1, position: [0, 0], parameters: {} };
	return {
		getNode: () => node,
		getItemIndex: () => itemIndex,
		getNodeParameter: (name, fallback) =>
			name in parameters ? parameters[name] : /Id$/.test(name) ? UUID : fallback,
	};
}

function optionFor(resource, operation) {
	const prop = generatedProperties.find(
		(p) => p.name === 'operation' && p.displayOptions?.show?.resource?.includes(resource),
	);
	return prop.options.find((o) => o.value === operation);
}

const camel = (name) => name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

test('the action node is usable as an AI tool and routes the wait operations to code', () => {
	const node = new LetzCloud();
	assert.equal(node.description.usableAsTool, true);
	assert.equal(node.customOperations.instance.waitForState, wait.waitForInstanceState);
	assert.equal(node.customOperations.kubernetesCluster.waitUntilRunning, wait.waitForClusterRunning);
	const custom = operationSpecs.filter((s) => s.output === 'custom').map((s) => `${s.resource}.${s.operation}`);
	assert.deepEqual(custom.sort(), ['instance.waitForState', 'kubernetesCluster.waitUntilRunning']);
	for (const key of custom) {
		const [resource, operation] = key.split('.');
		assert.equal(optionFor(resource, operation).routing, undefined, `${key} is not routed declaratively`);
	}
});

test('every declarative operation refuses an http:// appliance URL first', async () => {
	await assert.rejects(runtime.requireHttps.call(single(), { baseURL: 'http://cloud.example.com', url: '/x' }), /https/);
	await assert.rejects(runtime.requireHttps.call(single(), { url: '/x' }), /https/);
	for (const spec of operationSpecs.filter((s) => s.output !== 'custom')) {
		const option = optionFor(spec.resource, spec.operation);
		assert.equal(option.routing.send.preSend[0], runtime.requireHttps, `${spec.resource}.${spec.operation}`);
	}
});

test('every path ID is checked before the request: a UUID where the route takes one, else no dot segment', async () => {
	for (const spec of operationSpecs.filter((s) => s.output !== 'custom')) {
		const names = [...spec.path.matchAll(/\{([^}]+)\}/g)].map((m) => camel(m[1]));
		assert.deepEqual([...spec.uuidParameters, ...spec.safeParameters].sort(), names.sort(), spec.path);
	}
	const safe = operationSpecs.filter((s) => s.safeParameters.length).map((s) => `${s.method} ${s.path}`);
	assert.deepEqual(safe.sort(), [
		'DELETE /api/v1/kubernetes/clusters/{cluster_id}',
		'DELETE /api/v1/storage/snapshots/{snapshot_id}',
		'GET /api/v1/kubernetes/clusters/{cluster_id}',
	]);
	const guard = runtime.requireUuids(['vmId']);
	for (const bad of ['..', '../vms', 'abc', '', `${UUID}/x`]) {
		await assert.rejects(guard.call(single({ vmId: bad }), { url: '/x' }), /UUID/, JSON.stringify(bad));
	}
	const segment = runtime.requireSafePathSegments(['clusterId']);
	for (const bad of ['.', '..', '', ' ', 'a/b', 'a\\b']) {
		await assert.rejects(segment.call(single({ clusterId: bad }), { url: '/x' }), /must be an ID/, JSON.stringify(bad));
	}
	assert.equal((await segment.call(single({ clusterId: 'c-12.ab' }), { url: '/x' })).url, '/x');
	// The generated chain refuses before anything is sent.
	const preSend = optionFor('snapshot', 'delete').routing.send.preSend;
	await assert.rejects(
		(async () => {
			let options = { baseURL: BASE, url: '/x' };
			for (const step of preSend) options = await step.call(single({ snapshotId: '..' }), options);
		})(),
		/must be an ID/,
	);
});

test('no operation sends an Idempotency-Key: none of these routes takes one', () => {
	for (const spec of operationSpecs) assert.equal(spec.idempotency, 'none', `${spec.resource}.${spec.operation}`);
	assert.equal(generatedProperties.some((p) => p.name === 'idempotencyKey'), false);
});

test('Return All pages with page and the page size parameter each route takes', async () => {
	const lists = operationSpecs.filter((s) => s.output === 'list');
	assert.equal(lists.length, 10);
	for (const spec of lists) {
		const show = (p) =>
			p.displayOptions?.show?.resource?.includes(spec.resource) &&
			p.displayOptions?.show?.operation?.includes(spec.operation);
		const returnAll = generatedProperties.find((p) => p.name === 'returnAll' && show(p));
		const limit = generatedProperties.find((p) => p.name === 'limit' && show(p));
		assert.equal(typeof returnAll.routing.operations.pagination, 'function', spec.operation);
		const expected = spec.path === '/api/v1/l3/billing/invoices' ? 'per_page' : 'page_size';
		assert.deepEqual(limit.routing.send, { type: 'query', property: expected }, `${spec.resource}.${spec.operation}`);
		assert.ok(limit.typeOptions.maxValue <= spec.maxPerPage);
	}
	const pages = [];
	const results = await runtime.paginateByPage(2, 'page_size').call(
		{
			makeRoutingRequest: async (requestData) => {
				pages.push({ ...requestData.options.qs });
				const page = requestData.options.qs.page;
				return page < 2 ? [{ json: { page } }, { json: { page: page + 0.5 } }] : [{ json: { page } }];
			},
		},
		{ options: { qs: { search: 'web' } } },
	);
	assert.equal(results.length, 3);
	assert.deepEqual(pages, [
		{ search: 'web', page: 1, page_size: 2 },
		{ search: 'web', page: 2, page_size: 2 },
	]);
	const ctx = (makeRoutingRequest) => ({ ...single(), makeRoutingRequest });
	await assert.rejects(
		runtime.paginateByPage(2, 'page_size').call(ctx(async () => [{ json: { id: 1 } }, { json: { id: 2 } }]), { options: {} }),
		/same items/,
	);
	let calls = 0;
	await assert.rejects(
		runtime.paginateByPage(1, 'page_size', 4).call(
			ctx(async (requestData) => {
				calls += 1;
				return [{ json: { page: requestData.options.qs.page } }];
			}),
			{ options: {} },
		),
		/after 4 pages/,
	);
	assert.equal(calls, 4);
});

test('destructive operations are their own operations and say what they destroy', () => {
	const destructive = operationSpecs.filter((s) => s.destructive).map((s) => `${s.resource}.${s.operation}`);
	assert.deepEqual(destructive.sort(), [
		'container.delete',
		'database.delete',
		'dnsRecord.delete',
		'instance.delete',
		'kubernetesCluster.delete',
		'network.delete',
		'snapshot.delete',
		'volume.delete',
	]);
	for (const key of destructive) {
		const [resource, operation] = key.split('.');
		assert.ok(optionFor(resource, operation).description.split('. ').length >= 2, key);
	}
});

test('instance state changes offer start, stop and reboot only', () => {
	const action = generatedProperties.find(
		(p) => p.name === 'stateAction' && p.displayOptions?.show?.operation?.includes('changeState'),
	);
	assert.equal(action.displayName, 'Action');
	assert.deepEqual(action.routing.send, { type: 'body', property: 'action' });
	assert.equal(action.type, 'options');
	assert.deepEqual(action.options.map((o) => o.value).sort(), ['reboot', 'start', 'stop']);
	assert.equal(action.required, true);
	assert.equal(action.default, 'start');
});

test('a plan gate reads as a plan gate, with what to upgrade', async () => {
	// The appliance wraps an HTTP refusal as {"error": <detail>}.
	const body = {
		error: {
			status: 403,
			error: 'Forbidden',
			code: 'FEATURE_NOT_AVAILABLE',
			type: 'entitlement',
			message: "Feature 'lc_kubernetes' is not available on your current plan (Starter)",
			feature_code: 'lc_kubernetes',
			current_plan: 'starter',
			upgrade_required: true,
		},
	};
	const refusal = describeLetzCloudRefusal(403, body);
	assert.equal(refusal.kind, 'plan');
	assert.match(refusal.description, /'lc_kubernetes'/);
	assert.match(refusal.description, /'starter'/);
	assert.match(refusal.description, /Upgrade the plan/);
	await assert.rejects(
		runtime.checkResponse.call(single(), [], { statusCode: 403, headers: {}, body }),
		(e) => e.message.includes('plan') && e.httpCode === '403',
	);
	const passed = await runtime.checkResponse.call(single(), [{ json: { id: 'x' } }], { statusCode: 200, headers: {}, body: {} });
	assert.equal(passed.length, 1);
	const unresolved = describeLetzCloudRefusal(403, { error: { code: 'ENTITLEMENTS_UNAVAILABLE', type: 'entitlement', upgrade_required: false } });
	assert.equal(unresolved.kind, 'unavailable');
	assert.doesNotMatch(unresolved.description, /[Uu]pgrade/);
});

test('role and lifecycle refusals are told apart, and so are the key-tier refusals', () => {
	const role = describeLetzCloudRefusal(403, {
		error: { code: 'ROLE_PERMISSION_DENIED', type: 'role', message: "You don't have permission to read vm.", permission: 'vm:read' },
	});
	assert.equal(role.kind, 'permission');
	assert.match(role.description, /'vm:read'/);
	const lifecycle = describeLetzCloudRefusal(403, {
		error: { error: 'billing_suspended', message: 'Account suspended due to payment issues.', type: 'lifecycle' },
	});
	assert.equal(lifecycle.kind, 'lifecycle');
	assert.match(lifecycle.message, /restricted/);
	assert.match(lifecycle.description, /payment issues/);
	// The customer-key fence is a middleware: its body is {"detail": ...}.
	const fence = describeLetzCloudRefusal(403, {
		detail: { code: 'CUSTOMER_KEY_ROUTE_NOT_OFFERED', type: 'role', message: 'API keys issued to a customer cannot call this route.' },
	});
	assert.equal(fence.kind, 'tier');
	assert.match(fence.message, /customer key/);
	const providerOnly = describeLetzCloudRefusal(403, { error: { code: 'L2_ONLY', type: 'role' } });
	assert.equal(providerOnly.kind, 'tier');
	assert.match(providerOnly.message, /provider key/);
	const customerOnly = describeLetzCloudRefusal(403, {
		error: { code: 'L3_CUSTOMER_UNRESOLVED', type: 'lifecycle', message: 'This endpoint is available to customer accounts only.' },
	});
	assert.equal(customerOnly.kind, 'tier');
	assert.match(customerOnly.message, /customer key/);
	const verification = describeLetzCloudRefusal(403, { error: { code: 'VERIFICATION_REQUIRED', type: 'verification', message: 'Complete verification to create vm' } });
	assert.equal(verification.kind, 'verification');
	const unauthenticated = describeLetzCloudRefusal(401, { status: 401, error: 'Unauthorized', code: 'authentication_failed', message: 'Invalid or expired api key' });
	assert.equal(unauthenticated.kind, 'permission');
	assert.match(unauthenticated.description, /bff_sa_/);
	const invalid = describeLetzCloudRefusal(422, {
		error: { code: 'VAL_FORMAT_INVALID', type: 'validation', message: 'Request validation failed', validation_errors: [{ field: 'body.zone_id', message: 'Field required' }] },
	});
	assert.equal(invalid.kind, 'input');
	assert.match(invalid.description, /'zone_id': Field required/);
	const events = describeLetzCloudRefusal(422, {
		error: { code: 'unknown_event_type', message: 'Unknown webhook event type: invoice.finalized', unknown_event_types: ['invoice.finalized'] },
	});
	assert.match(events.description, /'invoice\.finalized'/);
	const limit = describeLetzCloudRefusal(409, { error: { code: 'WEBHOOK_ENDPOINT_LIMIT', message: 'A customer may hold at most 10 webhook endpoints.' } });
	assert.equal(limit.kind, 'conflict');
	assert.match(limit.description, /at most 10/);
	for (const r of [role, lifecycle, fence, providerOnly, customerOnly, verification, unauthenticated, invalid, events, limit, describeLetzCloudRefusal(502, 'Bad gateway')]) {
		assert.doesNotMatch(`${r.message} ${r.description}`, /\b(error|problem|failure|mistake)\b/i);
	}
});

test('a wait reads until ready, stops on a state that cannot become ready, and is bounded', async () => {
	const sleeps = [];
	const fakeSleep = async (ms) => sleeps.push(ms);
	let clock = 0;
	const states = ['Starting', 'Starting', 'Running'];
	const ready = await wait.pollUntil({
		read: async () => wait.judgeInstance({ id: UUID, state: states.shift() }, 'Running'),
		timeoutSeconds: 600,
		intervalSeconds: 10,
		sleep: async (ms) => {
			await fakeSleep(ms);
			clock += ms;
		},
		now: () => clock,
	});
	assert.equal(ready.reads, 3);
	assert.deepEqual(sleeps, [10000, 10000]);
	assert.equal(ready.value.state, 'Running');
	await assert.rejects(
		wait.pollUntil({
			read: async () => wait.judgeInstance({ state: 'Error' }, 'Running'),
			timeoutSeconds: 600,
			intervalSeconds: 10,
			sleep: fakeSleep,
			now: () => 0,
		}),
		(e) => e.reason === 'failed' && /Error/.test(e.message),
	);
	// A clock that never moves still stops: reads are bounded by the limit over the interval.
	let reads = 0;
	await assert.rejects(
		wait.pollUntil({
			read: async () => {
				reads += 1;
				return wait.judgeInstance({ state: 'Stopping' }, 'Stopped');
			},
			timeoutSeconds: 60,
			intervalSeconds: 10,
			sleep: async () => {},
			now: () => 0,
		}),
		(e) => e.reason === 'timeout' && /60 seconds/.test(e.message),
	);
	assert.equal(reads, 7);
});

test('a cluster wait follows the cluster its create job names, never a name', () => {
	const job = (status, result) => ({ job_id: 'j1', job_status: status, job_result: result });
	assert.equal(wait.judgeClusterJob(job(0, null)).status, 'pending');
	const done = wait.judgeClusterJob(job(1, { kubernetescluster: { id: 'k1', name: 'prod' } }));
	assert.deepEqual(done, { status: 'ready', value: 'k1' });
	assert.equal(wait.judgeClusterJob(job(1, {})).status, 'failed');
	assert.equal(wait.judgeClusterJob(job(1, { kubernetescluster: { id: '..' } })).status, 'failed');
	const refused = wait.judgeClusterJob(job(2, { errorcode: 530, errortext: 'Insufficient capacity' }));
	assert.equal(refused.status, 'failed');
	assert.match(refused.reason, /Insufficient capacity/);
	assert.match(wait.judgeClusterJob(job(3, null)).reason, /cancelled/);
	assert.equal(wait.judgeClusterById({ id: 'k1', name: 'prod', state: 'Starting' }, 'k1').status, 'pending');
	assert.equal(wait.judgeClusterById({ id: 'k1', name: 'prod', state: 'Alert' }, 'k1').status, 'pending');
	assert.equal(wait.judgeClusterById({ id: 'k1', name: 'prod', state: 'Running' }, 'k1').status, 'ready');
	assert.equal(wait.judgeClusterById({ id: 'k1', name: 'prod', state: 'Error' }, 'k1').status, 'failed');
	// A cluster with the same name but another ID is refused, Running or not.
	assert.equal(wait.judgeClusterById({ id: 'k-old', name: 'prod', state: 'Running' }, 'k1').status, 'failed');
});

function executeContext(parameters, answer, { baseUrl = BASE, continueOnFail = false, items = 1 } = {}) {
	const requests = [];
	const node = { id: 'n', name: 'LetzCloud', type: 'letzCloud', typeVersion: 1, position: [0, 0], parameters: {} };
	return {
		requests,
		ctx: {
			getNode: () => node,
			getInputData: () => Array.from({ length: items }, () => ({ json: {} })),
			getNodeParameter: (name, _i, fallback) => (name in parameters ? parameters[name] : fallback),
			getCredentials: async () => ({ baseUrl, apiKey: 'bff_sa_test' }),
			continueOnFail: () => continueOnFail,
			helpers: {
				httpRequestWithAuthentication: async function (type, options) {
					assert.equal(type, 'letzCloudApi');
					requests.push(options);
					return answer(options);
				},
			},
		},
	};
}

test('Wait for State returns the instance once it has the state, and reads only its own route', async () => {
	const { ctx, requests } = executeContext({ vmId: UUID, targetState: 'Running' }, () => ({
		statusCode: 200,
		headers: {},
		body: { id: UUID, state: 'Running', name: 'web-1' },
	}));
	const [out] = await wait.waitForInstanceState.call(ctx);
	assert.equal(out.length, 1);
	assert.equal(out[0].json.state, 'Running');
	assert.deepEqual(out[0].pairedItem, { item: 0 });
	assert.equal(requests.length, 1);
	assert.equal(requests[0].method, 'GET');
	assert.equal(requests[0].url, `/api/v1/vms/${UUID}`);
});

test('Wait for State refuses a bad ID or an http:// URL before any request, and reads refusals', async () => {
	const never = () => assert.fail('no request expected');
	const badId = executeContext({ vmId: '../vms', targetState: 'Running' }, never);
	await assert.rejects(wait.waitForInstanceState.call(badId.ctx), /UUID/);
	const http = executeContext({ vmId: UUID, targetState: 'Running' }, never, { baseUrl: 'http://cloud.example.com' });
	await assert.rejects(wait.waitForInstanceState.call(http.ctx), /https/);
	const gone = executeContext({ vmId: UUID, targetState: 'Running' }, () => ({
		statusCode: 200,
		headers: {},
		body: { id: UUID, state: 'Destroyed' },
	}));
	await assert.rejects(wait.waitForInstanceState.call(gone.ctx), /Destroyed/);
	const denied = executeContext({ vmId: UUID, targetState: 'Running' }, () => ({
		statusCode: 403,
		headers: {},
		body: { detail: { code: 'CUSTOMER_KEY_ROUTE_NOT_OFFERED', type: 'role' } },
	}));
	await assert.rejects(wait.waitForInstanceState.call(denied.ctx), (e) => /customer key/.test(e.message));
	const soft = executeContext({ vmId: UUID, targetState: 'Running' }, () => ({ statusCode: 200, headers: {}, body: { state: 'Error' } }), {
		continueOnFail: true,
	});
	const [out] = await wait.waitForInstanceState.call(soft.ctx);
	assert.match(out[0].json.error, /Error/);
});

/** An appliance holding the create job, the cluster it made, and a stale cluster of the same name. */
function clusterAppliance({ jobStatus = 1 } = {}) {
	return (options) => {
		if (options.url === '/api/v1/jobs/job-7') {
			return {
				statusCode: 200,
				headers: {},
				body: { job_id: 'job-7', job_status: jobStatus, job_result: jobStatus === 1 ? { kubernetescluster: { id: 'k-new', name: 'prod' } } : null },
			};
		}
		if (options.url === '/api/v1/kubernetes/clusters/k-new') {
			return { statusCode: 200, headers: {}, body: { id: 'k-new', name: 'prod', state: 'Running' } };
		}
		if (options.url === '/api/v1/kubernetes/clusters') {
			// Listed first, same name, also Running: a name match would return this one.
			return { statusCode: 200, headers: {}, body: { items: [{ id: 'k-stale', name: 'prod', state: 'Running' }, { id: 'k-new', name: 'prod', state: 'Running' }] } };
		}
		return { statusCode: 404, headers: {}, body: { error: { code: 'RES_NOT_FOUND', type: 'resource', message: 'Not found' } } };
	};
}

test('Wait Until Running returns the cluster the create job made, not a stale one with its name', async () => {
	const { ctx, requests } = executeContext({ jobId: 'job-7' }, clusterAppliance());
	const [out] = await wait.waitForClusterRunning.call(ctx);
	assert.equal(out[0].json.id, 'k-new');
	assert.deepEqual(out[0].json.wait, { correlated_by: 'create_job', job_id: 'job-7', cluster_id: 'k-new' });
	assert.deepEqual(
		requests.map((r) => r.url),
		['/api/v1/jobs/job-7', '/api/v1/kubernetes/clusters/k-new'],
	);
	// The cluster read by ID answering with another cluster is refused.
	const swapped = executeContext({ jobId: 'job-7' }, (options) =>
		options.url === '/api/v1/kubernetes/clusters/k-new'
			? { statusCode: 200, headers: {}, body: { id: 'k-stale', name: 'prod', state: 'Running' } }
			: clusterAppliance()(options),
	);
	await assert.rejects(wait.waitForClusterRunning.call(swapped.ctx), /another cluster/);
	const failed = executeContext({ jobId: 'job-7' }, clusterAppliance({ jobStatus: 2 }));
	await assert.rejects(wait.waitForClusterRunning.call(failed.ctx), /did not succeed/);
	for (const bad of ['', '  ', '..', 'a/b']) {
		const refused = executeContext({ jobId: bad }, () => assert.fail('no request expected'));
		await assert.rejects(wait.waitForClusterRunning.call(refused.ctx), /Job ID/, JSON.stringify(bad));
	}
});

test('one execution waits at most the total limit over all its items', async () => {
	let clock = 0;
	const limits = [];
	const { ctx } = executeContext({}, () => assert.fail('no request expected'), { items: 3, continueOnFail: true });
	const [out] = await wait.runWait(
		ctx,
		async (itemIndex, timeoutSeconds) => {
			limits.push(timeoutSeconds);
			clock += (wait.MAX_TOTAL_WAIT_SECONDS - 100) * 1000;
			return { item: itemIndex };
		},
		() => clock,
	);
	assert.equal(wait.MAX_TOTAL_WAIT_SECONDS, 7200);
	// The first item gets its own limit; the second only what is left; the third nothing.
	assert.deepEqual(limits, [900, 100]);
	assert.deepEqual(out[0].json, { item: 0 });
	assert.deepEqual(out[1].json, { item: 1 });
	assert.match(out[2].json.error, /already waited 7200 seconds/);
	assert.deepEqual(out[2].pairedItem, { item: 2 });
});

test('the wait parameters are bounded', () => {
	for (const name of ['timeoutSeconds', 'intervalSeconds']) {
		const p = wait.waitProperties.find((x) => x.name === name);
		assert.ok(p.typeOptions.minValue >= 5 && p.typeOptions.maxValue <= 7200, name);
	}
});
