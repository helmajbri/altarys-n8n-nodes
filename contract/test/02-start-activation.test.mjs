// Phase 2 of 2, after the harness restarted n8n with N8N_USE_WORKFLOW_PUBLICATION_SERVICE=false.
// With that setting n8n activates every published workflow at start and asks each webhook trigger
// whether its subscription exists, with no deactivation before: a second activation of a live
// subscription. With the default (true) a start does not call the trigger at all, so phase 1
// cannot cover this case. Then deactivating on this path removes the subscription too.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { driverClient, listEndpoints, n8nClient, sleep, waitFor } from '../lib/clients.mjs';
import { loadConfig } from '../lib/config.mjs';
import { buildTargets, readState } from '../lib/targets.mjs';

const config = loadConfig();
const n8n = n8nClient(config.n8n);
const driver = driverClient(config.driverUrl);
const state = readState(config.stateFile);

const LIST_PATHS = {
	letzbill: '/api/v1/webhooks/endpoints',
	'letzcloud-provider': '/api/v1/webhooks/endpoints',
	'letzcloud-customer': '/api/v1/l3/webhooks/endpoints',
};

for (const target of buildTargets(config)) {
	const ctx = state.targets[target.name];
	const ready = (step) => assert.ok(ctx?.[step], `an earlier step for ${target.name} failed`);
	const subscriptions = () => listEndpoints(target, ctx.webhookId);

	test(`${target.name}: activation at n8n start leaves exactly one subscription`, async () => {
		ready('reactivated');
		// Wait for this trigger's own subscription check after the restart: proof the start
		// activation ran, so the count below is read after it and not before.
		const checks = await waitFor(
			async () =>
				(await driver.requestsSince(state.mark)).filter(
					(r) => r.realm === target.realm && r.method === 'GET' && r.path === LIST_PATHS[target.name],
				),
			(list) => list.length > 0,
			{ timeoutMs: config.timeoutMs },
		);
		assert.ok(checks.length > 0, 'the trigger made no subscription check after the restart');
		await sleep(config.settleMs);
		const now = await subscriptions();
		assert.equal(now.length, 1, `subscriptions: ${JSON.stringify(now)}`);
	});

	test(`${target.name}: deactivating after the start activation removes every subscription`, async () => {
		ready('workflowId');
		await n8n.unpublish(ctx.workflowId);
		const left = await waitFor(subscriptions, (l) => l.length === 0, { timeoutMs: config.timeoutMs });
		assert.equal(left.length, 0, `still subscribed ${config.timeoutMs} ms after deactivating: ${JSON.stringify(left)}`);
	});
}

test('every server call was made with the scoped key of its own side', async () => {
	const s = await driver.state();
	assert.equal(s.authRefused, 0, `${s.authRefused} calls were refused for the wrong or a missing key`);
});

after(async () => {
	// Remove what the suite created in n8n; then list what remains on the servers.
	for (const [name, ctx] of Object.entries(state.targets)) {
		if (ctx.workflowId) {
			const outcome = await n8n.removeWorkflow(ctx.workflowId).catch((e) => e.message);
			console.log(`# ${name}: workflow ${ctx.workflowId} ${outcome}`);
		}
		if (ctx.credential?.id) await n8n.deleteCredential(ctx.credential.id).catch((e) => console.log(`# ${name}: ${e.message}`));
	}
	for (const target of buildTargets(config)) {
		const ctx = state.targets[target.name];
		const left = ctx ? await listEndpoints(target, ctx.webhookId).catch(() => []) : [];
		console.log(`# ${target.name}: subscriptions left after the suite: ${left.length}`);
	}
});
