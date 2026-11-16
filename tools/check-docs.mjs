#!/usr/bin/env node
// Checks the user documentation of a node package. Each check fails the build:
//   1. reference: every resource, operation, trigger parameter and event is in the reference pages;
//   2. troubleshooting: every message the code throws or logs has an entry in docs/troubleshooting.md;
//   3. jargon: no term of docs-lint/jargon.txt in a published file (docs, README, changelog,
//      examples, the package description, and the text of node and credential files);
//   4. links: every relative link and anchor resolves; external links are listed for a manual check;
//   5. examples: each examples/*.json parses, uses only this package's nodes and n8n's own nodes,
//      and carries no credentials, webhook IDs, pinned data, URLs, record IDs or secret-looking values.
//
// Usage:
//   node ../../tools/check-docs.mjs .         in a package folder, after `npm run build`
//   node tools/check-docs.mjs --repo .        the repository's own pages (README.md, SECURITY.md, RELEASING.md)

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectOperations, eventGroups, githubSlug, loadPackage } from './generate-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- string literals of TypeScript

const REGEX_AFTER = /(^|[(,=:[!&|?{};+\-*%<>~^])$|\b(return|typeof|case|in|of|new|delete|void|throw|yield|await|else|do)$/;

/**
 * The string and template literals of a TypeScript file, comments skipped. Each has its value
 * (a template's `${...}` parts become U+0000), its line, and `before`: the code between the
 * previous literal and this one, which tells what the literal is used for; `after` is the first
 * character after it (a `|` there makes it a member of a type union, not a value).
 */
export function stringLiterals(source) {
	const found = [];
	const lineStarts = [0];
	for (let k = 0; k < source.length; k++) if (source[k] === '\n') lineStarts.push(k + 1);
	const lineOf = (index) => {
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineStarts[mid] <= index) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	};
	const nextChar = (from) => source.slice(from, from + 200).match(/^\s*(\S)/)?.[1] ?? '';
	const unescape = (c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '' : c);
	let i = 0;

	function skipRegex() {
		i++;
		let inClass = false;
		while (i < source.length) {
			const c = source[i];
			if (c === '\\') {
				i += 2;
				continue;
			}
			if (c === '\n') break;
			if (c === '[') inClass = true;
			else if (c === ']') inClass = false;
			else if (c === '/' && !inClass) break;
			i++;
		}
		i++;
		while (i < source.length && /[a-z]/i.test(source[i])) i++;
	}

	// Scans code until the end, or until the `}` that closes a `${` when inTemplate.
	function scan(inTemplate) {
		let code = '';
		let mark = 0;
		let depth = 0;
		while (i < source.length) {
			const c = source[i];
			const next = source[i + 1];
			if (inTemplate && c === '}' && depth === 0) {
				i++;
				return;
			}
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
				const start = i;
				i++;
				let value = '';
				while (i < source.length && source[i] !== c) {
					if (source[i] === '\\') {
						value += unescape(source[i + 1]);
						i += 2;
						continue;
					}
					value += source[i];
					i++;
				}
				i++;
				found.push({ value, before: code.slice(mark), line: lineOf(start), after: nextChar(i) });
				code += '""';
				mark = code.length;
				continue;
			}
			if (c === '`') {
				const start = i;
				const before = code.slice(mark);
				i++;
				let value = '';
				while (i < source.length && source[i] !== '`') {
					if (source[i] === '\\') {
						value += unescape(source[i + 1]);
						i += 2;
						continue;
					}
					if (source[i] === '$' && source[i + 1] === '{') {
						i += 2;
						value += '\u0000';
						scan(true);
						continue;
					}
					value += source[i];
					i++;
				}
				i++;
				found.push({ value, before, line: lineOf(start), after: nextChar(i), template: true });
				code += '""';
				mark = code.length;
				continue;
			}
			if (c === '/' && (() => {
				const before = code.trimEnd();
				if (before === '') return true;
				if (before.endsWith('++') || before.endsWith('--')) return false;
				return REGEX_AFTER.test(before);
			})()) {
				skipRegex();
				code += '/r/';
				continue;
			}
			if (c === '{') depth++;
			if (c === '}') depth--;
			code += c;
			i++;
		}
	}

	scan(false);
	return found;
}

