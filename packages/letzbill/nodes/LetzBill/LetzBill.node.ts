import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';

import { generatedProperties } from './generated/operations';

export class LetzBill implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LetzBill',
		name: 'letzBill',
		icon: { light: 'file:../../icons/letzbill.svg', dark: 'file:../../icons/letzbill.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Manage customers, subscriptions, invoices, credit notes, payments, wallets and usage events in LetzBill',
		defaults: {
			name: 'LetzBill',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'letzBillApi',
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
		properties: generatedProperties,
	};
}
