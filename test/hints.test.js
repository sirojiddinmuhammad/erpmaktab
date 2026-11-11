import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessSubject, parseFileName } from '../hints.js';

test('guessSubject: keyOf birinchi o\'rinda', () => {
  assert.equal(guessSubject('5_sinf_xyz.xlsx', () => 'custom'), 'custom');
});
test('guessSubject: keyOf null bo\'lsa lug\'atga tushadi', () => {
  assert.equal(guessSubject('@kanal 5 sinf Matematika 2 chorak.xlsx', () => null), 'math');
});
test('guessSubject: hech narsa topilmasa null', () => {
  assert.equal(guessSubject('qwerty.xlsx', () => null), null);
});
test('parseFileName: kirillcha sinf va chorak', () => {
  const h = parseFileName('6 кл Русский язык 2 четв.xlsx');
  assert.equal(h.grade, 6);
});
