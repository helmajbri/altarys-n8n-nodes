import type {
	DeclarativeRestApiSettings,
	IDataObject,
	IExecutePaginationFunctions,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	INode,
	INodeExecutionData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { describeLetzBillRefusal, parseResponseBody } from './refusal';

/** What the generator records about each operation; tests and reviewers read it. */
export interface GeneratedOperationSpec {
	resource: string;
	operation: string;
	method: string;
	path: string;
	idempotency: string;
	destructive: boolean;
	output: string;
	root: string;
	maxPerPage: number;
	itemSchema: string;
	outputOmit: string[];
	minorUnitInputs: string[];
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,255}$/;

/** Turns a LetzBill refusal (any status from 400 up) into a readable node error. */
export async function checkResponse(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	if (response.statusCode < 400) return items;
	const body = parseResponseBody(response.body);
	const refusal = describeLetzBillRefusal(response.statusCode, body);
	const payload: JsonObject =
		body !== null && typeof body === 'object' && !Array.isArray(body)
			? (body as JsonObject)
			: { body: typeof body === 'string' ? body : '' };
	throw new NodeApiError(this.getNode(), payload, {
		message: refusal.message,
		description: refusal.description,
		httpCode: String(response.statusCode),
		itemIndex: this.getItemIndex(),
	});
}

/** A delete answers 204 with no body; the node returns {"deleted": true} instead. */
export async function returnDeleted(
	this: IExecuteSingleFunctions,
): Promise<INodeExecutionData[]> {
	return [{ json: { deleted: true } }];
}

function removePath(target: unknown, segments: string[]): void {
	if (target === null || typeof target !== 'object') return;
	const [head, ...rest] = segments;
	const isList = head.endsWith('[]');
	const key = isList ? head.slice(0, -2) : head;
	const record = target as IDataObject;
	if (rest.length === 0 && !isList) {
		delete record[key];
		return;
	}
	const next = record[key];
	if (isList) {
		if (Array.isArray(next)) for (const entry of next) removePath(entry, rest);
		return;
	}
	removePath(next, rest);
}

/**
 * Drops amounts that are not integer minor units (a major-unit duplicate of a *_cents field, or a
 * fractional figure), so every amount the node outputs is an integer with a currency beside it.
 */
export function omitMoneyFields(paths: string[]) {
	return async function (
		this: IExecuteSingleFunctions,
		items: INodeExecutionData[],
	): Promise<INodeExecutionData[]> {
		for (const item of items) {
			for (const path of paths) removePath(item.json, path.split('.'));
		}
		return items;
	};
}

function collectValues(source: unknown, segments: string[], out: unknown[]): void {
	if (source === null || typeof source !== 'object') return;
	const [head, ...rest] = segments;
	const isList = head.endsWith('[]');
	const key = isList ? head.slice(0, -2) : head;
	const next = (source as IDataObject)[key];
	if (rest.length === 0 && !isList) {
		out.push(next);
		return;
	}
	if (isList) {
		if (Array.isArray(next)) for (const entry of next) collectValues(entry, rest, out);
		return;
	}
	collectValues(next, rest, out);
}

/** Refuses to send an amount that is not a whole number of minor units. */
export function requireIntegerMinorUnits(paths: string[]) {
	return async function (
		this: IExecuteSingleFunctions,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const body = requestOptions.body;
		for (const path of paths) {
			const values: unknown[] = [];
			collectValues(body, path.split('.'), values);
			for (const value of values) {
				if (value === undefined || value === null) continue;
				if (typeof value !== 'number' || !Number.isInteger(value)) {
					throw new NodeOperationError(
						this.getNode(),
						`'${path}' must be a whole number of minor units [Item ${this.getItemIndex()}]`,
						{
							description:
								'Send the amount in the smallest unit of its currency, e.g. 1250 for 12.50 EUR',
							itemIndex: this.getItemIndex(),
						},
					);
				}
			}
		}
		return requestOptions;
	};
}

/**
 * The key derived when 'Idempotency Key' is empty. It names the workflow, the node, the execution,
 * the run of the node and the item: a retry of the same item (n8n's Retry On Fail re-runs the
 * node inside the same run) keeps the key, while another node, another loop pass or another item
 * gets a new one. The run index comes from the workflow data proxy ($runIndex).
 */
export function derivedIdempotencyKey(this: IExecuteSingleFunctions): string {
	const itemIndex = this.getItemIndex();
	const runIndex = Number(this.getWorkflowDataProxy(itemIndex).$runIndex ?? 0);
	const parts = [
		'n8n',
		this.getWorkflow().id ?? 'workflow',
		this.getNode().id,
		this.getExecutionId(),
		`r${Number.isInteger(runIndex) ? runIndex : 0}`,
		`i${itemIndex}`,
	];
	return parts.join('-').replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 255);
}

