// The credential test: the appliance discovery route first, without the key, then one
// authenticated read; a wrong URL and a refused key each read as what they are. Runs against dist/.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LetzCloudApi, DISCOVERY_PATH } = require('../dist/credentials/LetzCloudApi.credentials.js');

const BASE = 'https://cloud.example.com';
const DESCRIPTOR = { appliance_public_key: '-----BEGIN PUBLIC KEY-----\nMCow\n-----END PUBLIC KEY-----\n', bundle_version: '1.4.0', fingerprint: 'sha256:ab12' };

/** n8n's IHttpRequestHelper as preAuthentication sees it: one unauthenticated httpRequest. */
function helper(answer) {
	const sent = [];
	return {
		sent,
		ctx: {
			helpers: {
				httpRequest: async (options) => {
					sent.push(options);
					return answer(options);
				},
			},
		},
	};
}

const credential = new LetzCloudApi();
const preAuthentication = (ctx, credentials) => credential.preAuthentication.call(ctx, credentials);

test('n8n runs the discovery check before every authenticated request, the test included', () => {
	const hidden = credential.properties.find((p) => p.type === 'hidden');
	assert.equal(hidden.typeOptions.expirable, true);
	assert.equal(hidden.default, '');
	assert.equal(typeof credential.preAuthentication, 'function');
});

test('the discovery route is read without the key, and a LetzCloud appliance passes', async () => {
	const { ctx, sent } = helper(() => DESCRIPTOR);
	assert.deepEqual(await preAuthentication(ctx, { baseUrl: `${BASE}/`, apiKey: 'bff_sa_secret' }), {});
	assert.equal(sent.length, 1);
	assert.equal(sent[0].method, 'GET');
	assert.equal(sent[0].url, `${BASE}${DISCOVERY_PATH}`);
	assert.equal(DISCOVERY_PATH, '/.well-known/letzcloud-appliance');
	assert.doesNotMatch(JSON.stringify(sent[0]), /bff_sa_secret/);
	assert.equal(sent[0].headers.Authorization, undefined);
});

test('a wrong URL reads as a wrong URL, and the key is not sent', async () => {
	const cases = [
		['nothing answers', () => Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })), /No LetzCloud appliance answered at https:\/\/cloud\.example\.com/],
		['a 404 from another server', () => Promise.reject(Object.assign(new Error('Request failed with status code 404'), { httpCode: '404' })), /No LetzCloud appliance answered/],
		['another JSON service', () => ({ status: 'ok' }), /answered, but not as a LetzCloud appliance/],
		['an HTML page', () => '<html></html>', /answered, but not as a LetzCloud appliance/],
		['an empty descriptor', () => ({ appliance_public_key: '', fingerprint: '' }), /not as a LetzCloud appliance/],
	];
	for (const [label, answer, expected] of cases) {
		const { ctx } = helper(answer);
		await assert.rejects(preAuthentication(ctx, { baseUrl: BASE, apiKey: 'bff_sa_secret' }), (e) => {
			assert.match(e.message, expected, label);
			assert.match(e.message, /key was not sent/, label);
			assert.doesNotMatch(e.message, /\b(error|problem|failure|mistake)\b/i, label);
			return true;
		});
	}
});

test('an http:// or empty URL is refused before any request', async () => {
	for (const baseUrl of ['http://cloud.example.com', 'cloud.example.com', '', 'https://', ' HTTP://cloud.example.com ']) {
		const { ctx, sent } = helper(() => assert.fail('no request expected'));
		await assert.rejects(preAuthentication(ctx, { baseUrl, apiKey: 'bff_sa_x' }), /'https:\/\/'/, JSON.stringify(baseUrl));
		assert.deepEqual(sent, []);
	}
});

test('then one authenticated read-only call, with a readable message for a refused key', () => {
	assert.equal(credential.test.request.method, 'GET');
	assert.equal(credential.test.request.url, '/api/v1/vms');
	assert.deepEqual(credential.test.request.qs, { page: 1, page_size: 1 });
	const byStatus = Object.fromEntries(credential.test.rules.map((r) => [r.properties.value, r.properties.message]));
	assert.deepEqual(Object.keys(byStatus).sort(), ['401', '403']);
	assert.match(byStatus[401], /did not accept the API key/);
	assert.match(byStatus[401], /bff_sa_/);
	assert.match(byStatus[403], /accepted the API key/);
	assert.match(byStatus[403], /'vm:read'/);
	for (const rule of credential.test.rules) {
		assert.equal(rule.type, 'responseCode');
		assert.doesNotMatch(rule.properties.message, /\b(error|problem|failure|mistake)\b/i);
	}
});

test('the key is a password field sent as a bearer token, and no host is built in', () => {
	assert.equal(
		credential.authenticate.properties.headers.Authorization,
		'={{ $credentials.applianceCheck === "" ? "Bearer " + $credentials.apiKey : "" }}',
	);
	const key = credential.properties.find((p) => p.name === 'apiKey');
	assert.equal(key.typeOptions.password, true);
	const url = credential.properties.find((p) => p.name === 'baseUrl');
	assert.equal(url.default, '');
	assert.equal(url.required, true);
	assert.equal(credential.test.request.baseURL, '={{$credentials.baseUrl}}');
});
