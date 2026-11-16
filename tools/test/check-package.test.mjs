// Every guard in tools/check-package.mjs must be able to fail: each case breaks one hard limit in
// an otherwise clean package and expects exactly that finding. The real packages must pass.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEFAULT_ESLINT_CONFIG, checkPackage, codeOnly } from '../check-package.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const cleanPackageJson = () => ({
	name: '@example/n8n-nodes-sample',
	version: '0.1.0',
	description: 'Sample',
	license: 'MIT',
	keywords: ['n8n-community-node-package'],
	repository: { type: 'git', url: 'https://github.com/example/sample-nodes.git' },
	files: ['dist'],
	n8n: {
		n8nNodesApiVersion: 1,
		strict: true,
		credentials: ['dist/credentials/SampleApi.credentials.js'],
		nodes: ['dist/nodes/Sample/Sample.node.js'],
	},
	peerDependencies: { 'n8n-workflow': '*' },
});

const cleanNode = [
	"import { NodeConnectionTypes, sleep, type INodeType } from 'n8n-workflow';",
	"import { createHmac } from 'node:crypto';",
	"import { helper } from './helper';",
	'// process.env would be read here in a node that broke N19',
	"const docs = 'https://docs.n8n.io/code/expressions/';",
	'export class Sample implements INodeType { description = { usableAsTool: true } as never; }',
	'void createHmac; void sleep; void helper; void docs; void NodeConnectionTypes;',
	'',
].join('\n');

function makePackage(edit = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'n8n-guard-'));
	const pkg = cleanPackageJson();
	(edit.pkg ?? (() => {}))(pkg);
	mkdirSync(join(dir, 'nodes', 'Sample'), { recursive: true });
	mkdirSync(join(dir, 'credentials'), { recursive: true });
	writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, '\t'));
	writeFileSync(join(dir, 'eslint.config.mjs'), edit.eslint ?? DEFAULT_ESLINT_CONFIG);
	writeFileSync(join(dir, 'nodes', 'Sample', 'Sample.node.ts'), edit.node ?? cleanNode);
	writeFileSync(join(dir, 'nodes', 'Sample', 'helper.ts'), 'export const helper = 1;\n');
	writeFileSync(
		join(dir, 'nodes', 'Sample', 'Sample.node.json'),
		JSON.stringify({ node: `${pkg.name}.sample`, categories: ['Utility'] }),
	);
	writeFileSync(
		join(dir, 'credentials', 'SampleApi.credentials.ts'),
		"export class SampleApi { documentationUrl = 'https://github.com/example/sample-nodes#readme'; }\n",
	);
	return dir;
}