// What a literal is used for, read from the code just before it.
const MESSAGE_CONTEXT = [
	/\bmessage\s*:\s*$/,
	/\bnew\s+NodeOperationError\(\s*[\w.$]+(\(\))?\s*,\s*$/,
	/\bnew\s+(Error|WaitStopped)\(\s*$/,
	/\breason\s*:\s*$/,
	/\blogger\.(warn|error|info)\(\s*$/,
];
const USER_TEXT_CONTEXT =
	/\b(displayName|description|placeholder|action|name|message|hint|reason|title|subtitle|webhookResponse)\s*:\s*$/;

/** A message as the reader sees it: U+0000 for each inserted value, without the item suffix. */
export function normalizeMessage(value) {
	return value
		.replace(/\s*\[Item \u0000\]$/, '')
		.replace(/\u0000+/g, '\u0000')
		.trim();
}

/** The messages a source file throws or logs. */
export function userMessages(source) {
	return stringLiterals(source)
		.filter((l) => l.after !== '|' && MESSAGE_CONTEXT.some((re) => re.test(l.before)))
		.map((l) => ({ line: l.line, text: normalizeMessage(l.value) }))
		.filter((m) => /[A-Za-z]{3}/.test(m.text.replace(/\u0000/g, '')));
}

/** The text of a source file a reader can see: labels, descriptions, messages and sentences. */
export function userText(source) {
	return stringLiterals(source).filter((l) => {
		const value = l.value.replace(/\u0000/g, ' ');
		if (value.startsWith('=')) return false;
		return USER_TEXT_CONTEXT.test(l.before) || MESSAGE_CONTEXT.some((re) => re.test(l.before)) || /\S\s+\S/.test(value);
	});
}

/** How a message is written in the docs: each inserted value as a <placeholder>. */
export function messagePattern(text) {
	return new RegExp(`^${text.split('\u0000').map(escapeRe).join('<[^<>]+>')}$`);
}

export const shownMessage = (text) => text.replace(/\u0000/g, '<value>');

// ---------------------------------------------------------------- Markdown helpers

/** Markdown without fenced code blocks (kept as blank lines, so line numbers hold). */
function withoutFences(markdown) {
	let inFence = false;
	return markdown
		.split('\n')
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) {
				inFence = !inFence;
				return '';
			}
			return inFence ? '' : line;
		})
		.join('\n');
}

