import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	INodeProperties,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

import { describeLetzCloudRefusal, parseResponseBody } from './refusal';
import { UUID_PATTERN, assertHttpsBaseUrl } from './runtime';

// The "wait" operations are code (customOperations): n8n's declarative routing sends one request
// per item and has no way to repeat it, so reading a resource until it reaches a state is done
// here, with the sleep helper from n8n-workflow between reads.

export const CREDENTIAL_TYPE = 'letzCloudApi';

/** Instance states that end a wait without reaching the one asked for. */
export const INSTANCE_FAILED_STATES = ['Destroyed', 'Error', 'Expunging'];

/** Kubernetes cluster states that end a wait for Running. */
export const CLUSTER_FAILED_STATES = ['Destroyed', 'Destroying', 'Error'];

export type PollRead<T> =
	| { status: 'ready'; value: T }
	| { status: 'failed'; reason: string }
	| { status: 'pending'; detail: string };

export interface PollOptions<T> {
	read: () => Promise<PollRead<T>>;
	timeoutSeconds: number;
	intervalSeconds: number;
	sleep: (milliseconds: number) => Promise<void>;
	now: () => number;
}

export class WaitStopped extends Error {
	constructor(
		message: string,
		readonly reason: 'failed' | 'timeout',
	) {
		super(message);
	}
}

/**
 * Reads until the resource is ready, it reaches a state that cannot become ready, or the time
 * limit passes. The number of reads is bounded by the limit and the interval as well as by the
 * clock, so a clock that does not move cannot make it loop forever.
 */
export async function pollUntil<T>(options: PollOptions<T>): Promise<{ value: T; reads: number }> {
	const timeout = Math.max(0, options.timeoutSeconds) * 1000;
	const interval = Math.max(1, options.intervalSeconds) * 1000;
	const maxReads = Math.floor(timeout / interval) + 1;
	const started = options.now();
	let last = '';
	for (let reads = 1; reads <= maxReads; reads++) {
		const read = await options.read();
		if (read.status === 'ready') return { value: read.value, reads };
		if (read.status === 'failed') throw new WaitStopped(read.reason, 'failed');
		last = read.detail;
		if (reads === maxReads || options.now() - started + interval > timeout) break;
		await options.sleep(interval);
	}
	throw new WaitStopped(`Still not ready after ${options.timeoutSeconds} seconds: ${last}`, 'timeout');
}

async function letzCloudGet(
	ctx: IExecuteFunctions,
	itemIndex: number,
	url: string,
	qs?: IDataObject,
): Promise<unknown> {
	const credentials = await ctx.getCredentials<{ baseUrl: string }>(CREDENTIAL_TYPE, itemIndex);
	assertHttpsBaseUrl(credentials.baseUrl, ctx.getNode());
	const request: IHttpRequestOptions = {
		method: 'GET',
		baseURL: credentials.baseUrl,
		url,
		qs,
		json: true,
		headers: { Accept: 'application/json' },
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	const response = (await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		CREDENTIAL_TYPE,
		request,
	)) as IN8nHttpFullResponse;
	const body = parseResponseBody(response.body);
	if (response.statusCode >= 400) {
		const refusal = describeLetzCloudRefusal(response.statusCode, body);
		const payload: JsonObject =
			body !== null && typeof body === 'object' && !Array.isArray(body)
				? (body as JsonObject)
				: { body: typeof body === 'string' ? body : '' };
		throw new NodeApiError(ctx.getNode(), payload, {
			message: refusal.message,
			description: refusal.description,
			httpCode: String(response.statusCode),
			itemIndex,
		});
	}
	return body;
}

function asRecord(value: unknown): IDataObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as IDataObject) : {};
}

/** One read of an instance, judged against the state asked for. */
export function judgeInstance(body: unknown, target: string): PollRead<IDataObject> {
	const instance = asRecord(body);
	const state = typeof instance.state === 'string' ? instance.state : '';
	if (state === target) return { status: 'ready', value: instance };
	if (INSTANCE_FAILED_STATES.includes(state)) {
		return { status: 'failed', reason: `The instance is ${state}, so it will not become ${target}` };
	}
	return { status: 'pending', detail: `the instance is ${state || 'in an unknown state'}` };
}

/** One read of the cluster list filtered by name, judged against Running. */
export function judgeCluster(body: unknown, name: string): PollRead<IDataObject> {
	const items = asRecord(body).items;
	const matches = (Array.isArray(items) ? items : []).map(asRecord).filter((c) => c.name === name);
	if (matches.length === 0) return { status: 'pending', detail: `no cluster named '${name}' is listed yet` };
	if (matches.length > 1) {
		return {
			status: 'failed',
			reason: `${matches.length} clusters are named '${name}'; get the cluster by ID instead`,
		};
	}
	const cluster = matches[0];
	const state = typeof cluster.state === 'string' ? cluster.state : '';
	if (state === 'Running') return { status: 'ready', value: cluster };
	if (CLUSTER_FAILED_STATES.includes(state)) {
		return { status: 'failed', reason: `The cluster is ${state}, so it will not become Running` };
	}
	return { status: 'pending', detail: `the cluster is ${state || 'in an unknown state'}` };
}

