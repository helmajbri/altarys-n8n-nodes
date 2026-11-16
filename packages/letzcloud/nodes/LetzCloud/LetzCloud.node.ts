import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';

import { generatedProperties } from './generated/operations';
import { waitForClusterRunning, waitForInstanceState, waitProperties } from './shared/wait';

export class LetzCloud implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LetzCloud',
		name: 'letzCloud',
		icon: { light: 'file:../../icons/letzcloud.svg', dark: 'file:../../icons/letzcloud.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Manage instances, volumes, snapshots, networks, Kubernetes clusters, containers, databases and DNS records on a LetzCloud appliance, and read your own invoices, usage and wallet',
		defaults: {
			name: 'LetzCloud',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'letzCloudApi',
				required: true,
			},
		],
		requestDefaults: {
			baseURL: '={{$credentials.baseUrl}}',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			// Refusals reach checkResponse, which turns them into readable messages.
			ignoreHttpStatusErrors: true,
		},
		properties: [...generatedProperties, ...waitProperties],
	};

	// The wait operations read a resource until it reaches a state; declarative routing sends one
	// request per item, so these two are code. Every other operation is declarative.
	customOperations = {
		instance: { waitForState: waitForInstanceState },
		kubernetesCluster: { waitUntilRunning: waitForClusterRunning },
	};
}
