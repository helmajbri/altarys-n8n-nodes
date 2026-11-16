#!/usr/bin/env node
// Generates the declarative operations of an n8n node from an OpenAPI document and a scope
// manifest. Every name the manifest uses is checked against the document, so a renamed or
// removed field, path or parameter stops the build instead of shipping a node that sends it.
//
// Usage:
//   node tools/generate-operations.mjs <packageDir> --check   exit 1 when the committed output differs
//   node tools/generate-operations.mjs <packageDir> --write   rewrite the committed output
//   node tools/generate-operations.mjs <packageDir> --check --openapi <file>   use another document
//
// The casing checks below reproduce title-case@3.0.3 and sentence-case@3.0.4, the libraries
// eslint-plugin-n8n-nodes-base uses for node-param-display-name-miscased and
// node-param-operation-option-action-miscased, so a generated name that lint would refuse is
// refused here first.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class GeneratorError extends Error {
	constructor(problems) {
		super(`The generator stopped:\n- ${problems.join('\n- ')}`);
		this.problems = problems;
	}
}

// ---------------------------------------------------------------- casing (lint parity)

const SMALL_WORDS =
	/\b(?:an?d?|a[st]|because|but|by|en|for|i[fn]|neither|nor|o[fnr]|only|over|per|so|some|tha[tn]|the|to|up|upon|vs?\.?|versus|via|when|with|without|yet)\b/i;
const TOKENS = /[^\s:\u2013\u2014-]+|./g;
const IS_MANUAL_CASE = /.(?=[A-Z]|\..)/;
const ALPHANUMERIC = /[A-Za-z0-9\u00C0-\u00FF]/;

export function titleCase(input) {
	let result = '';
	for (const m of input.matchAll(TOKENS)) {
		const token = m[0];
		const index = m.index;
		if (
			!IS_MANUAL_CASE.test(token) &&
			(!SMALL_WORDS.test(token) || index === 0 || index + token.length === input.length) &&
			(input.charAt(index + token.length) !== ':' || /\s/.test(input.charAt(index + token.length + 1)))
		) {
			result += token.replace(ALPHANUMERIC, (c) => c.toUpperCase());
			continue;
		}
		result += token;
	}
	return result;
}

function noCaseWords(input) {
	const split = input
		.replace(/([a-z0-9])([A-Z])/g, '$1\0$2')
		.replace(/([A-Z])([A-Z][a-z])/g, '$1\0$2')
		.replace(/[^A-Z0-9]+/gi, '\0');
	let start = 0;
	let end = split.length;
	while (split.charAt(start) === '\0') start++;
	while (split.charAt(end - 1) === '\0') end--;
	return split.slice(start, end).split('\0');
}

export function sentenceCase(input) {
	return noCaseWords(input)
		.map((w, i) => {
			const lower = w.toLowerCase();
			return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
		})
		.join(' ');
}

export function isSentenceCase(sentence) {
	const kept = sentence
		.split(' ')
		.filter((w) => w !== w.toUpperCase())
		.filter((w) => !w.includes("\\'"))
		.join(' ');
	return kept === sentenceCase(kept);
}

const ACRONYMS = new Map([
	['id', 'ID'],
	['ids', 'IDs'],
	['url', 'URL'],
	['vat', 'VAT'],
	['pdf', 'PDF'],
	['cc', 'CC'],
]);

export function displayNameFor(field) {
	const parts = field.split('_').filter(Boolean);
	let minorUnits = false;
	if (parts.length > 1 && parts[parts.length - 1] === 'cents') {
		parts.pop();
		minorUnits = true;
	}
	const words = parts.map((p) => ACRONYMS.get(p) ?? p);
	const name = titleCase(words.join(' '));
	return minorUnits ? `${name} (Minor Units)` : name;
}

