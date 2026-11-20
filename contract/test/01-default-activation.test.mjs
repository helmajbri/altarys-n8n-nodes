// Phase 1 of 2, n8n with its default settings: activating twice leaves one subscription; a valid
// delivery makes one workflow item, a replayed or tampered one none; deactivating removes the
// subscription; activating again restores exactly one. Phase 2 restarts n8n.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { driverClient, listEndpoints, n8nClient, sleep, waitFor } from '../lib/clients.mjs';
import { loadConfig } from '../lib/config.mjs';
import { buildTargets, triggerItems, triggerWorkflow, writeState } from '../lib/targets.mjs';

const config = loadConfig();
const n8n = n8nClient(config.n8n);
const driver = driverClient(config.driverUrl);
const state = { runId: config.runId, targets: {} };

for (const target of buildTargets(config)) {
	const ctx = { webhookId: randomUUID(), nodeId: randomUUID() };
	state.targets[target.name] = ctx;
	const ready = (step) => assert.ok(ctx[step], `an earlier step for ${target.name} failed`);
	const subscriptions = () => listEndpoints(target, ctx.webhookId);
	const executions = () => n8n.executions(ctx.workflowId);
	const deliver = (kind, eventId) =>
		driver.deliver({ realm: target.realm, urlContains: `/${ctx.webhookId}/`, kind, eventId, eventType: target.eventType });

	/** Publishes, waits for a subscription, then lets n8n settle and counts again. */
	async function activateAndCount() {
		await n8n.publish(ctx.workflowId);
		const seen = await waitFor(subscriptions, (l) => l.length > 0, { timeoutMs: config.timeoutMs });
		assert.ok(seen.length > 0, `no subscription within ${config.timeoutMs} ms of publishing`);
		await sleep(config.settleMs);
		return subscriptions();
	}

	test(`${target.name}: a credential holds the scoped key for this side`, async () => {
		const data = { baseUrl: target.url, apiKey: target.key };
		const credential = await n8n.createCredential(`contract ${config.runId} ${target.name}`, target.credentialType, data);
		assert.ok(credential?.id, 'n8n returned no credential id');
		ctx.credential = { id: credential.id, name: credential.name };
	});

	test(`${target.name}: a workflow with the trigger alone is created, with no subscription yet`, async () => {
		ready('credential');
		const created = await n8n.createWorkflow(triggerWorkflow(target, { runId: config.runId, ...ctx }));
		assert.ok(created?.id, 'n8n returned no workflow id');
		ctx.workflowId = created.id;
		assert.equal((await subscriptions()).length, 0);
	});

	test(`${target.name}: the first activation leaves exactly one subscription`, async () => {
		ready('workflowId');
		const after = await activateAndCount();
		assert.equal(after.length, 1, `subscriptions: ${JSON.stringify(after)}`);
		ctx.active = true;
	});

	test(`${target.name}: activating again leaves exactly one subscription`, async () => {
		ready('active');
		await n8n.publish(ctx.workflowId);
		await sleep(config.settleMs);
		const after = await subscriptions();
		assert.equal(after.length, 1, `subscriptions: ${JSON.stringify(after)}`);
	});

	test(`${target.name}: a valid delivery makes exactly one workflow item`, async () => {
		ready('active');
		assert.equal((await executions()).length, 0, 'executions existed before the first delivery');
		const eventId = randomUUID();
		const started = Date.now();
		const sent = await deliver('valid', eventId);
		assert.equal(sent.status, 200, `n8n answered ${sent.status}: ${sent.text ?? sent.error}`);
		const list = await waitFor(executions, (l) => l.length > 0, { timeoutMs: config.timeoutMs });
		const latency = Date.now() - started;
		assert.equal(list.length, 1, `executions: ${list.length}`);
		const items = triggerItems(list[0]);
		assert.ok(items, `no trigger output in execution ${JSON.stringify(list[0]).slice(0, 800)}`);
		assert.equal(items.length, 1);
		assert.equal(items[0].json?.metadata?.event_id, eventId);
		// A zero below is evidence only if the settle window is well above what a real item took.
		assert.ok(latency * 2 <= config.settleMs, `item took ${latency} ms; settle window ${config.settleMs} ms is too short`);
		console.log(`# ${target.name}: valid delivery became an item in ${latency} ms`);
		ctx.validOk = true;
	});

	test(`${target.name}: a replayed delivery makes no workflow item`, async () => {
		ready('validOk');
		const sent = await deliver('replay');
		assert.equal(sent.status, 200, `n8n answered ${sent.status}: ${sent.text ?? sent.error}`);
		await sleep(config.settleMs);
		assert.equal((await executions()).length, 1);
	});

	// Tampered deliveries carry fresh event IDs: a repeated ID would be dropped as a duplicate
	// and hide a missing signature check.
	test(`${target.name}: a delivery with a tampered signature makes no workflow item`, async () => {
		ready('validOk');
		const sent = await deliver('tamper-signature', randomUUID());
		assert.equal(sent.status, 401, `n8n answered ${sent.status}: ${sent.text ?? sent.error}`);
		await sleep(config.settleMs);
		assert.equal((await executions()).length, 1);
	});

	test(`${target.name}: a delivery with a tampered body makes no workflow item`, async () => {
		ready('validOk');
		const sent = await deliver('tamper-body', randomUUID());
		assert.equal(sent.status, 401, `n8n answered ${sent.status}: ${sent.text ?? sent.error}`);
		await sleep(config.settleMs);
		assert.equal((await executions()).length, 1);
	});

	test(`${target.name}: deactivating removes the subscription`, async () => {
		ready('active');
		await n8n.unpublish(ctx.workflowId);
		const left = await waitFor(subscriptions, (l) => l.length === 0, { timeoutMs: config.timeoutMs });
		assert.equal(left.length, 0, `still subscribed ${config.timeoutMs} ms after deactivating: ${JSON.stringify(left)}`);
	});

	test(`${target.name}: activating after a deactivation leaves exactly one subscription`, async () => {
		ready('active');
		const after = await activateAndCount();
		assert.equal(after.length, 1, `subscriptions: ${JSON.stringify(after)}`);
		ctx.reactivated = true;
	});
}

test('phase 1 state is saved for phase 2', async () => {
	// The mark lets phase 2 prove the start activation ran: it waits for the triggers' own
	// subscription checks after this point instead of trusting a fixed delay.
	writeState(config.stateFile, state);
	state.mark = await driver.mark();
	writeState(config.stateFile, state);
});
