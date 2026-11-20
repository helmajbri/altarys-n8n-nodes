// Red controls for the contract suite: breaks one guard in both triggers' source before the build,
// so a run can show that the suite fails without it. Each edit must match exactly once in each
// file, so a mutation that no longer applies stops the run instead of passing as a no-op.
// Usage: node contract/mutate.mjs <mutation> <repository root>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILES = {
	letzbill: 'packages/letzbill/nodes/LetzBillTrigger/LetzBillTrigger.node.ts',
	letzcloud: 'packages/letzcloud/nodes/LetzCloudTrigger/LetzCloudTrigger.node.ts',
};

const DELETE_HEAD = 'async delete(this: IHookFunctions): Promise<boolean> {\n\t\t\t\tconst staticData';

const MUTATIONS = {
	// The delivery is processed whether or not signature v2 verified.
	'no-signature-check': {
		letzbill: [['if (!verification.ok) {', 'if (!verification.ok && staticData.contractRedControl === true) {']],
		letzcloud: [['if (!verification.ok) {', 'if (!verification.ok && staticData.contractRedControl === true) {']],
	},
	// Deactivation no longer removes the endpoint at the server.
	'no-delete': {
		letzbill: [[`${DELETE_HEAD}`, `${DELETE_HEAD}`], ['if (id) await removeEndpoint.call(this, id);\n\t\t\t\tdelete staticData.endpointId;\n\t\t\t\tdelete staticData.endpointSecret;\n\t\t\t\treturn true;', 'void id;\n\t\t\t\tdelete staticData.endpointId;\n\t\t\t\tdelete staticData.endpointSecret;\n\t\t\t\treturn true;']],
		letzcloud: [['if (id) await removeEndpoint.call(this, toSubscribeAs(staticData.subscribeAs), id);', 'void id;']],
	},
	// checkExists always answers "not registered" and removes nothing, so every activation creates.
	'no-activation-dedupe': {
		letzbill: [['async checkExists(this: IHookFunctions): Promise<boolean> {', 'async checkExists(this: IHookFunctions): Promise<boolean> {\n\t\t\t\tif (Date.now() > 0) return false;']],
		letzcloud: [['async checkExists(this: IHookFunctions): Promise<boolean> {', 'async checkExists(this: IHookFunctions): Promise<boolean> {\n\t\t\t\tif (Date.now() > 0) return false;']],
	},
};

const [mutation, root] = process.argv.slice(2);
if (!MUTATIONS[mutation] || !root) {
	console.error(`usage: node contract/mutate.mjs <${Object.keys(MUTATIONS).join('|')}> <repository root>`);
	process.exit(2);
}

for (const [pkg, edits] of Object.entries(MUTATIONS[mutation])) {
	const path = join(root, FILES[pkg]);
	let text = readFileSync(path, 'utf8');
	for (const [from, to] of edits) {
		const count = text.split(from).length - 1;
		if (count !== 1) {
			console.error(`MUTATION ${mutation} does not apply to ${FILES[pkg]}: anchor found ${count} times`);
			process.exit(1);
		}
		text = text.replace(from, to);
	}
	writeFileSync(path, text);
	console.log(`MUTATION ${mutation} applied to ${FILES[pkg]}`);
}
