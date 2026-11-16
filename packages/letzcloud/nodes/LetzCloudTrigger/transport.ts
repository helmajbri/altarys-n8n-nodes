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

import { describeLetzCloudRefusal, parseResponseBody } from '../LetzCloud/shared/refusal';
import { assertHttpsBaseUrl } from '../LetzCloud/shared/runtime';

export const CREDENTIAL_TYPE = 'letzCloudApi';

/** Where a subscription lives: the provider's own endpoints, or the customer's. */
export type SubscribeAs = 'provider' | 'customer';

export function webhooksBase(subscribeAs: SubscribeAs): string {
	return subscribeAs === 'customer' ? '/api/v1/l3/webhooks' : '/api/v1/webhooks';
}

export interface LetzCloudAnswer {
	statusCode: number;
	body: unknown;
}

/** One authenticated call to the appliance; refusals become readable node errors unless allowed. */
export async function letzCloudRequest(
	this: IHookFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	url: string,
	options: { qs?: IDataObject; body?: IDataObject; allowStatus?: number[] } = {},
): Promise<LetzCloudAnswer> {
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
		const refusal = describeLetzCloudRefusal(response.statusCode, body);
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

export function asRecord(value: unknown): IDataObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as IDataObject) : {};
}