export function codeSpans(markdown) {
	return [...withoutFences(markdown).matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
}

export function headingSlugs(markdown) {
	const slugs = new Set();
	const counts = new Map();
	for (const line of withoutFences(markdown).split('\n')) {
		const heading = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
		if (heading) {
			const base = githubSlug(heading[1]);
			const n = counts.get(base) ?? 0;
			counts.set(base, n + 1);
			slugs.add(n === 0 ? base : `${base}-${n}`);
		}
		for (const anchor of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) slugs.add(anchor[1]);
	}
	return slugs;
}

export function markdownLinks(markdown) {
	const links = [];
	withoutFences(markdown)
		.split('\n')
		.forEach((raw, index) => {
			const line = raw.replace(/`[^`\n]*`/g, '');
			for (const m of line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
				links.push({ target: m[1], line: index + 1 });
			}
		});
	return links;
}

// ---------------------------------------------------------------- check 1: reference

export function checkReference({ action, trigger, catalogue, operationsPage, triggerPage }) {
	const problems = [];
	const lines = (page) => new Set((page ?? '').split('\n').map((l) => l.trim()));
	if (action) {
		const page = lines(operationsPage);
		for (const resource of collectOperations(action.description)) {
			if (!page.has(`## ${resource.name}`)) problems.push(`docs/operations.md has no section for the resource '${resource.name}'`);
			for (const op of resource.operations) {
				if (!page.has(`### ${op.action}`)) {
					problems.push(`docs/operations.md has no section for '${resource.name} > ${op.name}' ('### ${op.action}')`);
				}
			}
		}
	}
	if (trigger) {
		const text = triggerPage ?? '';
		for (const p of trigger.description.properties ?? []) {
			if (p.type === 'hidden' || p.type === 'notice') continue;
			if (!text.includes(`| ${p.displayName} |`)) problems.push(`docs/trigger.md does not describe the parameter '${p.displayName}'`);
		}
		const spans = new Set(codeSpans(text));
		for (const group of eventGroups(catalogue ?? {})) {
			for (const event of group.events) {
				if (!spans.has(event.type)) problems.push(`docs/trigger.md does not list the event '${event.type}'`);
			}
		}
		if (!eventGroups(catalogue ?? {}).length) problems.push('openapi/event-types.json lists no events');
	}
	return problems;
}

// ---------------------------------------------------------------- check 2: troubleshooting

export function checkTroubleshooting(sources, troubleshootingPage) {
	const problems = [];
	const spans = codeSpans(troubleshootingPage ?? '');
	const seen = new Set();
	for (const { file, source } of sources) {
		for (const message of userMessages(source)) {
			if (seen.has(message.text)) continue;
			seen.add(message.text);
			const pattern = messagePattern(message.text);
			if (!spans.some((span) => pattern.test(span))) {
				problems.push(`${file}:${message.line}: '${shownMessage(message.text)}' has no entry in docs/troubleshooting.md`);
			}
		}
	}
	return problems;
}

// ---------------------------------------------------------------- check 3: jargon

/**
 * The reviewed word list: one term per line, '#' starts a comment, 'term -> use instead' names
 * the replacement. A term is matched as a whole word, any case; 're:' starts a regular expression.
 */
export function parseTermList(text) {
	const terms = [];
	for (const raw of text.split('\n')) {
		const line = raw.replace(/\s+#.*$/, '').trim();
		if (!line || line.startsWith('#')) continue;
		const [term, instead] = line.split(/\s+->\s+/);
		const re = term.startsWith('re:')
			? new RegExp(term.slice(3), 'iu')
			: new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(term).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}_])`, 'iu');
		terms.push({ term, instead: instead?.trim() ?? '', re });
	}
	return terms;
}

/** Exact spellings the product shows its readers, removed before the word list is applied. */
export function parseAllowList(text) {
	return text
		.split('\n')
		.map((raw) => raw.replace(/\s+#.*$/, '').trim())
		.filter((line) => line && !line.startsWith('#'));
}

export function findJargon(text, terms, allow = []) {
	const hits = [];
	text.split('\n').forEach((raw, index) => {
		let line = raw;
		for (const token of allow) line = line.split(token).join(' ');
		// Words joined by underscores, as in field names, are read as separate words.
		line = line.replace(/_/g, ' ');
		for (const t of terms) {
			const m = line.match(t.re);
			if (m) hits.push({ line: index + 1, term: t.term, found: m[0], instead: t.instead });
		}
	});
	return hits;
}

function jargonProblems(file, text, terms, allow, lineOffset = () => 0) {
	return findJargon(text, terms, allow).map(
		(h) => `${file}:${h.line + lineOffset(h)}: '${h.found}' is on the no-jargon list${h.instead ? ` (use: ${h.instead})` : ''}`,
	);
}

// ---------------------------------------------------------------- check 4: links

export function checkLinks(files, root) {
	const problems = [];
	const external = new Set();
	const slugCache = new Map();
	const slugsOf = (path) => {
		if (!slugCache.has(path)) slugCache.set(path, headingSlugs(readFileSync(path, 'utf8')));
		return slugCache.get(path);
	};
	for (const file of files) {
		const text = readFileSync(file, 'utf8');
		const rel = relative(root, file).split(sep).join('/');
		for (const { target, line } of markdownLinks(text)) {
			if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
				if (/^https?:/i.test(target)) external.add(target);
				continue;
			}
			const [pathPart, anchor] = target.split('#');
			const resolved = pathPart ? resolve(dirname(file), decodeURIComponent(pathPart)) : file;
			if (relative(root, resolved).startsWith('..')) {
				problems.push(`${rel}:${line}: '${target}' points outside the repository`);
				continue;
			}
			if (!existsSync(resolved)) {
				problems.push(`${rel}:${line}: '${target}' does not exist`);
				continue;
			}
			if (anchor && resolved.endsWith('.md') && !slugsOf(resolved).has(anchor)) {
				problems.push(`${rel}:${line}: '${target}' names a heading that does not exist`);
			}
		}
	}
	return { problems, external: [...external].sort() };
}

// ---------------------------------------------------------------- check 5: example workflows

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>)\]]+/gi;
// RFC 2606 documentation hosts.
const PLACEHOLDER_HOST = /^https?:\/\/([a-z0-9-]+\.)*example\.(com|org|net)(\/|$)/i;
const SECRET_PATTERNS = [
	[/\b(fb|bff_sa|sk_live|sk_test|whsec)_[A-Za-z0-9_]{6,}/, 'an API key or signing secret'],
	[/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
	[/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/, 'a bearer token'],
	[/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, 'a JSON web token'],
	[/\b[A-Fa-f0-9]{32,}\b/, 'a long hexadecimal value'],
];
const SECRET_KEYS = /^(password|secret|token|apiKey|api_key|accessToken|clientSecret|signingSecret)$/i;

function looksLikeBase64Secret(text) {
	for (const m of text.matchAll(/[A-Za-z0-9+/]{40,}={0,2}/g)) {
		if (/[A-Z]/.test(m[0]) && /[a-z]/.test(m[0]) && /\d/.test(m[0])) return true;
	}
	return false;
}

export function checkExampleWorkflow(workflow, { packageName, allowedUrlPrefixes = [] }) {
	const problems = [];
	if (!workflow || typeof workflow !== 'object' || !Array.isArray(workflow.nodes)) {
		return ['is not an n8n workflow: it has no "nodes" list'];
	}
	if (typeof workflow.name !== 'string' || !workflow.name.trim()) problems.push('has no workflow name');
	if ('pinData' in workflow) problems.push('carries pinned data ("pinData")');
	const names = new Set();
	for (const node of workflow.nodes) {
		const label = `node '${node?.name}'`;
		if (names.has(node?.name)) problems.push(`${label} is listed twice`);
		names.add(node?.name);
		const type = String(node?.type ?? '');
		if (!type.startsWith(`${packageName}.`) && !type.startsWith('n8n-nodes-base.')) {
			problems.push(`${label} uses '${type}', which is neither a node of ${packageName} nor an n8n core node`);
		}
		if (node && 'credentials' in node) problems.push(`${label} carries credentials; leave them out so n8n asks for one`);
		if (node && 'webhookId' in node) problems.push(`${label} carries a webhook ID`);
	}
	const types = workflow.nodes.map((n) => String(n?.type ?? ''));
	if (!types.includes('n8n-nodes-base.stickyNote')) problems.push('has no sticky note explaining the workflow');
	if (!types.includes('n8n-nodes-base.set')) problems.push('has no Edit Fields (Set) node holding the values to change');
	if (!types.some((t) => t.startsWith(`${packageName}.`))) problems.push(`uses no node of ${packageName}`);
	if (!workflow.nodes.some((n) => n?.onError === 'continueErrorOutput')) {
		problems.push('handles no failure: no node sends its errors to an error output');
	}
	for (const [from, outputs] of Object.entries(workflow.connections ?? {})) {
		if (!names.has(from)) problems.push(`a connection starts at '${from}', which is not a node`);
		for (const branch of Object.values(outputs ?? {})) {
			for (const list of branch ?? []) {
				for (const link of list ?? []) {
					if (!names.has(link?.node)) problems.push(`a connection from '${from}' ends at '${link?.node}', which is not a node`);
				}
			}
		}
	}
	const visit = (value, key, path) => {
		if (typeof value === 'string') {
			for (const m of value.matchAll(URL_IN_TEXT)) {
				const url = m[0];
				if (!PLACEHOLDER_HOST.test(url) && !allowedUrlPrefixes.some((p) => url.startsWith(p))) {
					problems.push(`${path} holds the URL ${url}`);
				}
			}
			if (key !== 'id' && UUID.test(value)) problems.push(`${path} holds an ID (${value.match(UUID)[0]})`);
			for (const [re, what] of SECRET_PATTERNS) if (re.test(value)) problems.push(`${path} holds ${what}`);
			if (looksLikeBase64Secret(value)) problems.push(`${path} holds a long encoded value`);
			if (SECRET_KEYS.test(key ?? '') && value.trim() && !value.startsWith('=')) problems.push(`${path} holds a secret`);
			return;
		}
		if (Array.isArray(value)) value.forEach((v, i) => visit(v, key, `${path}[${i}]`));
		else if (value && typeof value === 'object') {
			for (const [k, v] of Object.entries(value)) visit(v, k, path ? `${path}.${k}` : k);
		}
	};
	visit(workflow, '', '');
	return problems;
}

// ---------------------------------------------------------------- running the checks

function readTerms() {
	const terms = parseTermList(readFileSync(join(repoRoot, 'docs-lint', 'jargon.txt'), 'utf8'));
	const allowPath = join(repoRoot, 'docs-lint', 'jargon-allow.txt');
	const allow = existsSync(allowPath) ? parseAllowList(readFileSync(allowPath, 'utf8')) : [];
	if (!terms.length) throw new Error('docs-lint/jargon.txt lists no terms');
	return { terms, allow };
}

function relFrom(root) {
	return (path) => relative(root, path).split(sep).join('/');
}

export function checkPackageDocs(packageDir, loaded = loadPackage(packageDir)) {
	const problems = [];
	const rel = relFrom(repoRoot);
	const read = (p) => (existsSync(join(packageDir, p)) ? readFileSync(join(packageDir, p), 'utf8') : undefined);
	const required = [
		'README.md',
		'CHANGELOG.md',
		'docs/getting-started.md',
		'docs/credentials.md',
		'docs/operations.md',
		'docs/trigger.md',
		'docs/concepts.md',
		'docs/troubleshooting.md',
		'docs/examples.md',
	];
	for (const p of required) if (read(p) === undefined) problems.push(`${p} is missing`);

	// 1. reference
	problems.push(
		...checkReference({
			action: loaded.action,
			trigger: loaded.trigger,
			catalogue: loaded.catalogue,
			operationsPage: read('docs/operations.md'),
			triggerPage: read('docs/trigger.md'),
		}),
	);

	// 2. troubleshooting
	const codeFiles = [...walk(join(packageDir, 'nodes')), ...walk(join(packageDir, 'credentials'))].filter((f) =>
		f.endsWith('.ts'),
	);
	const sources = codeFiles.map((f) => ({ file: rel(f), source: readFileSync(f, 'utf8') }));
	problems.push(...checkTroubleshooting(sources, read('docs/troubleshooting.md')));

	// 3. jargon
	const { terms, allow } = readTerms();
	const examples = walk(join(packageDir, 'examples')).filter((f) => f.endsWith('.json'));
	const pages = [
		...['README.md', 'CHANGELOG.md'].map((p) => join(packageDir, p)).filter(existsSync),
		...walk(join(packageDir, 'docs')).filter((f) => f.endsWith('.md')),
	];
	for (const file of [...pages, ...examples]) {
		problems.push(...jargonProblems(rel(file), readFileSync(file, 'utf8'), terms, allow));
	}
	const pkgText = [loaded.pkg.description ?? '', ...(loaded.pkg.keywords ?? [])].join('\n');
	problems.push(...jargonProblems(`${rel(join(packageDir, 'package.json'))} (description, keywords)`, pkgText, terms, allow));
	for (const { file, source } of sources) {
		for (const literal of userText(source)) {
			const text = literal.value.replace(/\u0000/g, ' ').replace(/\n/g, ' ');
			problems.push(...jargonProblems(file, text, terms, allow, () => literal.line - 1));
		}
	}

	// 4. links
	const links = checkLinks(pages, repoRoot);
	problems.push(...links.problems);

	// 5. examples
	const repoUrl = String(loaded.pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
	const allowedUrlPrefixes = [repoUrl, 'https://docs.n8n.io/'].filter(Boolean);
	if (examples.length < 3) problems.push(`examples/ holds ${examples.length} workflow(s); at least three are required`);
	const examplesPage = read('docs/examples.md') ?? '';
	for (const file of examples) {
		let workflow;
		try {
			workflow = JSON.parse(readFileSync(file, 'utf8'));
		} catch (e) {
			problems.push(`${rel(file)}: does not parse as JSON (${e.message})`);
			continue;
		}
		for (const p of checkExampleWorkflow(workflow, { packageName: loaded.pkg.name, allowedUrlPrefixes })) {
			problems.push(`${rel(file)}: ${p}`);
		}
		const name = file.split(sep).pop();
		if (!examplesPage.includes(`../examples/${name}`)) problems.push(`docs/examples.md does not link ${rel(file)}`);
	}
	return { problems, external: links.external };
}

export function checkRepositoryDocs(root) {
	const { terms, allow } = readTerms();
	const rel = relFrom(root);
	const pages = ['README.md', 'SECURITY.md', 'RELEASING.md'].map((p) => join(root, p));
	const problems = [];
	for (const p of pages) if (!existsSync(p)) problems.push(`${rel(p)} is missing`);
	const present = pages.filter(existsSync);
	for (const file of present) problems.push(...jargonProblems(rel(file), readFileSync(file, 'utf8'), terms, allow));
	const links = checkLinks(present, root);
	problems.push(...links.problems);
	return { problems, external: links.external };
}

function main(argv) {
	const args = argv.slice(2);
	const target = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
	const { problems, external } = args.includes('--repo') ? checkRepositoryDocs(target) : checkPackageDocs(target);
	if (external.length) {
		console.log(`External links, to check by hand before a release (${external.length}):`);
		for (const url of external) console.log(`  ${url}`);
	}
	if (problems.length) {
		console.error(`The documentation checks found ${problems.length} issue(s):\n- ${problems.join('\n- ')}`);
		return 1;
	}
	console.log(`${relative(repoRoot, target) || '.'}: documentation checks passed`);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv);
}
