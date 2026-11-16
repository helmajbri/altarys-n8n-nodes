import type { IDataObject } from 'n8n-workflow';

/** How a LetzCloud refusal reads in n8n: what happened, and what to do about it. */
export interface Refusal {
	kind:
		| 'plan'
		| 'quota'
		| 'unavailable'
		| 'permission'
		| 'tier'
		| 'lifecycle'
		| 'verification'
		| 'input'
		| 'missing'
		| 'conflict'
		| 'other';
	message: string;
	description: string;
}

/** The body of a response as data: JSON when it parses, the text otherwise. */
export function parseResponseBody(body: unknown): unknown {
	let text: string | undefined;
	if (Buffer.isBuffer(body)) text = body.toString('utf8');
	else if (typeof body === 'string') text = body;
	if (text === undefined) return body ?? null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

function asRecord(value: unknown): IDataObject | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as IDataObject)
		: undefined;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/**
 * The refusal record. The appliance wraps an HTTP refusal as `{"error": {...}}`; a refusal from a
 * middleware arrives as `{"detail": {...}}`; the authentication middleware answers at the top
 * level, where `error` is a word, not an object.
 */
function refusalOf(body: unknown): { record?: IDataObject; message: string; list?: unknown[] } {
	const top = asRecord(body);
	const error = asRecord(top?.error);
	const detail = top?.detail;
	if (Array.isArray(detail)) return { message: '', list: detail };
	const outer = error ?? asRecord(detail) ?? top;
	// An older handler put the refusal itself under `error.message`.
	const record = asRecord(outer?.message) ?? outer;
	const message = text(record?.message) || text(detail) || text(top?.message) || (typeof body === 'string' ? body : '');
	const list = Array.isArray(record?.validation_errors) ? (record?.validation_errors as unknown[]) : undefined;
	return { record, message, list };
}

function validationLines(list: unknown[]): string {
	return list
		.map((entry) => {
			const e = asRecord(entry);
			if (!e) return '';
			if (typeof e.field === 'string') {
				const field = e.field.replace(/^body\./, '');
				return field ? `'${field}': ${text(e.message)}` : text(e.message);
			}
			const loc = Array.isArray(e.loc) ? e.loc.filter((x) => x !== 'body').join('.') : '';
			return loc ? `'${loc}': ${text(e.msg)}` : text(e.msg);
		})
		.filter(Boolean)
		.join('; ');
}

export function describeLetzCloudRefusal(status: number, body: unknown): Refusal {
	const { record, message, list } = refusalOf(body);
	const type = text(record?.type);
	const code = text(record?.code);

	if (code === 'FEATURE_NOT_AVAILABLE' || (type === 'entitlement' && record?.upgrade_required === true)) {
		const feature = text(record?.feature_code);
		const plan = text(record?.current_plan);
		return {
			kind: 'plan',
			message: 'Your LetzCloud plan does not include this feature',
			description:
				`${message || 'The plan refused the request.'}` +
				(feature ? ` Feature: '${feature}'.` : '') +
				(plan ? ` Current plan: '${plan}'.` : '') +
				' Upgrade the plan with your cloud provider, or ask the account owner to.',
		};
	}
	if (code === 'QUOTA_EXCEEDED') {
		const plan = text(record?.current_plan);
		return {
			kind: 'quota',
			message: 'Your LetzCloud plan limit is reached',
			description:
				`${message || 'The plan allows no more of this.'}` +
				(plan ? ` Current plan: '${plan}'.` : '') +
				' Remove unused resources or upgrade the plan with your cloud provider.',
		};
	}
	if (code === 'ENTITLEMENTS_UNAVAILABLE') {
		return {
			kind: 'unavailable',
			message: 'LetzCloud could not read your plan just now',
			description: 'Nothing was changed. Retry in a few minutes; if it persists, contact your cloud provider.',
		};
	}
	if (code === 'CUSTOMER_KEY_ROUTE_NOT_OFFERED') {
		return {
			kind: 'tier',
			message: 'A customer key cannot use this operation',
			description:
				'Keys issued to a customer can read and manage its instances, read its invoices, usage and wallet, and manage its webhooks. Use a provider key for this operation.',
		};
	}
	if (code === 'L2_ONLY') {
		return {
			kind: 'tier',
			message: 'Only a provider key can use this operation',
			description: message || 'Use a key issued to the provider organization, not to one of its customers.',
		};
	}
	if (code === 'L3_CUSTOMER_UNRESOLVED') {
		return {
			kind: 'tier',
			message: 'Only a customer key can use this operation',
			description:
				'This operation reads or changes what belongs to one customer. Use a key issued to that customer, not a provider key.',
		};
	}
	if (type === 'role' || type === 'authorization') {
		const permission = text(record?.permission);
		return {
			kind: 'permission',
			message: 'The LetzCloud API key may not do this',
			description: permission
				? `Give the key the '${permission}' permission, or use a key that has it.`
				: `${message || 'The key lacks the permission this operation needs.'} Check the permissions of the key.`,
		};
	}
	if (type === 'lifecycle') {
		return {
			kind: 'lifecycle',
			message: 'The LetzCloud account is restricted',
			description: `${message || 'The account cannot use this operation in its current state.'} Contact your cloud provider.`,
		};
	}
	if (type === 'verification') {
		return {
			kind: 'verification',
			message: 'The LetzCloud account must be verified first',
			description: `${message || 'This operation needs a verified account.'} Complete the verification in the LetzCloud console.`,
		};
	}
	if (type === 'provisioning') {
		return {
			kind: 'lifecycle',
			message: 'Billing is not set up for this LetzCloud account yet',
			description: message || 'Ask your cloud provider to finish setting up billing for the account.',
		};
	}
	if (status === 401) {
		return {
			kind: 'permission',
			message: 'LetzCloud did not accept the API key',
			description:
				'Check the API key and the LetzCloud URL in the LetzCloud credential. Only service-account keys, which start with bff_sa_, are accepted.',
		};
	}
	if (status === 403) {
		return {
			kind: 'permission',
			message: 'The LetzCloud API key may not do this',
			description: message || 'Check the permissions of the key.',
		};
	}
	if (status === 404) {
		return {
			kind: 'missing',
			message: 'LetzCloud found no record with that ID',
			description: message || 'Check the ID, and that the API key belongs to the organization or customer that owns it.',
		};
	}
	if (status === 409) {
		return {
			kind: 'conflict',
			message: 'LetzCloud refused the request in the current state',
			description: message || 'Read the record again and retry once its state allows the operation.',
		};
	}
	if (status === 400 || status === 422) {
		const unknown = Array.isArray(record?.unknown_event_types) ? (record?.unknown_event_types as unknown[]) : [];
		if (code === 'unknown_event_type' && unknown.length) {
			return {
				kind: 'input',
				message: 'LetzCloud does not send some of the chosen events',
				description: `Not offered for this key: ${unknown.map((e) => `'${text(e)}'`).join(', ')}. Choose the events again from the list.`,
			};
		}
		const lines = list ? validationLines(list) : '';
		return {
			kind: 'input',
			message: 'LetzCloud rejected the input',
			description: lines || message || 'Check the values sent to LetzCloud.',
		};
	}
	return {
		kind: 'other',
		message: `LetzCloud answered with status ${status}`,
		description: message || 'Retry later; if it persists, contact your cloud provider.',
	};
}
