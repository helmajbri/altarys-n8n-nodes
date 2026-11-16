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

import { rememberEvent } from './dedupe';
import { DEFAULT_TOLERANCE_SECONDS, MAX_TOLERANCE_SECONDS, verifySignatureV2 } from './signature';
import { asRecord, letzCloudRequest, webhooksBase, type SubscribeAs } from './transport';

/** The appliance lists at most this many endpoints per page. */
const PAGE_SIZE = 100;

/** Pages read when looking for this trigger's endpoint before giving up with a message. */
export const MAX_ENDPOINT_PAGES = 50;

interface StoredEndpoint {
	id: string;
	url: string;
	event_types?: string[];
	active?: boolean;
}

function toSubscribeAs(value: unknown): SubscribeAs {
	return value === 'customer' ? 'customer' : 'provider';
}

function sameEvents(a: string[] | undefined, b: string[]): boolean {
	const left = [...(a ?? [])].sort();
	const right = [...b].sort();
	return left.length === right.length && left.every((value, i) => value === right[i]);
}

/** Every endpoint registered at this exact URL. The list has no URL filter, so it is paged. */
async function endpointsAt(
	this: IHookFunctions,
	subscribeAs: SubscribeAs,
	webhookUrl: string,
): Promise<StoredEndpoint[]> {
	const base = webhooksBase(subscribeAs);
	const found: StoredEndpoint[] = [];
	for (let page = 1; page <= MAX_ENDPOINT_PAGES; page++) {
		const answer = await letzCloudRequest.call(this, 'GET', `${base}/endpoints`, {
			qs: { page, per_page: PAGE_SIZE },
		});
		const items = asRecord(answer.body).items;
		const list = (Array.isArray(items) ? items : []) as unknown as StoredEndpoint[];
		found.push(...list.filter((e) => e.url === webhookUrl));
		if (list.length < PAGE_SIZE) return found;
	}
	throw new NodeOperationError(
		this.getNode(),
		`LetzCloud lists more than ${MAX_ENDPOINT_PAGES * PAGE_SIZE} webhook endpoints`,
		{ description: 'Remove webhook endpoints that are no longer used, then activate the workflow again.' },
	);
}

/** Removes an endpoint; one that is already gone counts as removed. */
async function removeEndpoint(this: IHookFunctions, subscribeAs: SubscribeAs, id: string): Promise<void> {
	const base = webhooksBase(subscribeAs);
	await letzCloudRequest.call(this, 'DELETE', `${base}/endpoints/${encodeURIComponent(id)}`, {
		allowStatus: [404],
	});
}

