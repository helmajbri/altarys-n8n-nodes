#!/usr/bin/env node
// Hard limits for an n8n community node package, checked on the source before lint and build.
// Each check names the rule it enforces. Usage: node tools/check-package.mjs <packageDir>
//
// n8n-node lint and the post-publish scanner enforce most of these too; this guard runs first,
// needs no install, and covers what they do not read (the eslint config text, URLs, ASCII).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// N22: the import allow-list of no-restricted-imports at n8n@2.47.7.
export const ALLOWED_IMPORTS = new Set([
	'n8n-workflow',
	'ai-node-sdk',
	'lodash',
	'moment',
	'p-limit',
	'luxon',
	'zod',
	'crypto',
	'node:crypto',
	'@n8n/ai-node-sdk',
]);

// N23 restricted globals, N24 dangerous functions, N19 environment and file access.
const FORBIDDEN_CODE = [
	[/\bprocess\b/, 'process (N19, N23)'],
	[/\bglobalThis\b/, 'globalThis (N23)'],
	[/\bglobal\s*\./, 'global (N23)'],
	[/\b(setTimeout|setInterval|setImmediate|clearTimeout|clearInterval|clearImmediate)\b/, 'timer global (N23); use sleep from n8n-workflow'],
	[/\b__dirname\b|\b__filename\b/, '__dirname / __filename (N23)'],
	[/\beval\s*\(/, 'eval (N24)'],
	[/\bnew\s+Function\b|\bFunction\s*\(/, 'Function constructor (N24)'],
	[/child_process/, 'child_process (N24)'],
	[/\brequire\s*\(/, 'require (N22)'],
	[/\bimport\s*\(/, 'dynamic import (N22)'],
	[/\b(readFileSync|writeFileSync|readFile|writeFile|createReadStream|createWriteStream)\b/, 'file access (N19)'],
];

// The default eslint.config.mjs that strict mode compares against (N82).
export const DEFAULT_ESLINT_CONFIG =
	"import { config } from '@n8n/node-cli/eslint';\n\nexport default config;\n";

const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?n8n-nodes-[a-z0-9-._~]+$/;

function walk(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

/** The code of a TypeScript file without its comments and its quoted strings. */
export function codeOnly(source) {
	let out = '';
	let i = 0;
	while (i < source.length) {
		const c = source[i];
		const next = source[i + 1];
		if (c === '/' && next === '/') {
			while (i < source.length && source[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && next === '*') {
			i += 2;
			while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
			i += 2;
			continue;
		}
		if (c === "'" || c === '"') {
			i++;
			while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
			i++;
			out += '""';
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

export function importsOf(source) {
	const found = [];
	for (const m of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) found.push(m[1]);
	for (const m of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) found.push(m[1]);
	return found;
}

export function checkPackage(packageDir) {
	const problems = [];
	const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

	// N20, N21
	if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
		problems.push(`package.json has runtime dependencies (N20): ${Object.keys(pkg.dependencies).join(', ')}`);
	}
	const peers = JSON.stringify(pkg.peerDependencies ?? {});
	if (peers !== JSON.stringify({ 'n8n-workflow': '*' })) {
		problems.push(`peerDependencies must be exactly {"n8n-workflow": "*"} (N21), found ${peers}`);
	}
	// N13, N14, N18
	if (!PACKAGE_NAME.test(pkg.name ?? '')) problems.push(`package name '${pkg.name}' breaks N13`);
	if (!(pkg.keywords ?? []).includes('n8n-community-node-package')) {
		problems.push('keywords lack n8n-community-node-package (N14)');
	}
	if (pkg.license !== 'MIT') problems.push(`license is '${pkg.license}', not MIT (N18)`);
	if (pkg.n8n?.strict !== true) problems.push('"n8n": { "strict": true } is not set (N82)');
	if (JSON.stringify(pkg.files) !== JSON.stringify(['dist'])) problems.push('"files" must be ["dist"]');
	// N82: strict mode fails when the config differs from the default.
	const eslintPath = join(packageDir, 'eslint.config.mjs');
	const normal = (t) => t.replace(/\s+/g, ' ').trim();
	if (!existsSync(eslintPath) || normal(readFileSync(eslintPath, 'utf8')) !== normal(DEFAULT_ESLINT_CONFIG)) {
		problems.push('eslint.config.mjs differs from the n8n-node default (N82)');
	}
	// N16: one service per package -- one credential, and every node uses only it.
	const credentials = pkg.n8n?.credentials ?? [];
	if (credentials.length !== 1) problems.push(`expected one credential (N16), found ${credentials.length}`);
	for (const listed of [...credentials, ...(pkg.n8n?.nodes ?? [])]) {
		const source = listed.replace(/^dist\//, '').replace(/\.js$/, '.ts');
		if (!existsSync(join(packageDir, source))) problems.push(`${listed} has no source ${source}`);
	}

	// The repository base URL: the only owner-bearing URL node files may carry (documentation).
	const repoUrl = String(pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
	const allowedUrlPrefixes = [repoUrl, 'https://docs.n8n.io/', 'https://billing.example.com'];

	const files = [...walk(join(packageDir, 'nodes')), ...walk(join(packageDir, 'credentials'))];
	for (const file of files) {
		const rel = relative(packageDir, file).replace(/\\/g, '/');
		const isCode = rel.endsWith('.ts');
		const isText = isCode || rel.endsWith('.json') || rel.endsWith('.svg');
		if (!isText) {
			problems.push(`${rel}: unexpected file type in a shipped folder`);
			continue;
		}
		const source = readFileSync(file, 'utf8');
		// N31 (proxy): node and credential files are ASCII, so no non-English copy slips in.
		const nonAscii = source.match(/[^\x09\x0a\x0d\x20-\x7e]/);
		if (nonAscii) problems.push(`${rel}: non-ASCII character U+${nonAscii[0].codePointAt(0).toString(16)} (N31)`);
		// No host other than the package's own repository, n8n's docs and the placeholder host.
		for (const m of source.matchAll(/https?:\/\/[^\s'"<>)]+/g)) {
			if (rel.endsWith('.svg') && m[0] === 'http://www.w3.org/2000/svg') continue;
			if (!allowedUrlPrefixes.some((p) => p && m[0].startsWith(p))) {
				problems.push(`${rel}: URL ${m[0]} is not the package repository, n8n docs or the placeholder host`);
			}
		}
		if (rel.endsWith('.node.json')) {
			const codex = JSON.parse(source);
			if (!String(codex.node ?? '').startsWith(`${pkg.name}.`)) {
				problems.push(`${rel}: "node" must be "${pkg.name}.<node name>"`);
			}
		}
		if (!isCode) continue;
		// The package name and scope live in package.json and the codex files only.
		const scope = String(pkg.name).startsWith('@') ? String(pkg.name).split('/')[0] : '';
		if (source.includes(pkg.name) || (scope && source.includes(scope))) {
			problems.push(`${rel}: carries the package name or scope; it belongs in package.json`);
		}
		for (const spec of importsOf(source)) {
			if (spec.startsWith('.')) continue;
			if (!ALLOWED_IMPORTS.has(spec)) problems.push(`${rel}: import '${spec}' is not on the allow-list (N22)`);
		}
		const code = codeOnly(source);
		for (const [pattern, label] of FORBIDDEN_CODE) {
			if (pattern.test(code)) problems.push(`${rel}: uses ${label}`);
		}
	}
	return problems;
}

function main(argv) {
	const packageDir = resolve(argv[2] ?? '.');
	const problems = checkPackage(packageDir);
	if (problems.length) {
		console.error(`The package guard found ${problems.length} issue(s):\n- ${problems.join('\n- ')}`);
		return 1;
	}
	console.log(`${packageDir}: package guard passed`);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv);
}
