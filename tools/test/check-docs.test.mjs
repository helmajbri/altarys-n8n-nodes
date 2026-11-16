// Every documentation check in tools/check-docs.mjs must be able to fail: each case breaks one
// rule in otherwise clean input and expects that finding. The repository's own pages, examples
// and word list are checked too, where no build is needed.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	checkExampleWorkflow,
	checkLinks,
	checkReference,
	checkTroubleshooting,
	findJargon,
	headingSlugs,
	messagePattern,
	parseAllowList,
	parseTermList,
	stringLiterals,
	userMessages,
	userText,
} from '../check-docs.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const SOURCE = [
	"import { NodeOperationError } from 'n8n-workflow';",
	"// throw new Error('a comment, not a message')",
	'const PATTERN = /^[a-z]+\'"$/i;',
	"export class Stopped extends Error { constructor(m: string, readonly reason: 'failed' | 'timeout') { super(m); } }",
	'export function refuse(status: number) {',
	"\treturn { kind: 'missing', message: 'Sample found no record with that ID', description: 'Check the ID.' };",
	'}',
	'export function other(status: number) {',
	'\treturn { message: `Sample answered with status ${status}` };',
	'}',
	'export function check(node: unknown, name: string, i: number) {',
	'\tif (!PATTERN.test(name)) {',
	'\t\tthrow new NodeOperationError(',
	'\t\t\tnode,',
	"\t\t\t`'${name}' must be a Sample ID [Item ${i}]`,",
	"\t\t\t{ description: 'e.g. abc' },",
	'\t\t);',
	'\t}',
	'\tconst half = (i + 1) / 2;',
	"\tif (half > 3) throw new Error('The Sample URL must start with https://');",
	"\treturn { ok: false, reason: 'signature_mismatch' };",
	'}',
	'',
].join('\n');

test('string literals: comments and regular expressions are skipped', () => {
	const values = stringLiterals(SOURCE).map((l) => l.value);
	assert.ok(!values.includes('a comment, not a message'));
	assert.ok(values.includes('Sample found no record with that ID'));
	assert.ok(values.every((v) => !v.includes('^[a-z]')));
});

test('user messages: thrown, returned as message or reason, with values as placeholders', () => {
	const texts = userMessages(SOURCE).map((m) => m.text);
	assert.deepEqual(texts.sort(), [
		"'\u0000' must be a Sample ID",
		'Sample answered with status \u0000',
		'Sample found no record with that ID',
		'The Sample URL must start with https://',
		'signature_mismatch',
	]);
	// A type union member after "reason:" is not a message.
	assert.ok(!texts.includes('failed'));
});

test('troubleshooting: every message needs an entry, values written as placeholders', () => {
	const page = [
		'# Troubleshooting',
		'`Sample found no record with that ID`',
		'`Sample answered with status <status>`',
		"`'<parameter>' must be a Sample ID`",
		'`The Sample URL must start with https://`',
		'`signature_mismatch`',
	].join('\n');
	assert.deepEqual(checkTroubleshooting([{ file: 'x.ts', source: SOURCE }], page), []);
	const missing = checkTroubleshooting([{ file: 'x.ts', source: SOURCE }], page.replace('`signature_mismatch`', ''));
	assert.equal(missing.length, 1);
	assert.match(missing[0], /x\.ts:21: 'signature_mismatch' has no entry/);
	assert.ok(messagePattern('Sample answered with status \u0000').test('Sample answered with status <code>'));
	assert.ok(!messagePattern('Sample answered with status \u0000').test('Sample answered with status'));
});

const DESCRIPTION = {
	displayName: 'Sample',
	description: 'Manage samples',
	properties: [
		{ name: 'resource', type: 'options', options: [{ name: 'Thing', value: 'thing' }], default: 'thing' },
		{
			name: 'operation',
			type: 'options',
			displayOptions: { show: { resource: ['thing'] } },
			options: [
				{ name: 'Get', value: 'get', action: 'Get thing', description: 'Get a thing' },
				{ name: 'Delete', value: 'delete', action: 'Delete thing', description: 'Delete a thing' },
			],
			default: 'get',
		},
	],
};
const TRIGGER = {
	displayName: 'Sample Trigger',
	group: ['trigger'],
	properties: [{ displayName: 'Events', name: 'events', type: 'multiOptions', options: [], default: [] }],
};

