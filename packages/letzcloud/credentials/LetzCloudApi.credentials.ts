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

/** The appliance's identity descriptor, served without a key. */
export const DISCOVERY_PATH = '/.well-known/letzcloud-appliance';

function isApplianceDescriptor(value: unknown): boolean {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const record = value as IDataObject;
	return (
		typeof record.appliance_public_key === 'string' &&
		record.appliance_public_key.trim() !== '' &&
		typeof record.fingerprint === 'string' &&
		record.fingerprint.trim() !== ''
	);
}

export class LetzCloudApi implements ICredentialType {
	name = 'letzCloudApi';

	displayName = 'LetzCloud API';

	icon: Icon = { light: 'file:../icons/letzcloud.svg', dark: 'file:../icons/letzcloud.dark.svg' };

	documentationUrl = 'https://github.com/helmajbri/altarys-n8n-nodes/tree/main/packages/letzcloud#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Appliance URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'e.g. https://cloud.example.com',
			description:
				"Address of your LetzCloud appliance, without the /api/v1 path. Each appliance has its own address; ask your cloud provider. It must use HTTPS: the key is never sent over plain HTTP.",
			required: true,
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'A LetzCloud service-account key; it starts with bff_sa_. A provider key manages the whole organization; a customer key only what belongs to that customer.',
			required: true,
		},
		{
			// Never set. An empty expirable field makes n8n run preAuthentication before every
			// request it authenticates with this credential, the credential test included.
			displayName: 'Appliance Check',
			name: 'applianceCheck',
			type: 'hidden',
			typeOptions: { expirable: true },
			default: '',
		},
	];

	// Runs before the key is added to a request. It refuses a URL that is not HTTPS, then reads
	// the appliance's discovery route, which needs no key: only an address that answers as a
	// LetzCloud appliance is sent the key. The credential test runs it before its request too.
	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		const baseUrl = String(credentials.baseUrl ?? '')
			.trim()
			.replace(/\/+$/, '');
		if (!/^https:\/\/[^/]/i.test(baseUrl)) {
			throw new Error(
				"The LetzCloud appliance URL must start with 'https://'. The API key was not sent: over plain 'http://' it could be read and reused.",
			);
		}
		let descriptor: unknown;
		try {
			descriptor = await this.helpers.httpRequest({
				method: 'GET',
				url: `${baseUrl}${DISCOVERY_PATH}`,
				headers: { Accept: 'application/json' },
				json: true,
			});
		} catch {
			throw new Error(
				`No LetzCloud appliance answered at ${baseUrl}. Check the appliance URL: it is the address of your cloud console (for example https://cloud.example.com). The API key was not sent.`,
			);
		}
		if (!isApplianceDescriptor(descriptor)) {
			throw new Error(
				`${baseUrl} answered, but not as a LetzCloud appliance. Check the appliance URL. The API key was not sent.`,
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

	// After the discovery check above, one read-only call with the key: the first instance of
	// the organization or customer. It needs the vm:read permission, which provider and customer
	// keys can both hold; a key without it fails this test but can still be saved.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/v1/vms',
			method: 'GET',
			qs: { page: 1, page_size: 1 },
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'The appliance did not accept the API key. Check that it is a LetzCloud service-account key (it starts with bff_sa_) and that it has not been revoked.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message:
						"The appliance accepted the API key, but the key may not list instances (the 'vm:read' permission). It can still be used for the operations it has permissions for.",
				},
			},
		],
	};
}
