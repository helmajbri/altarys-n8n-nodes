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

	documentationUrl = 'https://github.com/helmajbri/altarys-n8n-nodes/tree/main/packages/letzbill#credentials';

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
			description: 'A LetzBill API key; it starts with fb_',
			required: true,
		},
		{
			// Never set. An empty expirable field makes n8n run preAuthentication before every
			// request it authenticates with this credential, the credential test included.
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

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
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
