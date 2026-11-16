import type { IDataObject } from 'n8n-workflow';

/** How a LetzBill refusal reads in n8n: what happened, and what to do about it. */
export interface Refusal {
	kind: 'plan' | 'quota' | 'permission' | 'lifecycle' | 'input' | 'missing' | 'conflict' | 'other';
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

/** FastAPI puts structured refusals under `detail`; some LetzBill middleware answers at the top. */
function detailOf(body: unknown): { record?: IDataObject; message: string; list?: unknown[] } {
	const top = asRecord(body);
	const detail = top?.detail;
	if (Array.isArray(detail)) return { message: '', list: detail };
	const record = asRecord(detail) ?? top;
	const message = text(detail) || text(record?.message) || text(top?.message);
	return { record, message };
}

function validationLines(list: unknown[]): string {
	return list
		.map((entry) => {
			const e = asRecord(entry);
			if (!e) return '';
			const loc = Array.isArray(e.loc) ? e.loc.filter((x) => x !== 'body').join('.') : '';
			return loc ? `'${loc}': ${text(e.msg)}` : text(e.msg);
		})
		.filter(Boolean)
		.join('; ');
}

export function describeLetzBillRefusal(status: number, body: unknown): Refusal {
	const { record, message, list } = detailOf(body);
	const type = text(record?.type);
	const code = text(record?.code);

	if (type === 'feature' || code === 'FEATURE_NOT_AVAILABLE') {
		const feature = text(record?.feature_code);
		const plan = text(record?.current_plan);
		const upgrade = text(record?.upgrade_url);
		return {
			kind: 'plan',
			message: 'Your LetzBill plan does not include this feature',
			description:
				`${message || 'The plan refused the request.'}` +
				(feature ? ` Feature: '${feature}'.` : '') +
				(plan ? ` Current plan: '${plan}'.` : '') +
				` Upgrade the plan in LetzBill${upgrade ? ` (${upgrade})` : ''}, or ask the account owner to.`,
		};
	}
	if (code === 'QUOTA_EXCEEDED' || status === 402) {
		const upgrade = text(record?.upgrade_url);
		return {
			kind: 'quota',
			message: 'Your LetzBill plan limit is reached',
			description:
				`${message || 'The plan allows no more of this.'}` +
				` Remove unused items or upgrade the plan in LetzBill${upgrade ? ` (${upgrade})` : ''}.`,
		};
	}
	if (type === 'role' || (status === 403 && text(record?.required_permission))) {
		const permission = text(record?.required_permission);
		return {
			kind: 'permission',
			message: 'The LetzBill API key may not do this',
			description: permission
				? `Give the key the '${permission}' permission in LetzBill, or use a key that has it.`
				: `${message || 'The key lacks the permission this operation needs.'} Check the permissions of the key in LetzBill.`,
		};
	}
	if (type === 'lifecycle') {
		return {
			kind: 'lifecycle',
			message: 'The LetzBill organization is restricted',
			description: `${message || 'The organization cannot use this operation in its current state.'} Contact the LetzBill account owner.`,
		};
	}
	if (status === 401) {
		return {
			kind: 'permission',
			message: 'LetzBill did not accept the API key',
			description: 'Check the API key and the API URL in the LetzBill credential.',
		};
	}
	if (status === 404) {
		return {
			kind: 'missing',
			message: 'LetzBill found no record with that ID',
			description: message || 'Check the ID, and that the API key belongs to the organization that owns the record.',
		};
	}
	if (status === 409) {
		return {
			kind: 'conflict',
			message: 'LetzBill refused the request in the current state of the record',
			description: message || 'Read the record again and retry once its state allows the operation.',
		};
	}
	if (status === 400 || status === 422) {
		const lines = list ? validationLines(list) : '';
		const errors = asRecord(record?.errors);
		const fields = errors ? Object.keys(errors).map((f) => `'${f}'`).join(', ') : '';
		return {
			kind: 'input',
			message: 'LetzBill rejected the input',
			description:
				lines ||
				[message, fields ? `Check: ${fields}.` : ''].filter(Boolean).join(' ') ||
				'Check the values sent to LetzBill.',
		};
	}
	return {
		kind: 'other',
		message: `LetzBill answered with status ${status}`,
		description: message || 'Retry later; if it persists, contact LetzBill support.',
	};
}
