import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IHookFunctions,
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';

import { DEFAULT_TOLERANCE_SECONDS, verifySignatureV2 } from './signature';
import { dataOf, letzBillRequest } from './transport';

const ENDPOINTS_PATH = '/api/v1/webhooks/endpoints';

interface StoredEndpoint {
	id: string;
	webhook_url: string;
	event_types?: string[];
	active?: boolean;
}

function sameEvents(a: string[] | undefined, b: string[]): boolean {
	const left = [...(a ?? [])].sort();
	const right = [...b].sort();
	return left.length === right.length && left.every((value, i) => value === right[i]);
}

async function endpointsAt(this: IHookFunctions, webhookUrl: string): Promise<StoredEndpoint[]> {
	const answer = await letzBillRequest.call(this, 'GET', ENDPOINTS_PATH, {
		qs: { url: webhookUrl, per_page: 500 },
	});
	const page = dataOf(answer.body) as IDataObject | undefined;
	const items = (page?.items ?? []) as unknown as StoredEndpoint[];
	// The url filter is a substring match; only the exact URL is ours.
	return items.filter((e) => e.webhook_url === webhookUrl);
}

/** Removes an endpoint. Gone already counts as removed; held deliveries do not block removal. */
async function removeEndpoint(this: IHookFunctions, id: string): Promise<void> {
	const path = `${ENDPOINTS_PATH}/${encodeURIComponent(id)}`;
	const answer = await letzBillRequest.call(this, 'DELETE', path, { allowStatus: [404, 409] });
	if (answer.statusCode === 409) {
		// LetzBill keeps an endpoint that still has pending deliveries unless asked to force it.
		await letzBillRequest.call(this, 'DELETE', path, { qs: { force: true }, allowStatus: [404] });
	}
}

export class LetzBillTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LetzBill Trigger',
		name: 'letzBillTrigger',
		icon: { light: 'file:../../icons/letzbill.svg', dark: 'file:../../icons/letzbill.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when LetzBill sends a signed webhook event',
		defaults: {
			name: 'LetzBill Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'letzBillApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Event Names or IDs',
				name: 'events',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getEventTypes',
				},
				required: true,
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Timestamp Tolerance (Seconds)',
				name: 'toleranceSeconds',
				type: 'number',
				typeOptions: {
					minValue: 1,
					numberPrecision: 0,
				},
				// Same value as DEFAULT_TOLERANCE_SECONDS; lint wants a literal default here.
				default: 300,
				description:
					'How far the signed delivery time may be from the clock of this n8n instance before the delivery is dropped',
			},
		],
	};

	methods = {
		loadOptions: {
			async getEventTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const answer = await letzBillRequest.call(this, 'GET', '/api/v1/webhooks/event_types');
				const entries = (dataOf(answer.body) ?? []) as Array<{ type: string; description?: string }>;
				return entries
					.map((e) => ({ name: e.type, value: e.type, description: e.description ?? '' }))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const staticData = this.getWorkflowStaticData('node');
				const events = this.getNodeParameter('events', []) as string[];
				const existing = await endpointsAt.call(this, webhookUrl);
				const stored = existing.find((e) => e.id === staticData.endpointId);
				const hasSecret = typeof staticData.endpointSecret === 'string' && staticData.endpointSecret !== '';
				if (stored && hasSecret && stored.active !== false && sameEvents(stored.event_types, events)) {
					return true;
				}
				// Anything else at this URL is a leftover we can no longer verify: remove it so that
				// create() registers exactly one endpoint.
				for (const endpoint of existing) {
					await removeEndpoint.call(this, endpoint.id);
				}
				delete staticData.endpointId;
				delete staticData.endpointSecret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const events = this.getNodeParameter('events', []) as string[];
				const answer = await letzBillRequest.call(this, 'POST', ENDPOINTS_PATH, {
					body: { url: webhookUrl, event_types: events },
				});
				const created = (dataOf(answer.body) ?? {}) as IDataObject;
				const id = typeof created.id === 'string' ? created.id : '';
				const secret = typeof created.webhook_secret === 'string' ? created.webhook_secret : '';
				if (!id || !secret) {
					if (id) await removeEndpoint.call(this, id);
					throw new NodeOperationError(
						this.getNode(),
						'LetzBill registered the webhook without returning its signing secret',
						{ description: 'Deliveries could not be verified, so the endpoint was removed again.' },
					);
				}
				const staticData = this.getWorkflowStaticData('node');
				staticData.endpointId = id;
				staticData.endpointSecret = secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const id = typeof staticData.endpointId === 'string' ? staticData.endpointId : '';
				if (id) await removeEndpoint.call(this, id);
				delete staticData.endpointId;
				delete staticData.endpointSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const staticData = this.getWorkflowStaticData('node');
		const verification = verifySignatureV2({
			timestamp: request.header('x-webhook-timestamp'),
			signature: request.header('x-webhook-signature-v2'),
			rawBody: request.rawBody,
			secret: typeof staticData.endpointSecret === 'string' ? staticData.endpointSecret : '',
			nowSeconds: Math.floor(Date.now() / 1000),
			toleranceSeconds: this.getNodeParameter('toleranceSeconds', DEFAULT_TOLERANCE_SECONDS) as number,
		});
		if (!verification.ok) {
			this.logger.warn(`LetzBill Trigger dropped a delivery: ${verification.reason}`, {
				workflowId: this.getWorkflow().id,
			});
			this.getResponseObject().status(401).send('Unauthorized').end();
			return { noWebhookResponse: true };
		}
		return { workflowData: [[{ json: this.getBodyData() }]] };
	}
}