test('reference: every operation, trigger parameter and event must be documented', () => {
	const operationsPage = '## Thing\n\n### Get thing\n\n### Delete thing\n';
	const triggerPage = '| Events | Options |\n| `thing.created` | A thing was created. |\n';
	const catalogue = { events: [{ type: 'thing.created', description: 'A thing was created.' }] };
	const input = { action: { description: DESCRIPTION }, trigger: { description: TRIGGER }, catalogue, operationsPage, triggerPage };
	assert.deepEqual(checkReference(input), []);
	assert.match(checkReference({ ...input, operationsPage: '## Thing\n\n### Get thing\n' }).join('\n'), /Thing > Delete/);
	assert.match(checkReference({ ...input, triggerPage: '| Events | Options |\n' }).join('\n'), /thing\.created/);
	assert.match(checkReference({ ...input, triggerPage: '| `thing.created` | x |\n' }).join('\n'), /parameter 'Events'/);
	assert.match(checkReference({ ...input, catalogue: {} }).join('\n'), /lists no events/);
});

test('jargon: listed terms are found in any case, and allowed spellings are not', () => {
	const terms = parseTermList('# comment\nL3 -> customer\ntenant -> organization\nappliance\nre:\\bos\\d\\b\n');
	assert.equal(terms.length, 4);
	const hits = findJargon('An L3 user\nthe Tenant ID\nthe appliance URL\nrun it on os3', terms);
	assert.deepEqual(hits.map((h) => h.term), ['L3', 'tenant', 'appliance', 're:\\bos\\d\\b']);
	assert.equal(hits[0].instead, 'customer');
	// Whole words only: longer words and camelCase names do not match.
	assert.deepEqual(findJargon('l3CustomerId, labels, tenants', terms), []);
	// Words joined by underscores are separate words, so a field name is caught.
	assert.deepEqual(findJargon('`l3_customer_id`', terms).map((h) => h.term), ['L3']);
	assert.deepEqual(findJargon('`tenant_id`', terms).map((h) => h.term), ['tenant']);
	// An allowed spelling is removed first.
	assert.deepEqual(findJargon('the appliance', terms, ['appliance']), []);
	assert.deepEqual(parseAllowList('# c\nbff_sa_  # shown on the key page\n'), ['bff_sa_']);
});

test('jargon: node texts are read from labels, descriptions, messages and sentences', () => {
	const source = [
		"const p = { displayName: 'Appliance', name: 'l3CustomerId', url: '/api/v1/l3/x' };",
		"const q = 'a sentence about a tenant';",
		"const r = '={{ $credentials.applianceCheck }}';",
	].join('\n');
	const texts = userText(source).map((l) => l.value);
	assert.deepEqual(texts, ['Appliance', 'l3CustomerId', 'a sentence about a tenant']);
});

test('the reviewed word list covers the standard and the real pages pass it', () => {
	const terms = parseTermList(read('docs-lint/jargon.txt'));
	const allow = parseAllowList(read('docs-lint/jargon-allow.txt'));
	for (const word of ['L1', 'L2', 'L3', 'BFF', 'appliance', 'Kong', 'Keycloak', 'DBOS', 'Celery', 'outbox', 'ADR', 'wave', 'persona', 'tenant', 'scope map']) {
		assert.ok(findJargon(`a ${word} here`, terms).length > 0, word);
	}
	assert.ok(findJargon('see T25', terms).length > 0);
	assert.ok(findJargon('`bff_sa_x`', terms).length > 0, 'the key prefix is caught without the allow list');
	assert.deepEqual(findJargon('it starts with `bff_sa_`', terms, allow), [], 'the allowed key prefix');
	assert.ok(findJargon('`cloudstack_nic_id`', terms).length > 0);
	assert.ok(findJargon('see SPEC-AUT-001', terms).length > 0);
	for (const page of ['README.md', 'SECURITY.md']) assert.deepEqual(findJargon(read(page), terms, allow), [], page);
});

