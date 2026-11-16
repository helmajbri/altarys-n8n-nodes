// The documentation generator renders every operation, parameter, output field and event it is
// given, and refuses a page without its generated block.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	collectOperations,
	githubSlug,
	renderOperations,
	renderTriggerBlock,
	replaceBlock,
	TRIGGER_BEGIN,
	TRIGGER_END,
} from '../generate-docs.mjs';

const show = (operation) => ({ show: { resource: ['thing'], operation: [operation] } });

const DESCRIPTION = {
	displayName: 'Sample',
	description: 'Manage things in Sample',
	group: ['transform'],
	properties: [
		{ displayName: 'Resource', name: 'resource', type: 'options', options: [{ name: 'Thing', value: 'thing' }], default: 'thing' },
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			displayOptions: { show: { resource: ['thing'] } },
			options: [
				{ name: 'Delete', value: 'delete', action: 'Delete thing', description: 'Delete a thing. It cannot be recovered.' },
				{ name: 'Get Many', value: 'getAll', action: 'Get many things', description: 'Get many things' },
			],
			default: 'getAll',
		},
		{ displayName: 'Thing ID', name: 'thingId', type: 'string', required: true, default: '', displayOptions: show('delete') },
		{ displayName: 'Return All', name: 'returnAll', type: 'boolean', default: false, description: 'Whether to return all results', displayOptions: show('getAll') },
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: { minValue: 1, maxValue: 100 },
			displayOptions: { show: { resource: ['thing'], operation: ['getAll'], returnAll: [false] } },
		},
		{
			displayName: 'Filters',
			name: 'filters',
			type: 'collection',
			default: {},
			displayOptions: show('getAll'),
			options: [{ displayName: 'State', name: 'state', type: 'options', options: [{ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }], default: 'on' }],
		},
	],
};

const SPECS = [
	{ resource: 'thing', operation: 'delete', output: 'deleted', destructive: true, idempotency: 'none', uuidParameters: ['thingId'], safeParameters: [], outputOmit: [] },
	{ resource: 'thing', operation: 'getAll', output: 'list', itemSchema: 'Thing', idempotency: 'none', uuidParameters: [], safeParameters: [], outputOmit: ['price'] },
];
const OPENAPI = { components: { schemas: { Thing: { properties: { id: {}, name: {}, price: {}, price_cents: {}, currency: {} } } } } };

test('collectOperations groups the parameters each operation shows', () => {
	const [thing] = collectOperations(DESCRIPTION);
	assert.equal(thing.name, 'Thing');
	assert.deepEqual(thing.operations.map((o) => o.value), ['delete', 'getAll']);
	assert.deepEqual(thing.operations[0].parameters.map((p) => p.name), ['thingId']);
	assert.deepEqual(thing.operations[1].parameters.map((p) => p.name), ['returnAll', 'limit', 'filters']);
});

test('the operations page lists every operation with parameters, output and behaviour', () => {
	const page = renderOperations({ description: DESCRIPTION, specs: SPECS, openapi: OPENAPI });
	assert.match(page, /^# Sample node operations\n\nUse the \*\*Sample\*\* node to manage things in Sample\. /);
	assert.match(page, /\| \[Thing\]\(#thing\) \| \[Delete\]\(#delete-thing\), \[Get Many\]\(#get-many-things\) \|/);
	assert.match(page, /\n### Delete thing\n\nDelete a thing\. It cannot be recovered\.\n/);
	assert.match(page, /\| Thing ID \| Text \| Yes \| Must be an ID in UUID form\. \|/);
	assert.match(page, /\*\*Output:\*\* One item: `\{"deleted": true\}`\.\n\nThis operation cannot be undone\./);
	assert.match(page, /\| Limit \| Number \| No \| From 1 to 100\. Default: `50`\. Shown when \*\*Return All\*\* is off\. \|/);
	assert.match(page, /\| Filters > State \| Option \| No \| One of: `On`, `Off`\. Default: `On`\. \|/);
	// The omitted major-unit figure is not listed as an output field.
	assert.match(page, /One item per result, with these fields: `id`, `name`, `price_cents`, `currency`\./);
	assert.equal(githubSlug('Get many things'), 'get-many-things');
});

test('a field list most operations of a resource share is listed once and linked', () => {
	const description = structuredClone(DESCRIPTION);
	description.properties[1].options.push({ name: 'Get', value: 'get', action: 'Get thing', description: 'Get a thing' });
	const specs = [...SPECS, { resource: 'thing', operation: 'get', output: 'item', itemSchema: 'Thing', idempotency: 'none', uuidParameters: [], safeParameters: [], outputOmit: ['price'] }];
	const page = renderOperations({ description, specs, openapi: OPENAPI });
	assert.match(
		page,
		/\n### Thing fields\n\nThe operations below that return a record of this resource return it with these fields: `id`, `name`, `price_cents`, `currency`\.\n/,
	);
	assert.match(page, /\*\*Output:\*\* One item, with the \[Thing fields\]\(#thing-fields\)\./);
	assert.match(page, /\*\*Output:\*\* One item per result, with the \[Thing fields\]\(#thing-fields\)\./);
});

test('a range the description already states is not repeated', () => {
	const description = structuredClone(DESCRIPTION);
	description.properties[4].description = 'How many to return, from 1 to 100';
	const page = renderOperations({ description, specs: SPECS, openapi: OPENAPI });
	assert.match(page, /\| Limit \| Number \| No \| How many to return, from 1 to 100\. Default: `50`\./);
});

test('a dropped operation is visible in the rendered page', () => {
	const fewer = structuredClone(DESCRIPTION);
	fewer.properties[1].options.pop();
	const page = renderOperations({ description: fewer, specs: SPECS, openapi: OPENAPI });
	assert.doesNotMatch(page, /### Get many things/);
});

test('the trigger block lists the parameters and every event, inside the markers', () => {
	const trigger = {
		displayName: 'Sample Trigger',
		properties: [
			{ displayName: 'Events', name: 'events', type: 'multiOptions', typeOptions: { loadOptionsMethod: 'x' }, required: true, default: [] },
			{ displayName: 'Secret', name: 'secret', type: 'hidden', default: '' },
		],
	};
	const catalogue = { provider: [{ type: 'thing.created', description: 'A thing was created' }], customer: [{ type: 'bill.paid', description: 'A bill | was paid.' }] };
	const block = renderTriggerBlock({ description: trigger, catalogue });
	assert.ok(block.startsWith(TRIGGER_BEGIN) && block.endsWith(TRIGGER_END));
	assert.match(block, /\| Events \| Options \| Yes \| n8n loads the list from your account\. \|/);
	assert.doesNotMatch(block, /Secret/);
	assert.match(block, /### Events for a provider key\n\n\| Event \| When it is sent \|\n\|---\|---\|\n\| `thing\.created` \| A thing was created\. \|/);
	assert.match(block, /\| `bill\.paid` \| A bill \\\| was paid\. \|/);
	assert.match(block, /<!-- vale off -->[\s\S]*<!-- vale on -->/);
	const page = `# Trigger\n\nIntro.\n\n${TRIGGER_BEGIN}\nold\n${TRIGGER_END}\n\nAfter.\n`;
	assert.equal(replaceBlock(page, block), `# Trigger\n\nIntro.\n\n${block}\n\nAfter.\n`);
	assert.throws(() => replaceBlock('# Trigger\n', block), /no '<!-- BEGIN GENERATED/);
});
