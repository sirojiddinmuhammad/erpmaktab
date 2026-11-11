import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSubjectKey, validateSubject } from '../dashboard/subjects.js';

test('makeSubjectKey: band bo\'lsa -2, -3', async () => {
  const taken = new Set(['x-matematika', 'x-matematika-2']);
  assert.equal(await makeSubjectKey('Matematika', async k => taken.has(k)), 'x-matematika-3');
  assert.equal(await makeSubjectKey('Русский язык', async () => false), 'x-русский-язык');
  assert.equal(await makeSubjectKey('!!!', async () => false), null);
  assert.equal(await makeSubjectKey('  ', async () => false), null);
});
test('validateSubject', () => {
  assert.deepEqual(validateSubject({ uz: ' Fizika ', ru: '', alias: ['fiz', ' '] }), { ok: true, value: { uz: 'Fizika', ru: 'Fizika', alias: ['fiz'] } });
  assert.deepEqual(validateSubject({ uz: 'Fizika', ru: 'Физика' }), { ok: true, value: { uz: 'Fizika', ru: 'Физика', alias: [] } });
  for (const bad of [{ uz: '' }, {}, null, { uz: 'a'.repeat(81) }, { uz: 'A', ru: 'b'.repeat(81) }, { uz: 'A', alias: Array(31).fill('x') }, { uz: 'A', alias: 'x' }, { uz: 'A', alias: ['y'.repeat(81)] }])
    assert.equal(validateSubject(bad).ok, false, JSON.stringify(bad));
});
