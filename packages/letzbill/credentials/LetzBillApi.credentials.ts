import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
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
	];

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
