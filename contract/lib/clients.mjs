// Clients the suite uses: n8n's public API, the products' public webhook endpoint routes (read
// with the same scoped keys the triggers use), and the delivery driver of the fake servers.
import { setTimeout as sleep } from 'node:timers/promises';

async function call(method, url, { headers = {}, body } = {}) {
	const response = await fetch(url, {
		method,
		headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const text = await response.text();
	let json;
	try {
		json = text === '' ? undefined : JSON.parse(text);
	} catch {
		json = undefined;
	}
	return { status: response.status, text, json };
}

function expectStatus(answer, allowed, what) {
	if (!allowed.includes(answer.status)) {
		throw new Error(`${what}: HTTP ${answer.status} ${answer.text.slice(0, 500)}`);
	}
	return answer;
}

/** n8n public API at /api/v1 with an X-N8N-API-KEY key. */
export function n8nClient({ url, apiKey }) {
	const api = (method, path, body) => call(method, `${url}/api/v1${path}`, { headers: { 'X-N8N-API-KEY': apiKey }, body });
	return {
		async createCredential(name, type, data) {
			return expectStatus(await api('POST', '/credentials', { name, type, data }), [200, 201], `create credential ${type}`).json;
		},
		async deleteCredential(id) {
			return expectStatus(await api('DELETE', `/credentials/${id}`), [200, 204, 404], `delete credential ${id}`);
		},
		async createWorkflow(workflow) {
			return expectStatus(await api('POST', '/workflows', workflow), [200, 201], 'create workflow').json;
		},
		async publish(id) {
			return expectStatus(await api('POST', `/workflows/${id}/publish`, {}), [200], `publish workflow ${id}`).json;
		},
		async unpublish(id) {
			return expectStatus(await api('POST', `/workflows/${id}/unpublish`), [200], `unpublish workflow ${id}`).json;
		},
		/** Archives, then deletes. Archived alone is inert; a refused delete is reported, not hidden. */
		async removeWorkflow(id) {
			expectStatus(await api('POST', `/workflows/${id}/archive`), [200, 404], `archive workflow ${id}`);
			const answer = await api('DELETE', `/workflows/${id}`);
			return answer.status < 300 || answer.status === 404 ? 'deleted' : `archived; delete answered HTTP ${answer.status}`;
		},
		async executions(workflowId) {
			const answer = expectStatus(
				await api('GET', `/executions?workflowId=${encodeURIComponent(workflowId)}&includeData=true&limit=100`),
				[200],
				`list executions of ${workflowId}`,
			);
			return answer.json?.data ?? [];
		},
	};
}

/**
 * Lists the endpoints a target's key sees whose URL holds `/<webhookId>/`, through the product's
 * own list route. Works the same against the fake servers and the real products.
 */
export async function listEndpoints(target, webhookId) {
	const auth = { authorization: `Bearer ${target.key}` };
	const marker = `/${webhookId}/`;
	if (target.name === 'letzbill') {
		const answer = expectStatus(
			await call('GET', `${target.url}/api/v1/webhooks/endpoints?url=${encodeURIComponent(webhookId)}&per_page=500`, { headers: auth }),
			[200],
			'list LetzBill endpoints',
		);
		const items = answer.json?.data?.items ?? [];
		return items.filter((e) => String(e.webhook_url ?? e.url).includes(marker));
	}
	const found = [];
	for (let page = 1; page <= 50; page++) {
		const answer = expectStatus(
			await call('GET', `${target.url}${target.webhooksBase}/endpoints?page=${page}&per_page=100`, { headers: auth }),
			[200],
			`list ${target.name} endpoints`,
		);
		const items = answer.json?.items ?? [];
		found.push(...items.filter((e) => String(e.url).includes(marker)));
		if (items.length < 100) return found;
	}
	throw new Error(`more than 5000 endpoints listed for ${target.name}`);
}

/** The fake servers' control listener. */
export function driverClient(url) {
	if (!url) {
		const missing = async () => {
			throw new Error('no delivery driver configured (CONTRACT_DRIVER_URL): deliveries cannot be sent or observed');
		};
		return { configured: false, mark: missing, requestsSince: missing, deliver: missing, state: missing };
	}
	const base = url.replace(/\/+$/, '');
	return {
		configured: true,
		async mark() {
			return expectStatus(await call('POST', `${base}/_control/mark`), [200], 'driver mark').json.seq;
		},
		async requestsSince(seq) {
			return expectStatus(await call('GET', `${base}/_control/requests?since=${seq}`), [200], 'driver requests').json;
		},
		async deliver(request) {
			return expectStatus(await call('POST', `${base}/_control/deliver`, { body: request }), [200], 'driver deliver').json;
		},
		async state() {
			return expectStatus(await call('GET', `${base}/_control/state`), [200], 'driver state').json;
		},
	};
}

/** Polls `probe` until `done(value)` or the timeout; returns the last value either way. */
export async function waitFor(probe, done, { timeoutMs, intervalMs = 500 }) {
	const until = Date.now() + timeoutMs;
	let last = await probe();
	while (!done(last) && Date.now() < until) {
		await sleep(intervalMs);
		last = await probe();
	}
	return last;
}

export { sleep };
