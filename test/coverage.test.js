import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverage } from '../dashboard/coverage.js';

test('buildCoverage: kutilgan juftliklar, ok va missing', () => {
  const rows = [
    { id: 1, grade: 5, subject_key: 'math', quarter: 2, year: '2026/2027', topics: 34 },
    { id: 2, grade: 5, subject_key: 'history', quarter: 1, year: '2026/2027', topics: 10 },
    { id: 3, grade: 7, subject_key: 'math', quarter: 2, year: '2025/2026', topics: 30 },
  ];
  const c = buildCoverage(rows, { year: '2026/2027', quarter: 2 });
  assert.deepEqual(c.cells['5|math'], { state: 'ok', id: 1, topics: 34 });
  assert.deepEqual(c.cells['5|history'], { state: 'missing' });
  assert.deepEqual(c.cells['7|math'], { state: 'missing' });
  assert.equal(c.cells['6|math'], undefined);
  assert.equal(c.missing, 2);
  assert.deepEqual(c.grades, [1,2,3,4,5,6,7,8,9,10,11]);
  assert.deepEqual(c.subjects, ['history', 'math']);
});
test('buildCoverage: bo\'sh', () => {
  const c = buildCoverage([], { year: '2026/2027', quarter: 1 });
  assert.deepEqual(c.cells, {}); assert.equal(c.missing, 0); assert.deepEqual(c.subjects, []);
});
