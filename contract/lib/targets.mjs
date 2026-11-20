// One target per trigger and side: the LetzBill trigger, and the LetzCloud trigger subscribed as
// the provider and as a customer. Each carries the scoped key for its side only.
import { readFileSync, writeFileSync } from 'node:fs';

export function buildTargets(config) {
	return config.targets.map((name) => {
		if (name === 'letzbill') {
			const c = config.letzbill;
			return {
				name,
				realm: 'letzbill',
				url: c.url,
				key: c.key,
				eventType: c.eventType,
				triggerType: c.triggerType,
				credentialType: 'letzBillApi',
				webhooksBase: '/api/v1/webhooks',
				parameters: { events: [c.eventType], toleranceSeconds: 300 },
			};
		}
		const c = config.letzcloud;
		const customer = name === 'letzcloud-customer';
		return {
			name,
			realm: name,
			url: c.url,
			key: customer ? c.customerKey : c.providerKey,
			eventType: c.eventType,
			triggerType: c.triggerType,
			credentialType: 'letzCloudApi',
			webhooksBase: customer ? '/api/v1/l3/webhooks' : '/api/v1/webhooks',
			parameters: { subscribeAs: customer ? 'customer' : 'provider', events: [c.eventType], toleranceSeconds: 300 },
		};
	});
}

export const TRIGGER_NODE_NAME = 'Trigger';

/** A workflow with the trigger alone; its webhookId fixes the production webhook URL. */
export function triggerWorkflow(target, { runId, credential, webhookId, nodeId }) {
	return {
		name: `contract ${runId} ${target.name}`,
		nodes: [
			{
				id: nodeId,
				name: TRIGGER_NODE_NAME,
				type: target.triggerType,
				typeVersion: 1,
				position: [0, 0],
				webhookId,
				parameters: target.parameters,
				credentials: { [target.credentialType]: { id: credential.id, name: credential.name } },
			},
		],
		connections: {},
		settings: { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all' },
	};
}

export function readState(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeState(path, state) {
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

/** Items the trigger node put out in one execution, read from the execution's run data. */
export function triggerItems(execution) {
	let data = execution?.data;
	if (typeof data === 'string') data = JSON.parse(data);
	const runs = data?.resultData?.runData?.[TRIGGER_NODE_NAME];
	if (!Array.isArray(runs) || runs.length === 0) return undefined;
	const main = runs[0]?.data?.main?.[0];
	return Array.isArray(main) ? main : undefined;
}