/**
 * Sends an idempotency key where the LetzBill route honours one: as the Idempotency-Key header,
 * or as a body field. An empty parameter uses derivedIdempotencyKey.
 */
export function applyIdempotencyKey(target: 'header' | 'body', bodyField = '') {
	return async function (
		this: IExecuteSingleFunctions,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const given = String(this.getNodeParameter('idempotencyKey', '') ?? '').trim();
		const value = given !== '' ? given : derivedIdempotencyKey.call(this);
		if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
			throw new NodeOperationError(
				this.getNode(),
				`'Idempotency Key' can only hold letters, digits and _ . : - [Item ${this.getItemIndex()}]`,
				{
					description: 'Use at most 255 of those characters, or leave the field empty',
					itemIndex: this.getItemIndex(),
				},
			);
		}
		if (target === 'header') {
			requestOptions.headers = { ...(requestOptions.headers ?? {}), 'Idempotency-Key': value };
		} else {
			const body =
				requestOptions.body !== null &&
				typeof requestOptions.body === 'object' &&
				!Array.isArray(requestOptions.body)
					? (requestOptions.body as IDataObject)
					: {};
			body[bodyField] = value;
			requestOptions.body = body;
		}
		return requestOptions;
	};
}

/** At most this many pages per "Return All": 10,000 pages of up to 1,000 items. */
export const MAX_PAGES = 10000;

/**
 * "Return All": walks page / per_page until a page comes back short. It stops with a message,
 * instead of looping, when a page repeats the one before it (the server ignored `page`) or when
 * maxPages pages were all full.
 */
export function paginateByPage(perPage: number, maxPages = MAX_PAGES) {
	return async function (
		this: IExecutePaginationFunctions,
		requestData: DeclarativeRestApiSettings.ResultOptions,
	): Promise<INodeExecutionData[]> {
		const results: INodeExecutionData[] = [];
		let previous = '';
		for (let page = 1; page <= maxPages; page++) {
			requestData.options.qs = { ...(requestData.options.qs ?? {}), page, per_page: perPage };
			const pageItems = await this.makeRoutingRequest(requestData);
			if (pageItems.length < perPage) {
				results.push(...pageItems);
				return results;
			}
			const signature = JSON.stringify(pageItems.map((item) => item.json));
			if (signature === previous) {
				throw new NodeOperationError(
					this.getNode(),
					`LetzBill returned page ${page} with the same items as page ${page - 1}`,
					{ description: "Turn off 'Return All' and use 'Limit', or narrow the filters" },
				);
			}
			previous = signature;
			results.push(...pageItems);
		}
		throw new NodeOperationError(this.getNode(), `LetzBill still had full pages after ${maxPages} pages`, {
			description: "Turn off 'Return All' and use 'Limit', or narrow the filters",
		});
	};
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Refuses an ID that is not a UUID before it is placed in the request path. */
export function requireUuids(parameters: string[]) {
	return async function (
		this: IExecuteSingleFunctions,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		for (const name of parameters) {
			const value = String(this.getNodeParameter(name, '') ?? '').trim();
			if (!UUID_PATTERN.test(value)) {
				throw new NodeOperationError(
					this.getNode(),
					`'${name}' must be a LetzBill ID (a UUID) [Item ${this.getItemIndex()}]`,
					{
						description: 'e.g. 3f2b8c1e-5d4a-4f6b-9c2d-1a2b3c4d5e6f',
						itemIndex: this.getItemIndex(),
					},
				);
			}
		}
		return requestOptions;
	};
}

/**
 * Refuses a credential whose API URL does not use HTTPS: the API key travels in the Authorization
 * header, and over plain HTTP anyone on the network path could read and reuse it.
 */
export function assertHttpsBaseUrl(baseUrl: unknown, node: INode): void {
	if (!/^https:\/\//i.test(String(baseUrl ?? '').trim())) {
		throw new NodeOperationError(node, "The LetzBill credential's API URL must start with https://", {
			description:
				'The API key is sent with every request; over plain http:// it could be read and reused. Use the https:// address of the LetzBill API.',
		});
	}
}

export async function requireHttps(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	assertHttpsBaseUrl(requestOptions.baseURL, this.getNode());
	return requestOptions;
}