export class LetzCloudTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LetzCloud Trigger',
		name: 'letzCloudTrigger',
		icon: { light: 'file:../../icons/letzcloud.svg', dark: 'file:../../icons/letzcloud.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when a LetzCloud appliance sends a signed webhook event',
		defaults: {
			name: 'LetzCloud Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'letzCloudApi',
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
				displayName: 'Subscribe As',
				name: 'subscribeAs',
				type: 'options',
				options: [
					{
						name: 'Customer',
						value: 'customer',
						description:
							"Events of the customer the key belongs to, including its invoices and usage alerts. Needs a customer key with 'monitoring:read' and 'monitoring:write'.",
					},
					{
						name: 'Provider',
						value: 'provider',
						description:
							"Events of the whole provider organization. Needs a provider key with 'infrastructure:admin'.",
					},
				],
				default: 'provider',
				description: 'Whose events to receive; the key in the credential must belong to the same side',
			},
			{
				displayName: 'Event Names or IDs',
				name: 'events',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getEventTypes',
					loadOptionsDependsOn: ['subscribeAs'],
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
					// Same value as MAX_TOLERANCE_SECONDS; a larger value refuses every delivery.
					maxValue: 900,
					numberPrecision: 0,
				},
				// Same value as DEFAULT_TOLERANCE_SECONDS; lint wants a literal default here.
				default: 300,
				description:
					'How far the signed delivery time may be from the clock of this n8n instance before the delivery is dropped, from 1 to 900',
			},
		],
	};

	methods = {
		loadOptions: {
			async getEventTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const base = webhooksBase(toSubscribeAs(this.getNodeParameter('subscribeAs', 'provider')));
				const answer = await letzCloudRequest.call(this, 'GET', `${base}/event_types`);
				const items = asRecord(answer.body).items;
				const entries = (Array.isArray(items) ? items : []) as Array<{ type: string; description?: string }>;
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
				const subscribeAs = toSubscribeAs(this.getNodeParameter('subscribeAs', 'provider'));
				const storedId = typeof staticData.endpointId === 'string' ? staticData.endpointId : '';
				if (storedId && staticData.subscribeAs !== undefined && staticData.subscribeAs !== subscribeAs) {
					// 'Subscribe As' changed: the old endpoint lives on the other side; remove it there.
					await removeEndpoint.call(this, toSubscribeAs(staticData.subscribeAs), storedId);
				}
				const existing = await endpointsAt.call(this, subscribeAs, webhookUrl);
				const stored = existing.find((e) => e.id === staticData.endpointId);
				const hasSecret = typeof staticData.endpointSecret === 'string' && staticData.endpointSecret !== '';
				if (
					stored &&
					hasSecret &&
					staticData.subscribeAs === subscribeAs &&
					stored.active !== false &&
					sameEvents(stored.event_types, events)
				) {
					return true;
				}
				// Anything else at this URL is a leftover we can no longer verify: remove it so that
				// create() registers exactly one endpoint.
				for (const endpoint of existing) {
					await removeEndpoint.call(this, subscribeAs, endpoint.id);
				}
				delete staticData.endpointId;
				delete staticData.endpointSecret;
				delete staticData.subscribeAs;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const events = this.getNodeParameter('events', []) as string[];
				const subscribeAs = toSubscribeAs(this.getNodeParameter('subscribeAs', 'provider'));
				if (!/^https:\/\//i.test(webhookUrl)) {
					throw new NodeOperationError(this.getNode(), "LetzCloud only delivers to 'https://' webhook URLs", {
						description: `This workflow's webhook URL is ${webhookUrl}. Serve n8n over HTTPS so its webhook URLs start with 'https://'.`,
					});
				}
				const answer = await letzCloudRequest.call(this, 'POST', `${webhooksBase(subscribeAs)}/endpoints`, {
					body: { url: webhookUrl, event_types: events },
				});
				const created = asRecord(answer.body);
				const id = typeof created.id === 'string' ? created.id : '';
				const secret = typeof created.secret === 'string' ? created.secret : '';
				if (!id || !secret) {
					if (id) await removeEndpoint.call(this, subscribeAs, id);
					throw new NodeOperationError(
						this.getNode(),
						'LetzCloud registered the webhook without returning its signing secret',
						{ description: 'Deliveries could not be verified, so the endpoint was removed again.' },
					);
				}
				const staticData = this.getWorkflowStaticData('node');
				staticData.endpointId = id;
				staticData.endpointSecret = secret;
				staticData.subscribeAs = subscribeAs;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const id = typeof staticData.endpointId === 'string' ? staticData.endpointId : '';
				if (id) await removeEndpoint.call(this, toSubscribeAs(staticData.subscribeAs), id);
				delete staticData.endpointId;
				delete staticData.endpointSecret;
				delete staticData.subscribeAs;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const staticData = this.getWorkflowStaticData('node');
		const nowSeconds = Math.floor(Date.now() / 1000);
		const toleranceSeconds = Number(this.getNodeParameter('toleranceSeconds', DEFAULT_TOLERANCE_SECONDS));
		const timestampHeader = request.header('x-webhook-timestamp');
		const verification = verifySignatureV2({
			timestamp: timestampHeader,
			signature: request.header('x-webhook-signature-v2'),
			rawBody: request.rawBody,
			secret: typeof staticData.endpointSecret === 'string' ? staticData.endpointSecret : '',
			nowSeconds,
			toleranceSeconds,
		});
		if (!verification.ok) {
			this.logger.warn(`LetzCloud Trigger dropped a delivery: ${verification.reason}`, {
				workflowId: this.getWorkflow().id,
			});
			this.getResponseObject().status(401).send('Unauthorized').end();
			return { noWebhookResponse: true };
		}
		const body = this.getBodyData();
		const metadata = body.metadata as IDataObject | undefined;
		const eventId = typeof metadata?.event_id === 'string' ? metadata.event_id : '';
		if (eventId) {
			// n8n saves node static data changed during a production webhook call, so the IDs seen
			// survive between deliveries. Answering a repeat without data starts no workflow.
			const seen = rememberEvent(
				staticData.seenEvents,
				eventId,
				Number(timestampHeader),
				nowSeconds,
				Math.min(toleranceSeconds, MAX_TOLERANCE_SECONDS),
			);
			staticData.seenEvents = seen.next;
			if (seen.duplicate) return { webhookResponse: 'Duplicate delivery ignored' };
		}
		return { workflowData: [[{ json: body }]] };
	}
}
