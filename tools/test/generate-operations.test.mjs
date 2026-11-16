// The description joiner punctuates the way n8n's lint expects: one sentence without a final
// period, several sentences with one.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sentences } from '../generate-operations.mjs';

test('one sentence has no final period, several sentences end with one', () => {
	assert.equal(sentences(['ID of the customer']), 'ID of the customer');
	assert.equal(sentences(['ID of the customer.']), 'ID of the customer');
	assert.equal(sentences(['Set this or Plan ID. It is required']), 'Set this or Plan ID. It is required.');
	assert.equal(sentences(['Either \'ssd\' or \'nvme\'', 'Decimal number written as text']), "Either 'ssd' or 'nvme'. Decimal number written as text.");
	assert.equal(sentences([undefined, '']), undefined);
	// "e.g. 1250" is not a sentence break.
	assert.equal(sentences(['Amount, e.g. 1250 for 12.50']), 'Amount, e.g. 1250 for 12.50');
});
