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

import { describeLetzCloudRefusal, parseResponseBody } from './refusal';

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
	inheritCurrency: string[];
	uuidParameters: string[];
	safeParameters: string[];
}

/** Turns a LetzCloud refusal (any status from 400 up) into a readable node error. */
export async function checkResponse(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	if (response.statusCode < 400) return items;
	const body = parseResponseBody(response.body);
	const refusal = describeLetzCloudRefusal(response.statusCode, body);
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

/** A delete that answers with no body; the node returns {"deleted": true} instead. */
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

/** Drops amounts that are not integer minor units, so every amount output has a currency. */
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

function fillCurrency(target: unknown, segments: string[], field: string, carried: unknown): void {
	if (target === null || typeof target !== 'object' || Array.isArray(target)) return;
	const record = target as IDataObject;
	const own = record[field];
	const value = own !== undefined && own !== null ? own : carried;
	if (segments.length === 0) {
		if ((own === undefined || own === null) && value !== undefined) record[field] = value as IDataObject[string];
		return;
	}
	const [head, ...rest] = segments;
	const isList = head.endsWith('[]');
	const next = record[isList ? head.slice(0, -2) : head];
	if (isList) {
		if (Array.isArray(next)) for (const entry of next) fillCurrency(entry, rest, field, value);
		return;
	}
	fillCurrency(next, rest, field, value);
}

/**
 * Copies a currency into objects that carry amounts but leave the currency to an enclosing
 * object (`path=field`, e.g. 'plans[]=currency'), so each amount travels with its currency.
 */
export function inheritCurrency(entries: string[]) {
	return async function (
		this: IExecuteSingleFunctions,
		items: INodeExecutionData[],
	): Promise<INodeExecutionData[]> {
		for (const item of items) {
			for (const entry of entries) {
				const [path, field] = entry.split('=');
				fillCurrency(item.json, path === '' ? [] : path.split('.'), field, undefined);
			}
		}
		return items;
	};
}

/** At most this many pages per "Return All". */
export const MAX_PAGES = 10000;

/**
 * "Return All": walks page / page size until a page comes back short. It stops with a message,
 * instead of looping, when a page repeats the one before it (the server ignored `page`) or when
 * maxPages pages were all full.
 */
export function paginateByPage(perPage: number, perPageParameter = 'per_page', maxPages = MAX_PAGES) {
	return async function (
		this: IExecutePaginationFunctions,
		requestData: DeclarativeRestApiSettings.ResultOptions,
	): Promise<INodeExecutionData[]> {
		const results: INodeExecutionData[] = [];
		let previous = '';
		for (let page = 1; page <= maxPages; page++) {
			requestData.options.qs = { ...(requestData.options.qs ?? {}), page, [perPageParameter]: perPage };
			const pageItems = await this.makeRoutingRequest(requestData);
			if (pageItems.length < perPage) {
				results.push(...pageItems);
				return results;
			}
			const signature = JSON.stringify(pageItems.map((item) => item.json));
			if (signature === previous) {
				throw new NodeOperationError(
					this.getNode(),
					`LetzCloud returned page ${page} with the same items as page ${page - 1}`,
					{ description: "Turn off 'Return All' and use 'Limit', or narrow the filters" },
				);
			}
			previous = signature;
			results.push(...pageItems);
		}
		throw new NodeOperationError(this.getNode(), `LetzCloud still had full pages after ${maxPages} pages`, {
			description: "Turn off 'Return All' and use 'Limit', or narrow the filters",
		});
	};
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
					`'${name}' must be a LetzCloud ID (a UUID) [Item ${this.getItemIndex()}]`,
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

/** True for a value that may be placed in a path: not empty, '.' or '..', and no slash. */
export function isSafePathSegment(value: string): boolean {
	return value.trim() !== '' && value !== '.' && value !== '..' && !/[/\\]/.test(value);
}

/**
 * Refuses a path ID that is empty, '.', '..' or holds a slash or a backslash. The ID is
 * URL-encoded into the path, but a dot segment survives encoding and would move the request to
 * another route on the same host.
 */
export function requireSafePathSegments(parameters: string[]) {
	return async function (
		this: IExecuteSingleFunctions,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		for (const name of parameters) {
			const value = String(this.getNodeParameter(name, '') ?? '');
			if (!isSafePathSegment(value)) {
				throw new NodeOperationError(
					this.getNode(),
					`'${name}' must be an ID, not empty, '.', '..' or a path [Item ${this.getItemIndex()}]`,
					{
						description: 'Use the ID exactly as LetzCloud shows it, without slashes',
						itemIndex: this.getItemIndex(),
					},
				);
			}
		}
		return requestOptions;
	};
}

/**
 * Refuses a credential whose appliance URL does not use HTTPS: the API key travels in the
 * Authorization header, and over plain HTTP anyone on the network path could read and reuse it.
 */
export function assertHttpsBaseUrl(baseUrl: unknown, node: INode): void {
	if (!/^https:\/\//i.test(String(baseUrl ?? '').trim())) {
		throw new NodeOperationError(node, "The LetzCloud credential's appliance URL must start with 'https://'", {
			description:
				"The API key is sent with every request; over plain 'http://' it could be read and reused. Use the 'https://' address of the appliance.",
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