function findings(edit) {
	const dir = makePackage(edit);
	try {
		return checkPackage(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('a clean package passes', () => {
	assert.deepEqual(findings(), []);
});

const breakers = [
	['a runtime dependency (N20)', { pkg: (p) => (p.dependencies = { axios: '1.0.0' }) }, /runtime dependencies/],
	['a pinned n8n-workflow peer (N21)', { pkg: (p) => (p.peerDependencies = { 'n8n-workflow': '2.0.0' }) }, /peerDependencies/],
	['a name without n8n-nodes- (N13)', { pkg: (p) => (p.name = '@example/sample') }, /N13/],
	['a missing keyword (N14)', { pkg: (p) => (p.keywords = []) }, /N14/],
	['a non-MIT licence (N18)', { pkg: (p) => (p.license = 'ISC') }, /N18/],
	['strict mode off (N82)', { pkg: (p) => (p.n8n.strict = false) }, /strict/],
	['a changed eslint config (N82)', { eslint: "import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';\nexport default configWithoutCloudSupport;\n" }, /eslint\.config\.mjs/],
	['a second credential (N16)', { pkg: (p) => p.n8n.credentials.push('dist/credentials/OtherApi.credentials.js') }, /N16/],
	['an import off the allow-list (N22)', { node: `${cleanNode}import axios from 'axios';\n` }, /allow-list/],
	['setTimeout (N23)', { node: `${cleanNode}setTimeout(() => {}, 1);\n` }, /timer global/],
	['process.env (N19)', { node: `${cleanNode}const url = process.env.API_URL;\n` }, /process/],
	['__dirname (N23)', { node: `${cleanNode}const here = __dirname;\n` }, /__dirname/],
	['eval (N24)', { node: `${cleanNode}eval('1');\n` }, /eval/],
	['child_process (N24)', { node: `${cleanNode}const cp = 'x'; void cp; child_process.exec;\n` }, /child_process/],
	['file access (N19)', { node: `${cleanNode}readFileSync;\n` }, /file access/],
	['non-English text (N31)', { node: `${cleanNode}const label = 'Rechnung für';\n` }, /N31/],
	['a foreign host', { node: `${cleanNode}const api = 'https://api.internal.test/v1';\n` }, /not the package repository/],
	['the package scope in code', { node: `${cleanNode}const pkg = '@example/n8n-nodes-sample';\n` }, /package name or scope/],
	['optionalDependencies (N20)', { pkg: (p) => (p.optionalDependencies = { axios: '1.0.0' }) }, /optionalDependencies/],
	['bundleDependencies (N20)', { pkg: (p) => (p.bundleDependencies = true) }, /bundleDependencies/],
	['bundledDependencies (N20)', { pkg: (p) => (p.bundledDependencies = ['axios']) }, /bundledDependencies/],
	['constructor.constructor (N24)', { node: cleanNode + 'const F = ({}).constructor.constructor;\n' }, /constructor/],
	["['constructor'] (N24)", { node: cleanNode + "const F = ({})['constructor']['constructor'];\n" }, /constructor/],
	// Before template and regex literals were understood, the quote inside them opened a "string"
	// that swallowed the code after it, so these three passed the guard.
	['a timer after a template literal holding a quote', { node: cleanNode + "const t = `it's`; setTimeout(f, 1);\n" }, /timer global/],
	['a timer after a regex literal holding a quote', { node: cleanNode + "const r = /'/; setTimeout(f, 1);\n" }, /timer global/],
	['process inside a template expression', { node: cleanNode + 'const t = `${process.env.X}`;\n' }, /process/],
	// The guard used to read a `/` after `++`, `--` or a closing `}` as the start of a regex
	// literal, so the slash pair below swallowed the name between them.
	['process between divisions after ++', { node: cleanNode + 'let n = 1; n++ / 2 + process.env.X.length / 1;\n' }, /process/],
	['process between divisions after --', { node: cleanNode + 'let n = 1; n-- / 2 + process.env.X.length / 1;\n' }, /process/],
	['process between divisions after an object literal', { node: cleanNode + 'const v = { a: 1 } / 2 + process.env.X.length / 1;\n' }, /process/],
	// And a regex after an `if` head or a block was read as a division, so a quote inside it
	// opened a string that hid the code after it.
	['a timer after a regex that follows an if head', { node: cleanNode + "if (docs) /'/.test(docs); setTimeout(f, 1);\n" }, /timer global/],
	['a timer after a regex that follows a block', { node: cleanNode + "function g() {}\n/'/.test(docs); setTimeout(g, 1);\n" }, /timer global/],
	[
		'process after one real regex and one real division',
		{ node: cleanNode + "if (docs) /'/.test(docs); const z = (docs.length) / 2 + process.env.X.length / 1;\n" },
		/process/,
	],
];

for (const [label, edit, expected] of breakers) {
	test(`the guard catches ${label}`, () => {
		const found = findings(edit);
		assert.ok(found.some((f) => expected.test(f)), `expected ${expected} in:\n${found.join('\n')}`);
	});
}

test('comments, strings, template text and regex literals do not trip the code checks', () => {
	assert.doesNotMatch(codeOnly("// process.env\nconst a = 'setTimeout';\n"), /process|setTimeout/);
	assert.doesNotMatch(codeOnly('const m = `process is ${1 + 1} fine`;\n'), /process/);
	assert.doesNotMatch(codeOnly('const r = /process|setTimeout/g;\nif (!/eval\\(/.test(x)) y();\n'), /process|setTimeout|eval/);
	assert.match(codeOnly('const half = total / 2; const r = /x/;\n'), /total \/ 2/);
	assert.match(codeOnly('n++ / 2;\n'), /n\+\+ \/ 2/);
	assert.match(codeOnly('const v = { a: 1 } / 2;\n'), /\} \/ 2/);
	assert.match(codeOnly('if (x) /y/.test(z);\n'), /\/r\/\.test/);
	assert.match(codeOnly('if (x) {}\n/y/.test(z);\n'), /\/r\/\.test/);
	assert.match(codeOnly('if (x) /y/.test(z);\n', { divisionWhenAmbiguous: true }), /\) \/y\//);
});

test('placeholder hosts are any host under example.com, and only that', () => {
	assert.deepEqual(findings({ node: `${cleanNode}const a = 'https://cloud.example.com/api';\n` }), []);
	for (const url of ['https://example.com.evil.test/x', 'https://cloud.example.community/x', 'http://cloud.example.com/x']) {
		const found = findings({ node: `${cleanNode}const a = '${url}';\n` });
		assert.ok(found.some((f) => /placeholder host/.test(f)), url);
	}
});

test('the packages in this repository pass', () => {
	for (const name of ['letzbill', 'letzcloud']) {
		assert.deepEqual(checkPackage(join(repoRoot, 'packages', name)), [], name);
	}
});