test('links: a missing file or heading fails, a good one passes, external links are listed', () => {
	const dir = mkdtempSync(join(tmpdir(), 'n8n-docs-'));
	mkdirSync(join(dir, 'docs'));
	writeFileSync(join(dir, 'docs', 'a.md'), '# Page A\n\n## Set up the credential\n');
	writeFileSync(
		join(dir, 'README.md'),
		[
			'# Readme',
			'[ok](docs/a.md) [anchor](docs/a.md#set-up-the-credential) [self](#readme)',
			'[web](https://example.com/x) `[not a link](nowhere.md)`',
		].join('\n'),
	);
	const good = checkLinks([join(dir, 'README.md')], dir);
	assert.deepEqual(good.problems, []);
	assert.deepEqual(good.external, ['https://example.com/x']);
	writeFileSync(join(dir, 'README.md'), '# Readme\n[gone](docs/b.md) [bad](docs/a.md#nothing) [up](../x.md)\n');
	const bad = checkLinks([join(dir, 'README.md')], dir).problems.join('\n');
	assert.match(bad, /docs\/b\.md' does not exist/);
	assert.match(bad, /names a heading that does not exist/);
	assert.match(bad, /points outside the repository/);
	assert.ok(headingSlugs('## Same\n## Same\n').has('same-1'));
});

const PKG = '@example/n8n-nodes-sample';
const cleanWorkflow = () => ({
	name: 'Sample workflow',
	nodes: [
		{ id: '1b0c4a2e-0001-4000-8000-000000000001', name: 'Overview', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, 0], parameters: { content: 'Read https://docs.n8n.io/ and https://cloud.example.com' } },
		{ id: '1b0c4a2e-0001-4000-8000-000000000002', name: 'Settings', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [0, 0], parameters: {} },
		{ id: '1b0c4a2e-0001-4000-8000-000000000003', name: 'Get thing', type: `${PKG}.sample`, typeVersion: 1, position: [0, 0], onError: 'continueErrorOutput', parameters: { thingId: '={{ $json.thingId }}' } },
	],
	connections: { Settings: { main: [[{ node: 'Get thing', type: 'main', index: 0 }]] } },
	settings: { executionOrder: 'v1' },
});

test('example workflows: clean passes; credentials, IDs, URLs, secrets and pinned data fail', () => {
	const options = { packageName: PKG, allowedUrlPrefixes: ['https://docs.n8n.io/'] };
	assert.deepEqual(checkExampleWorkflow(cleanWorkflow(), options), []);
	const cases = [
		[(w) => { w.nodes[2].credentials = { sampleApi: { id: '12', name: 'Sample' } }; }, /carries credentials/],
		[(w) => { w.nodes[2].webhookId = 'abc'; }, /webhook ID/],
		[(w) => { w.pinData = {}; }, /pinned data/],
		[(w) => { w.nodes[2].parameters.thingId = '3f2b8c1e-5d4a-4f6b-9c2d-1a2b3c4d5e6f'; }, /holds an ID/],
		[(w) => { w.nodes[2].parameters.url = 'https://n8n.mycompany.net/webhook/abc'; }, /holds the URL/],
		[(w) => { w.nodes[2].parameters.key = 'fb_live_abcdef123456'; }, /API key or signing secret/],
		[(w) => { w.nodes[2].parameters.password = 'hunter2'; }, /holds a secret/],
		[(w) => { w.nodes[2].parameters.blob = 'QWxhZGRpbjpvcGVuIHNlc2FtZQ9xYWxhZGRpbjpvcGVuIHNlc2FtZQ'; }, /long encoded value/],
		[(w) => { w.nodes[2].type = 'n8n-nodes-other.thing'; }, /neither a node/],
		[(w) => { w.nodes.splice(0, 1); }, /no sticky note/],
		[(w) => { delete w.nodes[2].onError; }, /handles no failure/],
		[(w) => { w.connections.Settings.main[0][0].node = 'Missing'; }, /ends at 'Missing'/],
	];
	for (const [edit, expected] of cases) {
		const w = cleanWorkflow();
		edit(w);
		assert.match(checkExampleWorkflow(w, options).join('\n'), expected, String(expected));
	}
});

test('the committed example workflows pass the example checks', () => {
	for (const pkgDir of ['packages/letzbill', 'packages/letzcloud']) {
		const pkg = JSON.parse(read(`${pkgDir}/package.json`));
		const repoUrl = pkg.repository.url.replace(/\.git$/, '');
		const files = readdirSync(join(repoRoot, pkgDir, 'examples')).filter((f) => f.endsWith('.json'));
		assert.ok(files.length >= 3, pkgDir);
		for (const f of files) {
			const workflow = JSON.parse(read(`${pkgDir}/examples/${f}`));
			assert.deepEqual(
				checkExampleWorkflow(workflow, { packageName: pkg.name, allowedUrlPrefixes: [repoUrl, 'https://docs.n8n.io/'] }),
				[],
				f,
			);
		}
	}
});
