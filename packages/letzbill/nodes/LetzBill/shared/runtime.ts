import type {
	DeclarativeRestApiSettings,
	IDataObject,
	IExecutePaginationFunctions,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
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
 * Sends an idempotency key where the LetzBill route honours one: as the Idempotency-Key header,
 * or as a body field. An empty parameter derives a key that is stable for the same workflow,
 * execution and item, so a retry inside one execution is recognised.
 */
export function applyIdempotencyKey(target: 'header' | 'body', bodyField = '') {
	return async function (
		this: IExecuteSingleFunctions,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const given = String(this.getNodeParameter('idempotencyKey', '') ?? '').trim();
		const workflowId = this.getWorkflow().id ?? 'workflow';
		const derived = `n8n-${workflowId}-${this.getExecutionId()}-${this.getItemIndex()}`;
		const value = given !== '' ? given : derived.replace(/[^A-Za-z0-9_.:-]/g, '-');
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

/** "Return All": walks page / per_page until a page comes back short. */
export function paginateByPage(perPage: number) {
	return async function (
		this: IExecutePaginationFunctions,
		requestData: DeclarativeRestApiSettings.ResultOptions,
	): Promise<INodeExecutionData[]> {
		const results: INodeExecutionData[] = [];
		let page = 1;
		for (;;) {
			requestData.options.qs = { ...(requestData.options.qs ?? {}), page, per_page: perPage };
			const pageItems = await this.makeRoutingRequest(requestData);
			results.push(...pageItems);
			if (pageItems.length < perPage) break;
			page += 1;
		}
		return results;
	};
}
