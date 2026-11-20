// Everything the suite talks to comes from the environment, so the same tests run against the
// throwaway stack (run-docker.sh) or against a real n8n, LetzBill and LetzCloud. A setting that
// is missing is reported as not configured; nothing falls back to a built-in value.
import { readFileSync } from 'node:fs';

export const ALL_TARGETS = ['letzbill', 'letzcloud-provider', 'letzcloud-customer'];

function value(name, { optional = false } = {}) {
	const direct = process.env[name];
	const file = process.env[`${name}_FILE`];
	if (direct !== undefined && direct !== '') return direct;
	if (file !== undefined && file !== '') return readFileSync(file, 'utf8').trim();
	if (optional) return undefined;
	throw new Error(`contract suite not configured: set ${name} (or ${name}_FILE)`);
}

function positiveInt(name) {
	const raw = value(name);
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got ${raw}`);
	return n;
}

export function loadConfig() {
	const targets = value('CONTRACT_TARGETS')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
	for (const t of targets) {
		if (!ALL_TARGETS.includes(t)) throw new Error(`unknown target ${t}; known: ${ALL_TARGETS.join(', ')}`);
	}
	const needsCloud = targets.some((t) => t.startsWith('letzcloud'));
	return {
		runId: value('CONTRACT_RUN_ID'),
		stateFile: value('CONTRACT_STATE_FILE'),
		settleMs: positiveInt('CONTRACT_SETTLE_MS'),
		timeoutMs: positiveInt('CONTRACT_TIMEOUT_MS'),
		// The delivery driver signs and sends deliveries and reports what the server saw. Only the
		// fake servers have one; without it the delivery tests fail rather than skip.
		driverUrl: value('CONTRACT_DRIVER_URL', { optional: true }),
		n8n: { url: value('CONTRACT_N8N_URL').replace(/\/+$/, ''), apiKey: value('CONTRACT_N8N_API_KEY') },
		targets,
		letzbill: targets.includes('letzbill')
			? {
					url: value('CONTRACT_LETZBILL_URL').replace(/\/+$/, ''),
					key: value('CONTRACT_LETZBILL_KEY'),
					eventType: value('CONTRACT_LETZBILL_EVENT_TYPE'),
					triggerType: value('CONTRACT_LETZBILL_TRIGGER_TYPE'),
				}
			: undefined,
		letzcloud: needsCloud
			? {
					url: value('CONTRACT_LETZCLOUD_URL').replace(/\/+$/, ''),
					providerKey: targets.includes('letzcloud-provider') ? value('CONTRACT_LETZCLOUD_PROVIDER_KEY') : undefined,
					customerKey: targets.includes('letzcloud-customer') ? value('CONTRACT_LETZCLOUD_CUSTOMER_KEY') : undefined,
					eventType: value('CONTRACT_LETZCLOUD_EVENT_TYPE'),
					triggerType: value('CONTRACT_LETZCLOUD_TRIGGER_TYPE'),
				}
			: undefined,
	};
}
