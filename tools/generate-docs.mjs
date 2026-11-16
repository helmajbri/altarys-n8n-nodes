#!/usr/bin/env node
// Generates the operations reference (docs/operations.md) and the trigger reference block in
// docs/trigger.md of a node package from the built nodes, so the documentation cannot drift from
// what n8n shows. It reads the node descriptions n8n reads (dist/), the operation specs the
// operation generator wrote, the OpenAPI document for output fields, and the event catalogue
// snapshot (openapi/event-types.json).
//
// Usage, in a package folder after `npm run build`:
//   node ../../tools/generate-docs.mjs . --check   exit 1 when a committed page differs
//   node ../../tools/generate-docs.mjs . --write   rewrite the pages

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TRIGGER_BEGIN = '<!-- BEGIN GENERATED: trigger reference -->';
export const TRIGGER_END = '<!-- END GENERATED: trigger reference -->';

// ---------------------------------------------------------------- shared helpers

/** The anchor GitHub gives a Markdown heading (without the duplicate suffix). */
export function githubSlug(heading) {
	return heading
		.trim()
		.toLowerCase()
		.replace(/<[^>]*>/g, '')
		.replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
		.replace(/\s/g, '-');
}

function lowerFirst(text) {
	return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function sentence(text) {
	const t = String(text ?? '').trim();
	if (!t) return '';
	return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Plain table-cell text: links kept as Markdown, other tags dropped, pipes escaped. */
export function cellText(text) {
	return String(text ?? '')
		.replace(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.replace(/\|/g, '\\|')
		.trim();
}

const code = (value) => `\`${String(value).replace(/`/g, "'")}\``;

/** Whether a property is shown for a resource and an operation of a declarative node. */
function shownFor(property, resource, operation) {
	const show = property.displayOptions?.show;
	if (!show) return false;
	return (show.resource ?? []).includes(resource) && (show.operation ?? []).includes(operation);
}

/** Resources, their operations, and the parameters each operation shows, in the node's order. */
export function collectOperations(description) {
	const properties = description.properties ?? [];
	const resourceProperty = properties.find((p) => p.name === 'resource');
	if (!resourceProperty) return [];
	return (resourceProperty.options ?? []).map((resource) => {
		const operationProperty = properties.find(
			(p) => p.name === 'operation' && (p.displayOptions?.show?.resource ?? []).includes(resource.value),
		);
		const operations = (operationProperty?.options ?? []).map((option) => ({
			name: option.name,
			value: option.value,
			action: option.action ?? `${option.name} ${resource.name}`,
			description: option.description ?? '',
			parameters: properties.filter(
				(p) =>
					p.name !== 'resource' &&
					p.name !== 'operation' &&
					p.type !== 'hidden' &&
					p.type !== 'notice' &&
					shownFor(p, resource.value, option.value),
			),
		}));
		return { name: resource.name, value: resource.value, operations };
	});
}

/** The event lists of a catalogue snapshot: one list, or one per kind of key. */
export function eventGroups(catalogue) {
	if (Array.isArray(catalogue.events)) return [{ title: 'Events', events: catalogue.events }];
	const groups = [];
	if (Array.isArray(catalogue.provider)) {
		groups.push({ title: 'Events for a provider key', events: catalogue.provider });
	}
	if (Array.isArray(catalogue.customer)) {
		groups.push({ title: 'Events for a customer key', events: catalogue.customer });
	}
	return groups;
}

// ---------------------------------------------------------------- parameters

const TYPE_LABELS = {
	string: 'Text',
	number: 'Number',
	boolean: 'Boolean',
	options: 'Option',
	multiOptions: 'Options',
	json: 'JSON',
	dateTime: 'Date and time',
	collection: 'Optional fields',
	fixedCollection: 'Group',
	color: 'Color',
};

function typeLabel(p) {
	if (p.type === 'string' && p.typeOptions?.password) return 'Text (hidden)';
	return TYPE_LABELS[p.type] ?? p.type;
}

function defaultText(p) {
	const d = p.default;
	if (p.type === 'options') {
		const option = (p.options ?? []).find((o) => o.value === d);
		return option ? option.name : undefined;
	}
	if (p.type === 'boolean') return typeof d === 'boolean' ? String(d) : undefined;
	if (p.type === 'number') return typeof d === 'number' && d !== 0 ? String(d) : undefined;
	if (p.type === 'string') return typeof d === 'string' && d !== '' ? d : undefined;
	return undefined;
}

function parameterDetails(p, spec) {
	const parts = [];
	if (p.description) parts.push(sentence(cellText(p.description)));
	if (spec?.uuidParameters?.includes(p.name)) parts.push('Must be an ID in UUID form.');
	if (spec?.safeParameters?.includes(p.name)) parts.push('Any ID text without a slash.');
	if ((p.type === 'options' || p.type === 'multiOptions') && p.typeOptions?.loadOptionsMethod) {
		parts.push('n8n loads the list from your account.');
	} else if (p.type === 'options' || p.type === 'multiOptions') {
		const described = (p.options ?? []).some((o) => o.description);
		const names = (p.options ?? []).map((o) =>
			described && o.description ? `${code(o.name)}: ${sentence(cellText(o.description))}` : code(o.name),
		);
		if (names.length) parts.push(`One of: ${names.join(described ? ' ' : ', ')}${described ? '' : '.'}`);
	}
	const min = p.typeOptions?.minValue;
	const max = p.typeOptions?.maxValue;
	const statesRange = min !== undefined && max !== undefined && String(p.description ?? '').toLowerCase().includes(`from ${min} to ${max}`);
	if (statesRange) {
		// The description already gives the range.
	} else if (min !== undefined && max !== undefined) parts.push(`From ${min} to ${max}.`);
	else if (min !== undefined) parts.push(`At least ${min}.`);
	else if (max !== undefined) parts.push(`At most ${max}.`);
	if (p.placeholder && /^e\.g\. /.test(p.placeholder)) parts.push(`Example: ${code(p.placeholder.slice(5))}.`);
	const fallback = defaultText(p);
	if (fallback !== undefined) parts.push(`Default: ${code(fallback)}.`);
	if (p.displayOptions?.show?.returnAll) parts.push('Shown when **Return All** is off.');
	return parts.join(' ');
}

function parameterRows(parameters, spec) {
	const rows = [];
	for (const p of parameters) {
		rows.push(
			`| ${cellText(p.displayName)} | ${typeLabel(p)} | ${p.required ? 'Yes' : 'No'} | ${parameterDetails(p, spec) || ' '} |`,
		);
		if (p.type === 'collection' || p.type === 'fixedCollection') {
			for (const option of p.options ?? []) {
				const inner = option.values ? option.values : [option];
				for (const field of inner) {
					rows.push(
						`| ${cellText(p.displayName)} > ${cellText(field.displayName)} | ${typeLabel(field)} | No | ${parameterDetails(field, spec) || ' '} |`,
					);
				}
			}
		}
	}
	return rows;
}

function parameterTable(parameters, spec) {
	if (!parameters.length) return ['This operation has no parameters.'];
	return [
		'| Parameter | Type | Required | Details |',
		'|---|---|---|---|',
		...parameterRows(parameters, spec),
	];
}

// ---------------------------------------------------------------- output

function makeSchemaTools(openapi) {
	const schemas = openapi?.components?.schemas ?? {};
	const solid = (schema) => {
		let s = schema ?? {};
		const seen = new Set();
		while (s.$ref && !seen.has(s.$ref)) {
			seen.add(s.$ref);
			s = schemas[s.$ref.split('/').pop()] ?? {};
		}
		if (Array.isArray(s.anyOf)) {
			const rest = s.anyOf.filter((x) => solid(x).type !== 'null');
			if (rest.length === 1) return solid(rest[0]);
		}
		return s;
	};
	return { schemas, solid };
}

function responseOf(openapi, route) {
	const op = openapi?.paths?.[route.path]?.[String(route.method).toLowerCase()];
	for (const [status, response] of Object.entries(op?.responses ?? {})) {
		if (!status.startsWith('2')) continue;
		const json = response.content?.['application/json'];
		if (json) return json.schema;
	}
	return undefined;
}

/** The top-level fields of an operation's output items, or undefined when it returns no record. */
function outputFields(spec, context) {
	if (!spec || spec.output === 'deleted' || spec.output === 'binary') return undefined;
	const { schemas, solid } = makeSchemaTools(context.openapi);
	let schema;
	let added = [];
	if (spec.output === 'custom') {
		const entry = (context.manifest?.operations ?? []).find(
			(o) => o.resource === spec.resource && o.value === spec.operation,
		);
		const last = entry?.uses?.[entry.uses.length - 1];
		schema = last ? responseOf(context.openapi, last) : undefined;
		added = entry?.outputAdded ?? [];
	} else if (spec.itemSchema) {
		schema = schemas[spec.itemSchema];
	}
	const omitted = new Set((spec.outputOmit ?? []).filter((path) => !/[.[]/.test(path)));
	const fields = schema ? Object.keys(solid(schema).properties ?? {}).filter((f) => !omitted.has(f)) : [];
	fields.push(...added.filter((f) => !fields.includes(f)));
	return fields;
}

function outputText(spec, context, shared) {
	if (!spec) return 'The response of the service.';
	if (spec.output === 'deleted') return 'One item: `{"deleted": true}`.';
	if (spec.output === 'binary') return 'One item with the file as binary data in the `data` property.';
	const fields = outputFields(spec, context) ?? [];
	const many = spec.output === 'list';
	if (!fields.length) return many ? 'One item per result.' : 'One item with the response.';
	if (shared && fields.join(',') === shared.key) {
		return `${many ? 'One item per result' : 'One item'}, with the [${shared.heading}](#${githubSlug(shared.heading)}).`;
	}
	return `${many ? 'One item per result, with these fields' : 'One item with these fields'}: ${fields.map(code).join(', ')}.`;
}

/** The output field list most operations of a resource share, listed once on the page. */
function sharedFields(resource, specs, context) {
	const counts = new Map();
	for (const o of resource.operations) {
		const spec = specs.find((s) => s.resource === resource.value && s.operation === o.value);
		const fields = outputFields(spec, context);
		if (fields?.length) counts.set(fields.join(','), (counts.get(fields.join(',')) ?? 0) + 1);
	}
	const [key, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
	return n >= 2 ? { key, heading: `${resource.name} fields` } : undefined;
}

function behaviourNotes(spec) {
	const notes = [];
	if (!spec) return notes;
	if (spec.destructive) notes.push('This operation cannot be undone.');
	if (spec.idempotency === 'header' || String(spec.idempotency).startsWith('body:')) {
		notes.push(
			'A retry with the same **Idempotency Key** is applied once. Left empty, the node makes a key that stays the same when n8n retries the item.',
		);
	} else if (String(spec.idempotency).startsWith('natural:')) {
		const field = String(spec.idempotency).slice(8).split('[].').pop();
		notes.push(`The service records each ${code(field)} once, so a retry with the same value is not counted twice.`);
	}
	if (spec.output === 'list') {
		notes.push('**Return All** reads every page; otherwise **Limit** sets how many results to return.');
	}
	return notes;
}

// ---------------------------------------------------------------- pages

export function renderOperations({ description, specs = [], manifest, openapi }) {
	const resources = collectOperations(description);
	const service = description.displayName;
	const lines = [
		`# ${service} node operations`,
		'',
		`Use the **${service}** node to ${lowerFirst(sentence(description.description))} This page lists every resource and operation of the node, the parameters n8n shows for each one, and the fields it returns.`,
		'',
		'<!-- Generated from the built node by tools/generate-docs.mjs. Do not edit this file: change the node, build it, and run the generator with --write. -->',
		'',
		'## Resources',
		'',
		'| Resource | Operations |',
		'|---|---|',
	];
	for (const r of resources) {
		const ops = r.operations.map((o) => `[${o.name}](#${githubSlug(o.action)})`).join(', ');
		lines.push(`| [${r.name}](#${githubSlug(r.name)}) | ${ops} |`);
	}
	for (const r of resources) {
		lines.push('', `## ${r.name}`, '');
		lines.push(`Operations on the **${r.name}** resource of the **${service}** node.`);
		const shared = sharedFields(r, specs, { manifest, openapi });
		if (shared) {
			lines.push('', `### ${shared.heading}`, '');
			lines.push(
				`The operations below that return a record of this resource return it with these fields: ${shared.key.split(',').map(code).join(', ')}.`,
			);
		}
		for (const o of r.operations) {
			const spec = specs.find((s) => s.resource === r.value && s.operation === o.value);
			lines.push('', `### ${o.action}`, '');
			lines.push(sentence(cellText(o.description)) || `${o.name} ${r.name}.`);
			lines.push('', ...parameterTable(o.parameters, spec));
			lines.push('', `**Output:** ${outputText(spec, { manifest, openapi }, shared)}`);
			const notes = behaviourNotes(spec);
			if (notes.length) lines.push('', notes.join(' '));
		}
	}
	lines.push('');
	return lines.join('\n');
}

export function renderTriggerBlock({ description, catalogue }) {
	const parameters = (description.properties ?? []).filter((p) => p.type !== 'hidden' && p.type !== 'notice');
	const lines = [
		TRIGGER_BEGIN,
		'<!-- Generated by tools/generate-docs.mjs from the built trigger and openapi/event-types.json. -->',
		'<!-- vale off -->',
		'',
		`### ${description.displayName} parameters`,
		'',
		'| Parameter | Type | Required | Details |',
		'|---|---|---|---|',
		...parameterRows(parameters),
	];
	for (const group of eventGroups(catalogue)) {
		lines.push('', `### ${group.title}`, '', '| Event | When it is sent |', '|---|---|');
		for (const e of group.events) lines.push(`| ${code(e.type)} | ${cellText(sentence(e.description))} |`);
	}
	lines.push('', '<!-- vale on -->', TRIGGER_END);
	return lines.join('\n');
}

/** Replaces the generated block of a page; throws when the markers are missing. */
export function replaceBlock(page, block) {
	const start = page.indexOf(TRIGGER_BEGIN);
	const end = page.indexOf(TRIGGER_END);
	if (start < 0 || end < start) {
		throw new Error(`the page has no '${TRIGGER_BEGIN}' ... '${TRIGGER_END}' block`);
	}
	return page.slice(0, start) + block + page.slice(end + TRIGGER_END.length);
}

// ---------------------------------------------------------------- loading a package

function instantiate(require, packageDir, listed) {
	const file = join(packageDir, listed);
	if (!existsSync(file)) throw new Error(`${listed} does not exist: run npm run build first`);
	const exported = require(file);
	const name = basename(listed).replace(/\.(node|credentials)\.js$/, '');
	const Type = exported[name];
	if (typeof Type !== 'function') throw new Error(`${listed} does not export ${name}`);
	return new Type();
}

/** The built nodes and credential of a package, with what the reference needs beside them. */
export function loadPackage(packageDir) {
	const read = (rel) => readFileSync(join(packageDir, rel), 'utf8');
	const pkg = JSON.parse(read('package.json'));
	const require = createRequire(join(packageDir, 'package.json'));
	const nodes = (pkg.n8n?.nodes ?? []).map((listed) => ({ listed, ...instantiate(require, packageDir, listed) }));
	const credentials = (pkg.n8n?.credentials ?? []).map((listed) => instantiate(require, packageDir, listed));
	const manifest = JSON.parse(read('openapi/scope.manifest.json'));
	const openapi = JSON.parse(read(manifest.openapi));
	const specsFile = join(packageDir, 'dist', manifest.output.replace(/\.ts$/, '.js'));
	const specs = existsSync(specsFile) ? (require(specsFile).operationSpecs ?? []) : [];
	const catalogue = JSON.parse(read('openapi/event-types.json'));
	const action = nodes.find((n) => !(n.description.group ?? []).includes('trigger'));
	const trigger = nodes.find((n) => (n.description.group ?? []).includes('trigger'));
	return { pkg, nodes, action, trigger, credentials, manifest, openapi, specs, catalogue };
}

/** The pages the generator owns, as they should be. */
export function expectedPages(packageDir, loaded = loadPackage(packageDir)) {
	const pages = {};
	if (loaded.action) {
		pages['docs/operations.md'] = renderOperations({
			description: loaded.action.description,
			specs: loaded.specs,
			manifest: loaded.manifest,
			openapi: loaded.openapi,
		});
	}
	if (loaded.trigger) {
		const path = join(packageDir, 'docs/trigger.md');
		const current = existsSync(path) ? readFileSync(path, 'utf8') : `${TRIGGER_BEGIN}\n${TRIGGER_END}\n`;
		pages['docs/trigger.md'] = replaceBlock(
			current,
			renderTriggerBlock({ description: loaded.trigger.description, catalogue: loaded.catalogue }),
		);
	}
	return pages;
}

function main(argv) {
	const args = argv.slice(2);
	const packageDir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
	const write = args.includes('--write');
	const pages = expectedPages(packageDir);
	let differs = 0;
	for (const [rel, text] of Object.entries(pages)) {
		const path = join(packageDir, rel);
		if (write) {
			writeFileSync(path, text);
			console.log(`Wrote ${rel}`);
			continue;
		}
		const committed = existsSync(path) ? readFileSync(path, 'utf8') : '';
		if (committed !== text) {
			console.error(`${rel} differs from the generator output. Build, run with --write and commit the result.`);
			differs++;
		} else {
			console.log(`${rel} matches the built nodes`);
		}
	}
	return differs ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv);
}