const show = (resource: string, operation: string) => ({ show: { resource: [resource], operation: [operation] } });

export const waitProperties: INodeProperties[] = [
	{
		displayName: 'VM ID',
		name: 'vmId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show('instance', 'waitForState'),
	},
	{
		displayName: 'State',
		name: 'targetState',
		type: 'options',
		options: [
			{ name: 'Running', value: 'Running' },
			{ name: 'Stopped', value: 'Stopped' },
		],
		default: 'Running',
		description: 'The state to wait for: Running after a start or a reboot, Stopped after a stop',
		displayOptions: show('instance', 'waitForState'),
	},
	{
		displayName: 'Cluster Name',
		name: 'clusterName',
		type: 'string',
		required: true,
		default: '',
		description:
			'The name the cluster was created with. Creating a cluster answers with a job, not with the cluster ID.',
		displayOptions: show('kubernetesCluster', 'waitUntilRunning'),
	},
	{
		displayName: 'Time Limit (Seconds)',
		name: 'timeoutSeconds',
		type: 'number',
		typeOptions: { minValue: 10, maxValue: 7200, numberPrecision: 0 },
		default: 900,
		description: 'How long to wait before the node stops with a message, from 10 to 7200',
		displayOptions: { show: { resource: ['instance', 'kubernetesCluster'], operation: ['waitForState', 'waitUntilRunning'] } },
	},
	{
		displayName: 'Interval (Seconds)',
		name: 'intervalSeconds',
		type: 'number',
		typeOptions: { minValue: 5, maxValue: 600, numberPrecision: 0 },
		default: 15,
		description: 'How long to wait between two reads, from 5 to 600',
		displayOptions: { show: { resource: ['instance', 'kubernetesCluster'], operation: ['waitForState', 'waitUntilRunning'] } },
	},
];

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(n)));
}

async function runWait(
	ctx: IExecuteFunctions,
	waitFor: (itemIndex: number, timeoutSeconds: number, intervalSeconds: number) => Promise<IDataObject>,
): Promise<INodeExecutionData[][]> {
	const items = ctx.getInputData();
	const out: INodeExecutionData[] = [];
	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			const timeoutSeconds = boundedNumber(ctx.getNodeParameter('timeoutSeconds', itemIndex, 900), 10, 7200, 900);
			const intervalSeconds = boundedNumber(ctx.getNodeParameter('intervalSeconds', itemIndex, 15), 5, 600, 15);
			const value = await waitFor(itemIndex, timeoutSeconds, intervalSeconds);
			out.push({ json: value, pairedItem: { item: itemIndex } });
		} catch (error) {
			const stopped =
				error instanceof WaitStopped
					? new NodeOperationError(ctx.getNode(), `${error.message} [Item ${itemIndex}]`, {
							description:
								error.reason === 'timeout'
									? "Raise 'Time Limit (Seconds)', or check the resource in the LetzCloud console"
									: 'Check the resource in the LetzCloud console',
							itemIndex,
						})
					: error;
			if (ctx.continueOnFail()) {
				out.push({ json: { error: (stopped as Error).message }, pairedItem: { item: itemIndex } });
				continue;
			}
			throw stopped;
		}
	}
	return [out];
}

export async function waitForInstanceState(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	return await runWait(this, async (itemIndex, timeoutSeconds, intervalSeconds) => {
		const vmId = String(this.getNodeParameter('vmId', itemIndex, '') ?? '').trim();
		if (!UUID_PATTERN.test(vmId)) {
			throw new NodeOperationError(this.getNode(), `'VM ID' must be a LetzCloud ID (a UUID) [Item ${itemIndex}]`, {
				description: 'e.g. 3f2b8c1e-5d4a-4f6b-9c2d-1a2b3c4d5e6f',
				itemIndex,
			});
		}
		const target = String(this.getNodeParameter('targetState', itemIndex, 'Running'));
		if (target !== 'Running' && target !== 'Stopped') {
			throw new NodeOperationError(this.getNode(), `'State' must be Running or Stopped [Item ${itemIndex}]`, {
				itemIndex,
			});
		}
		const { value } = await pollUntil({
			read: async () => judgeInstance(await letzCloudGet(this, itemIndex, `/api/v1/vms/${encodeURIComponent(vmId)}`), target),
			timeoutSeconds,
			intervalSeconds,
			sleep,
			now: () => Date.now(),
		});
		return value;
	});
}

export async function waitForClusterRunning(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	return await runWait(this, async (itemIndex, timeoutSeconds, intervalSeconds) => {
		const name = String(this.getNodeParameter('clusterName', itemIndex, '') ?? '').trim();
		if (name === '') {
			throw new NodeOperationError(this.getNode(), `'Cluster Name' is empty [Item ${itemIndex}]`, {
				description: 'Enter the name the cluster was created with',
				itemIndex,
			});
		}
		const { value } = await pollUntil({
			read: async () =>
				judgeCluster(
					await letzCloudGet(this, itemIndex, '/api/v1/kubernetes/clusters', { name, page: 1, page_size: 50 }),
					name,
				),
			timeoutSeconds,
			intervalSeconds,
			sleep,
			now: () => Date.now(),
		});
		return value;
	});
}
