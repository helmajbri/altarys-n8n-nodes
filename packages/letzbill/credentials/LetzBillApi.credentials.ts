import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	INodeProperties,
} from 'n8n-workflow';

export class LetzBillApi implements ICredentialType {
	name = 'letzBillApi';

	displayName = 'LetzBill API';

	icon: Icon = { light: 'file:../icons/letzbill.svg', dark: 'file:../icons/letzbill.dark.svg' };

	documentationUrl = 'https://github.com/helmajbri/altarys-n8n-nodes/blob/main/packages/letzbill/docs/credentials.md';

	properties: INodeProperties[] = [
		{
			displayName: 'API URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'e.g. https://billing.example.com',
			description:
				'Address of the LetzBill API, without the /api/v1 path. It must use HTTPS: the nodes refuse plain HTTP because the API key would cross the network unencrypted.',
			required: true,
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'A LetzBill API key; it starts with fb_. n8n sends it only to an HTTPS API URL.',
			required: true,
		},
		{
			// Never set. An empty expirable field makes n8n run preAuthentication before every
			// request it authenticates with this credential, the credential test included. n8n
			// fills a missing value with this default before it reads it.
			displayName: 'HTTPS Check',
			name: 'httpsCheck',
			type: 'hidden',
			typeOptions: { expirable: true },
			default: '',
		},
	];

	// Runs before the key is added to a request: an http:// API URL stops here, before anything
	// is sent, so neither the credential test nor a node sends the key unencrypted.
	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		if (!/^https:\/\//i.test(String(credentials.baseUrl ?? '').trim())) {
			throw new Error(
				"The LetzBill API URL must start with 'https://'. The API key was not sent: over plain 'http://' it could be read and reused. Use the 'https://' address of the LetzBill API.",
			);
		}
		return {};
	}

	// The key is added only while 'httpsCheck' is empty, which is exactly when n8n runs
	// preAuthentication above. A value set in the stored credential (it is never shown in the
	// form) would skip that check, so it also withholds the key: the request goes out without it.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{ $credentials.httpsCheck === "" ? "Bearer " + $credentials.apiKey : "" }}',
			},
		},
	};

	// Reads the webhook event catalogue: read-only and the same for every organization. It needs
	// the webhook:read permission; a key without it fails this test but can still be saved.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/v1/webhooks/event_types',
			method: 'GET',
		},
	};
}
