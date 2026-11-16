import type {
	IDataObject,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IN8nHttpFullResponse,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { describeLetzBillRefusal, parseResponseBody } from '../LetzBill/shared/refusal';
import { assertHttpsBaseUrl } from '../LetzBill/shared/runtime';

export const CREDENTIAL_TYPE = 'letzBillApi';

export interface LetzBillAnswer {
	statusCode: number;
	body: unknown;
}

/** One authenticated call to LetzBill; refusals become readable node errors unless allowed. */
export async function letzBillRequest(
	this: IHookFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	url: string,
	options: { qs?: IDataObject; body?: IDataObject; allowStatus?: number[] } = {},
): Promise<LetzBillAnswer> {
	const credentials = await this.getCredentials<{ baseUrl: string }>(CREDENTIAL_TYPE);
	assertHttpsBaseUrl(credentials.baseUrl, this.getNode());
	const request: IHttpRequestOptions = {
		method,
		baseURL: credentials.baseUrl,
		url,
		qs: options.qs,
		body: options.body,
		json: true,
		headers: { Accept: 'application/json' },
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		CREDENTIAL_TYPE,
		request,
	)) as IN8nHttpFullResponse;
	const body = parseResponseBody(response.body);
	const allowed = options.allowStatus ?? [];
	if (response.statusCode >= 400 && !allowed.includes(response.statusCode)) {
		const refusal = describeLetzBillRefusal(response.statusCode, body);
		const payload: JsonObject =
			body !== null && typeof body === 'object' && !Array.isArray(body)
				? (body as JsonObject)
				: { body: typeof body === 'string' ? body : '' };
		throw new NodeApiError(this.getNode(), payload, {
			message: refusal.message,
			description: refusal.description,
			httpCode: String(response.statusCode),
		});
	}
	return { statusCode: response.statusCode, body };
}

/** The `data` member of a LetzBill envelope, or undefined. */
export function dataOf(body: unknown): unknown {
	return body !== null && typeof body === 'object' && !Array.isArray(body)
		? (body as IDataObject).data
		: undefined;
}