export function camelName(field) {
	return field.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

const compareNames = (a, b) => a.localeCompare(b);

// ---------------------------------------------------------------- schema helpers

function makeSchemaTools(openapi) {
	const components = openapi.components?.schemas ?? {};
	const deref = (schema) => {
		let s = schema ?? {};
		const seen = new Set();
		while (s.$ref) {
			if (seen.has(s.$ref)) break;
			seen.add(s.$ref);
			s = components[s.$ref.split('/').pop()] ?? {};
		}
		return s;
	};
	// The schema without its null branch.
	const solid = (schema) => {
		const s = deref(schema);
		if (Array.isArray(s.anyOf)) {
			const rest = s.anyOf.filter((x) => deref(x).type !== 'null');
			if (rest.length === 1) return deref(rest[0]);
			return { anyOf: rest.map(deref) };
		}
		return s;
	};
	const isDecimal = (s) =>
		Array.isArray(s.anyOf) &&
		s.anyOf.length === 2 &&
		s.anyOf.some((x) => x.type === 'number') &&
		s.anyOf.some((x) => x.type === 'string');
	return { components, deref, solid, isDecimal };
}

function responseSchema(op) {
	for (const [status, response] of Object.entries(op.responses ?? {})) {
		if (!status.startsWith('2')) continue;
		const json = response.content?.['application/json'];
		if (json) return json.schema;
	}
	return undefined;
}

// ---------------------------------------------------------------- TypeScript emission

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const code = (text) => ({ $code: text });

function quote(text) {
	return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

export function toTs(value, depth = 0) {
	const pad = '\t'.repeat(depth + 1);
	const end = '\t'.repeat(depth);
	if (value === null) return 'null';
	if (typeof value === 'string') return quote(value);
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) {
		if (value.length === 0) return '[]';
		return `[\n${value.map((v) => `${pad}${toTs(v, depth + 1)},\n`).join('')}${end}]`;
	}
	if (typeof value === 'object' && '$code' in value) return value.$code;
	const keys = Object.keys(value);
	if (keys.length === 0) return '{}';
	return `{\n${keys
		.map((k) => `${pad}${IDENT.test(k) ? k : quote(k)}: ${toTs(value[k], depth + 1)},\n`)
		.join('')}${end}}`;
}

// ---------------------------------------------------------------- the generator

const inlineList = (items) => `[${items.map(quote).join(', ')}]`;

const JSON_VALUE = '={{ typeof $value === "string" ? JSON.parse($value) : $value }}';

export function generate({ manifest, openapi, openapiName = manifest.openapi }) {
	const problems = [];
	const { components, deref, solid, isDecimal } = makeSchemaTools(openapi);
	const money = manifest.money;
	const minorRe = new RegExp(money.minorUnitField);
	const majorRe = new RegExp(money.majorUnitField);
	const currencyRe = new RegExp(money.currencyField);
	const omitFor = (title) => money.outputOmit[title] ?? {};
	const notMoneyFor = (title) => money.notMoney[title] ?? {};

	// Every schema the money rules name must still carry the field they name.
	for (const [kind, table] of [
		['outputOmit', money.outputOmit],
		['notMoney', money.notMoney],
	]) {
		for (const [title, fields] of Object.entries(table)) {
			const s = components[title];
			if (!s) {
				problems.push(`money.${kind}: schema ${title} is not in ${openapiName}`);
				continue;
			}
			for (const f of Object.keys(fields)) {
				if (!s.properties?.[f]) problems.push(`money.${kind}: ${title} has no field '${f}'`);
			}
		}
	}
	for (const key of Object.keys(money.inputCurrencyFrom)) {
		const [title, f] = key.split('.');
		if (!components[title]?.properties?.[f]) {
			problems.push(`money.inputCurrencyFrom: ${title} has no field '${f}'`);
		}
	}

	// Output money audit: walk a response schema; returns the paths to omit, relative to an item.
	const auditOutput = (schema, where, prefix, seen) => {
		const s = solid(schema);
		if (s.type === 'array') return auditOutput(s.items, where, `${prefix}[]`, seen);
		if (Array.isArray(s.anyOf)) {
			const branches = s.anyOf.flatMap((branch) => auditOutput(branch, where, prefix, seen));
			return [...new Set(branches)];
		}
		if (!s.properties) return [];
		const title = s.title ?? '(anonymous)';
		if (seen.has(title)) return [];
		const nextSeen = new Set(seen).add(title);
		const omit = omitFor(title);
		const notMoney = notMoneyFor(title);
		const paths = [];
		let keptMinor = false;
		let hasCurrency = false;
		for (const [field, raw] of Object.entries(s.properties)) {
			const f = solid(raw);
			const path = prefix ? `${prefix}.${field}` : field;
			if (currencyRe.test(field)) hasCurrency = true;
			if (field in omit) {
				paths.push(path);
				continue;
			}
			if (minorRe.test(field)) {
				if (f.type !== 'integer') {
					problems.push(`${where}: ${title}.${field} is minor units but not an integer`);
				}
				keptMinor = true;
			} else if (majorRe.test(field) && !(field in notMoney) && f.type !== 'integer') {
				problems.push(
					`${where}: ${title}.${field} looks like a major-unit amount; omit it or classify it in money.notMoney`,
				);
			}
			paths.push(...auditOutput(raw, where, path, nextSeen));
		}
		if (keptMinor && !hasCurrency) {
			problems.push(`${where}: ${title} carries minor-unit amounts but no currency field`);
		}
		return paths;
	};

	// Input money audit: integer minor units, each with a currency beside it or a named source.
	const auditInput = (schema, where, prefix, seen, excluded) => {
		const s = solid(schema);
		if (s.type === 'array') return auditInput(s.items, where, `${prefix}[]`, seen, excluded);
		if (Array.isArray(s.anyOf)) {
			const branches = s.anyOf.flatMap((branch) => auditInput(branch, where, prefix, seen, excluded));
			return [...new Set(branches)];
		}
		if (!s.properties) return [];
		const title = s.title ?? '(anonymous)';
		if (seen.has(title)) return [];
		const nextSeen = new Set(seen).add(title);
		const hasCurrency = Object.keys(s.properties).some((f) => currencyRe.test(f));
		const minorPaths = [];
		for (const [field, raw] of Object.entries(s.properties)) {
			const path = prefix ? `${prefix}.${field}` : field;
			if (excluded.has(path)) continue;
			if (minorRe.test(field)) {
				if (solid(raw).type !== 'integer') {
					problems.push(`${where}: ${title}.${field} is minor units but not an integer`);
				}
				if (!hasCurrency && !money.inputCurrencyFrom[`${title}.${field}`]) {
					problems.push(`${where}: ${title}.${field} has no currency beside it and no money.inputCurrencyFrom entry`);
				}
				minorPaths.push(path);
			}
			minorPaths.push(...auditInput(raw, where, path, nextSeen, excluded));
		}
		return minorPaths;
	};

	const describeItems = (schema, skip) => {
		const s = solid(schema);
		if (!s.properties) return '';
		const req = new Set(s.required ?? []);
		return Object.keys(s.properties)
			.filter((f) => !skip.has(f))
			.map((f) => (req.has(f) ? `${f} (required)` : f))
			.join(', ');
	};

	// One n8n parameter for one OpenAPI field.
	const fieldParameter = (field, raw, ctx) => {
		const s = solid(raw);
		const p = { displayName: displayNameFor(field), name: camelName(field) };
		let jsonValue = false;
		let description;
		if (Array.isArray(s.enum)) {
			const options = s.enum
				.map((v) => ({ name: titleCase(String(v).replace(/_/g, ' ')), value: v }))
				.sort((a, b) => compareNames(a.name, b.name));
			p.type = 'options';
			p.options = options;
			p.default = s.enum.includes(s.default) ? s.default : options[0].value;
		} else if (isDecimal(s)) {
			p.type = 'string';
			p.default = '';
			p.placeholder = 'e.g. 10.5';
			description = 'Decimal number written as text';
		} else if (s.type === 'string' && s.format === 'date-time') {
			p.type = 'dateTime';
			p.default = '';
		} else if (s.type === 'string') {
			p.type = 'string';
			p.default = '';
			if (s.format === 'date') p.placeholder = 'e.g. 2026-01-31';
			if (s.format === 'email' || /email/.test(field)) p.placeholder = 'name@email.com';
			if (currencyRe.test(field)) {
				p.placeholder = 'e.g. EUR';
				description = 'Three-letter ISO 4217 currency code';
			}
		} else if (s.type === 'integer') {
			p.type = 'number';
			p.default = typeof s.default === 'number' ? s.default : 0;
			p.typeOptions = { numberPrecision: 0 };
			if (typeof s.minimum === 'number') p.typeOptions.minValue = s.minimum;
			if (typeof s.exclusiveMinimum === 'number') p.typeOptions.minValue = s.exclusiveMinimum + 1;
			if (typeof s.maximum === 'number') p.typeOptions.maxValue = s.maximum;
			if (minorRe.test(field)) {
				const from = ctx.currencyFrom ? `, in ${ctx.currencyFrom}` : '';
				description = `Amount in minor units of the currency as a whole number, e.g. 1250 for 12.50${from}`;
			}
		} else if (s.type === 'number') {
			p.type = 'number';
			p.default = typeof s.default === 'number' ? s.default : 0;
		} else if (s.type === 'boolean') {
			p.type = 'boolean';
			p.default = typeof s.default === 'boolean' ? s.default : false;
			description = manifest.booleanCopy[field];
			if (!description) problems.push(`${ctx.where}: boolean '${field}' has no booleanCopy entry`);
		} else if (s.type === 'array' || s.type === 'object' || s.anyOf || Object.keys(s).length === 0) {
			p.type = 'json';
			const isArray = s.type === 'array';
			p.default = isArray ? '[]' : '{}';
			const skip = new Set(
				[...(ctx.excluded ?? [])]
					.filter((x) => x.startsWith(`${field}[].`) || x.startsWith(`${field}.`))
					.map((x) => x.split('.').pop()),
			);
			const items = isArray ? describeItems(s.items, skip) : describeItems(s, skip);
			const scalar = isArray ? solid(s.items ?? {}).type : undefined;
			description = isArray
				? items
					? `JSON array of objects with: ${items}`
					: scalar
						? `JSON array of ${scalar}s`
						: 'JSON array'
				: items
					? `JSON object with: ${items}`
					: 'JSON object';
			jsonValue = true;
		} else {
			problems.push(`${ctx.where}: field '${field}' has a type the generator does not map`);
			p.type = 'string';
			p.default = '';
		}
		if (ctx.required) p.required = true;
		if (description) p.description = description;
		const send = { type: ctx.in, property: field };
		if (jsonValue) send.value = JSON_VALUE;
		p.routing = { send };
		return p;
	};

	const show = (resource, operation) => ({ show: { resource: [resource], operation: [operation] } });

	const operationOptions = new Map();
	const fieldProperties = [];
	const specs = [];
	const seenOps = new Set();

	for (const m of manifest.operations) {
		const where = `${m.resource}.${m.value} (${m.method} ${m.path})`;
		const key = `${m.resource}.${m.value}`;
		if (seenOps.has(key)) problems.push(`${where}: listed twice`);
		seenOps.add(key);
		if (!manifest.resources.some((r) => r.value === m.resource)) {
			problems.push(`${where}: resource '${m.resource}' is not in resources`);
		}
		const op = openapi.paths?.[m.path]?.[m.method.toLowerCase()];
		if (!op) {
			problems.push(`${where}: the operation is not in ${openapiName}`);
			continue;
		}
		if (titleCase(m.name) !== m.name) problems.push(`${where}: name '${m.name}' is not Title Case`);
		if (!isSentenceCase(m.action)) problems.push(`${where}: action '${m.action}' is not sentence case`);
		const params = op.parameters ?? [];
		const byIn = (where_) => params.filter((p) => p.in === where_);
		const fields = [];

		// Path parameters, in path order.
		const pathNames = [...m.path.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]);
		let url = m.path;
		for (const name of pathNames) {
			if (!byIn('path').some((p) => p.name === name)) {
				problems.push(`${where}: path parameter '${name}' is not declared in ${openapiName}`);
			}
			url = url.replace(`{${name}}`, `{{encodeURIComponent($parameter["${camelName(name)}"])}}`);
			fields.push({
				displayName: displayNameFor(name),
				name: camelName(name),
				type: 'string',
				required: true,
				default: '',
				displayOptions: show(m.resource, m.value),
			});
		}
		if (pathNames.length) url = `=${url}`;

		// Request body.
		const preSend = [];
		const bodyFieldsRequired = [];
		const bodyFieldsOptional = [];
		let minorInputs = [];
		const bodySchema = op.requestBody?.content?.['application/json']?.schema;
		if (m.body && !bodySchema) problems.push(`${where}: manifest has a body but ${openapiName} has none`);
		if (bodySchema && !m.body) problems.push(`${where}: ${openapiName} has a body the manifest does not map`);
		let bodyProps = {};
		if (bodySchema && m.body) {
			const b = solid(bodySchema);
			bodyProps = b.properties ?? {};
			const schemaRequired = [...(b.required ?? [])].sort();
			const manifestRequired = [...m.body.required].sort();
			if (JSON.stringify(schemaRequired) !== JSON.stringify(manifestRequired)) {
				problems.push(
					`${where}: required body fields are [${schemaRequired.join(', ')}] in ${openapiName} but [${manifestRequired.join(', ')}] in the manifest`,
				);
			}
			const excluded = new Set(Object.keys(m.body.exclude));
			const pathExists = (path) => {
				let cursor = bodySchema;
				for (const seg of path.split('.')) {
					const s = solid(cursor ?? {});
					cursor = s.properties?.[seg.replace('[]', '')];
					if (!cursor) return false;
					if (seg.endsWith('[]')) cursor = solid(cursor).items;
				}
				return true;
			};
			for (const f of [...m.body.required, ...excluded]) {
				if (!pathExists(f)) problems.push(`${where}: body field '${f}' is not in ${b.title ?? 'the body'}`);
			}
			minorInputs = auditInput(bodySchema, where, '', new Set(), excluded);
			const idempotencyField = m.idempotency.startsWith('body:') ? m.idempotency.slice(5) : null;
			for (const [f, raw] of Object.entries(bodyProps)) {
				if (f in m.body.exclude || f === idempotencyField) continue;
				const required = (b.required ?? []).includes(f);
				const currencyFrom = money.inputCurrencyFrom[`${b.title}.${f}`];
				const p = fieldParameter(f, raw, { in: 'body', required, where, currencyFrom, excluded });
				(required ? bodyFieldsRequired : bodyFieldsOptional).push(p);
			}
			if (minorInputs.length) preSend.push(code(`requireIntegerMinorUnits(${inlineList(minorInputs)})`));
		}

		// Idempotency, checked against the document.
		const headerKey = byIn('header').some((p) => p.name === 'Idempotency-Key');
		let idempotencyParameter = null;
		if (m.idempotency === 'header') {
			if (!headerKey) problems.push(`${where}: the manifest sends Idempotency-Key but the route does not declare it`);
			preSend.push(code(`applyIdempotencyKey('header')`));
			idempotencyParameter = true;
		} else if (m.idempotency.startsWith('body:')) {
			const f = m.idempotency.slice(5);
			if (!bodyProps[f]) problems.push(`${where}: idempotency body field '${f}' is not in the body`);
			if (headerKey) problems.push(`${where}: the route declares Idempotency-Key; send the header`);
			preSend.push(code(`applyIdempotencyKey('body', ${quote(f)})`));
			idempotencyParameter = true;
		} else if (m.idempotency.startsWith('natural:')) {
			const path = m.idempotency.slice(8);
			const [head, tail] = path.split('[].');
			const headSchema = bodyProps[head];
			const ok = tail
				? (solid(solid(headSchema ?? {}).items ?? {}).required ?? []).includes(tail)
				: (solid(bodySchema ?? {}).required ?? []).includes(head);
			if (!ok) problems.push(`${where}: natural idempotency key '${path}' is not a required body field`);
			if (headerKey) problems.push(`${where}: the route declares Idempotency-Key; send the header`);
		} else if (m.idempotency === 'none') {
			if (headerKey) problems.push(`${where}: the route now declares Idempotency-Key; update the manifest`);
		} else {
			problems.push(`${where}: unknown idempotency '${m.idempotency}'`);
		}

		// Query parameters.
		const queryProps = [];
		for (const q of m.query ?? []) {
			const declared = byIn('query').find((p) => p.name === q);
			if (!declared) {
				problems.push(`${where}: query parameter '${q}' is not declared in ${openapiName}`);
				continue;
			}
			queryProps.push(fieldParameter(q, declared.schema, { in: 'query', required: false, where }));
		}

		// Output.
		let outputOmit = [];
		const postReceive = [code('checkResponse')];
		const request = { method: m.method, url };
		let itemSchema;
		let list = null;
		const rs = responseSchema(op);
		if (m.output === 'deleted') {
			postReceive.push(code('returnDeleted'));
		} else if (m.output === 'binary') {
			const content = Object.values(op.responses ?? {}).find((r) => r.content?.['application/pdf']);
			if (!content) problems.push(`${where}: the route does not answer with a PDF`);
			request.encoding = 'arraybuffer';
			request.headers = { Accept: 'application/pdf' };
			postReceive.push({ type: 'binaryData', properties: { destinationProperty: 'data' } });
		} else {
			if (!rs) problems.push(`${where}: no JSON response in ${openapiName}`);
			const rootPath = m.list ? m.list.items : m.root;
			itemSchema = rs;
			if (rootPath) {
				let cursor = rs;
				for (const seg of rootPath.split('.')) {
					const s = solid(cursor ?? {});
					cursor = s.properties?.[seg];
					if (!cursor) {
						problems.push(`${where}: the response has no '${rootPath}'`);
						break;
					}
				}
				if (m.list) {
					const arr = solid(cursor ?? {});
					if (arr.type !== 'array') problems.push(`${where}: '${rootPath}' is not a list`);
					itemSchema = arr.items;
				} else {
					itemSchema = cursor;
				}
				postReceive.push({ type: 'rootProperty', properties: { property: rootPath } });
			}
			if (itemSchema) {
				const omit = auditOutput(itemSchema, where, '', new Set());
				if (omit.length) postReceive.push(code(`omitMoneyFields(${inlineList(omit)})`));
				outputOmit = omit;
			}
		}
		if (m.list) {
			const pageParam = byIn('query').find((p) => p.name === 'page');
			const perPage = byIn('query').find((p) => p.name === 'per_page');
			const max = perPage ? solid(perPage.schema).maximum : undefined;
			if (!pageParam || !perPage) problems.push(`${where}: a list needs 'page' and 'per_page' query parameters`);
			if (typeof max !== 'number') problems.push(`${where}: 'per_page' has no maximum`);
			list = { items: m.list.items, maxPerPage: max ?? 0 };
		}

		const routing = { request };
		if (preSend.length) routing.send = { preSend };
		routing.output = { postReceive };
		const option = { name: m.name, value: m.value, action: m.action, description: m.description, routing };
		if (!operationOptions.has(m.resource)) operationOptions.set(m.resource, []);
		operationOptions.get(m.resource).push(option);

		for (const p of bodyFieldsRequired.sort((a, b) => compareNames(a.displayName, b.displayName))) {
			fields.push({ ...p, displayOptions: show(m.resource, m.value) });
		}
		if (idempotencyParameter) {
			fields.push({
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Key LetzBill uses to recognise a retry of this request; leave empty to derive one from the workflow, execution and item',
				displayOptions: show(m.resource, m.value),
			});
		}
		if (list) {
			fields.push({
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: show(m.resource, m.value),
				routing: {
					send: { paginate: '={{ $value }}' },
					operations: { pagination: code(`paginateByPage(${list.maxPerPage})`) },
				},
			});
			fields.push({
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: list.maxPerPage },
				description: 'Max number of results to return',
				displayOptions: { show: { resource: [m.resource], operation: [m.value], returnAll: [false] } },
				routing: { send: { type: 'query', property: 'per_page' }, output: { maxResults: '={{ $value }}' } },
			});
		}
		if (queryProps.length) {
			const isList = Boolean(list);
			fields.push({
				displayName: isList ? 'Filters' : 'Options',
				name: isList ? 'filters' : 'options',
				type: 'collection',
				placeholder: isList ? 'Add Filter' : 'Add Option',
				default: {},
				displayOptions: show(m.resource, m.value),
				options: queryProps.sort((a, b) => compareNames(a.displayName, b.displayName)),
			});
		}
		if (bodyFieldsOptional.length) {
			const isUpdate = m.value === 'update';
			fields.push({
				displayName: isUpdate ? 'Update Fields' : 'Additional Fields',
				name: isUpdate ? 'updateFields' : 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: show(m.resource, m.value),
				options: bodyFieldsOptional.sort((a, b) => compareNames(a.displayName, b.displayName)),
			});
		}
		fieldProperties.push(...fields);
		specs.push({
			resource: m.resource,
			operation: m.value,
			method: m.method,
			path: m.path,
			idempotency: m.idempotency,
			destructive: Boolean(m.destructive),
			output: m.output ?? (list ? 'list' : 'item'),
			root: m.list ? m.list.items : m.root ?? '',
			maxPerPage: list ? list.maxPerPage : 0,
			itemSchema: itemSchema ? (solid(itemSchema).title ?? '') : '',
			outputOmit,
			minorUnitInputs: minorInputs,
		});
	}

	if (problems.length) throw new GeneratorError(problems);

	const resources = [...manifest.resources].sort((a, b) => compareNames(a.name, b.name));
	if (manifest.defaultResource && !resources.some((r) => r.value === manifest.defaultResource)) {
		throw new GeneratorError([`defaultResource '${manifest.defaultResource}' is not a resource`]);
	}
	const properties = [
		{
			displayName: 'Resource',
			name: 'resource',
			type: 'options',
			noDataExpression: true,
			options: resources.map((r) => ({ name: r.name, value: r.value })),
			default: manifest.defaultResource ?? resources[0].value,
		},
	];
	for (const r of resources) {
		const options = (operationOptions.get(r.value) ?? []).sort((a, b) => compareNames(a.name, b.name));
		if (!options.length) continue;
		const preferred = options.find((o) => o.value === 'get') ?? options[0];
		properties.push({
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show: { resource: [r.value] } },
			options,
			default: preferred.value,
		});
	}
	properties.push(...fieldProperties);

	const helpers = [
		'applyIdempotencyKey',
		'checkResponse',
		'omitMoneyFields',
		'paginateByPage',
		'requireIntegerMinorUnits',
		'returnDeleted',
	];
	const body = toTs(properties);
	// Helper names only reach the output through code(), never inside a string value.
	const used = helpers.filter((h) => body.includes(h));
	return [
		'// Generated by tools/generate-operations.mjs from',
		`// ${manifest.openapi} and openapi/scope.manifest.json.`,
		'// Do not edit by hand: change the manifest and run the generator with --write.',
		"import type { INodeProperties } from 'n8n-workflow';",
		'',
		`import {\n\ttype GeneratedOperationSpec,\n${used.map((h) => `\t${h},\n`).join('')}} from '${manifest.runtimeImport}';`,
		'',
		`export const generatedProperties: INodeProperties[] = ${body};`,
		'',
		`export const operationSpecs: GeneratedOperationSpec[] = ${toTs(specs)};`,
		'',
	].join('\n');
}

// ---------------------------------------------------------------- CLI

function main(argv) {
	const args = argv.slice(2);
	const packageDir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
	const mode = args.includes('--write') ? 'write' : 'check';
	const openapiFlag = args.indexOf('--openapi');
	const manifest = JSON.parse(readFileSync(join(packageDir, 'openapi', 'scope.manifest.json'), 'utf8'));
	const openapiPath =
		openapiFlag >= 0 ? resolve(args[openapiFlag + 1]) : join(packageDir, manifest.openapi);
	const openapi = JSON.parse(readFileSync(openapiPath, 'utf8'));
	let output;
	try {
		output = generate({ manifest, openapi, openapiName: openapiPath });
	} catch (e) {
		if (e instanceof GeneratorError) {
			console.error(e.message);
			return 1;
		}
		throw e;
	}
	const target = join(packageDir, manifest.output);
	if (mode === 'write') {
		writeFileSync(target, output);
		console.log(`Wrote ${target}`);
		return 0;
	}
	const committed = readFileSync(target, 'utf8');
	if (committed !== output) {
		console.error(`${target} differs from the generator output. Run with --write and commit the result.`);
		return 1;
	}
	console.log(`${target} matches ${openapiPath}`);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv);
}
