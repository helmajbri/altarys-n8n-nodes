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

	documentationUrl = 'https://github.com/helmajbri/altarys-n8n-nodes/blob/main/packages/letzcloud/docs/credentials.md';

	properties: INodeProperties[] = [
		{
			displayName: 'LetzCloud URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'e.g. https://cloud.example.com',
			description:
				'The address you open your LetzCloud console at, without the /api/v1 path. It must use HTTPS: the key is never sent over plain HTTP.',
			required: true,
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'A LetzCloud service-account key; it starts with bff_sa_. A provider key manages the whole organization; a customer key only what belongs to that customer. n8n sends the key only to an HTTPS address that answers as LetzCloud.',
			required: true,
		},
		{
			// Never set. An empty expirable field makes n8n run preAuthentication before every
			// request it authenticates with this credential, the credential test included. n8n
			// fills a missing value with this default before it reads it.
			displayName: 'Address Check',
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
				"The LetzCloud URL must start with 'https://'. The API key was not sent: over plain 'http://' it could be read and reused.",
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
				`No LetzCloud server answered at ${baseUrl}. Check the LetzCloud URL: it is the address of your cloud console (for example https://cloud.example.com). The API key was not sent.`,
			);
		}
		if (!isApplianceDescriptor(descriptor)) {
			throw new Error(
				`${baseUrl} answered, but not as a LetzCloud server. Check the LetzCloud URL. The API key was not sent.`,
			);
		}
		return {};
	}

	// The key is added only while 'applianceCheck' is empty, which is exactly when n8n runs
	// preAuthentication above. A value set in the stored credential (it is never shown in the
	// form) would skip that check, so it also withholds the key: the request goes out without it.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{ $credentials.applianceCheck === "" ? "Bearer " + $credentials.apiKey : "" }}',
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
						'LetzCloud did not accept the API key. Check that it is a LetzCloud service-account key (it starts with bff_sa_) and that it has not been revoked.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message:
						"LetzCloud accepted the API key, but the key may not list instances (the 'vm:read' permission). It can still be used for the operations it has permissions for.",
				},
			},
		],
	};
}
