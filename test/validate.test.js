import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, planKey, findDuplicates, validateFilter } from '../dashboard/validate.js';

const S = new Set(['math', 'history']);
const good = { grade: '5', subject: 'math', quarter: 2, year: '2026/2027', medium: 'uz', fileId: 'F', fileName: 'a.xlsx', topics: '34' };

test('validatePlan: to\'g\'ri qiymat normallashadi', () => {
  assert.deepEqual(validatePlan(good, S), { ok: true, value: { grade: 5, subjectKey: 'math', quarter: 2, year: '2026/2027', medium: 'uz', grading: 'normal', fileId: 'F', fileName: 'a.xlsx', topics: 34 } });
});
test('validatePlan: subjectKey va bo\'sh topics', () => {
  const r = validatePlan({ ...good, subject: undefined, subjectKey: 'history', topics: null, grading: 'bsb' }, S);
  assert.equal(r.ok, true);
  assert.equal(r.value.subjectKey, 'history');
  assert.equal(r.value.topics, null);
  assert.equal(r.value.grading, 'bsb');
});
test('validatePlan: noto\'g\'ri qiymatlar rad etiladi', () => {
  for (const bad of [{ grade: 0 }, { grade: 12 }, { grade: '5a' }, { quarter: 5 }, { medium: 'en' }, { grading: 'x' }, { year: '2026/2028' }, { year: '2026' }, { subject: 'nope' }, { fileId: '' }, { fileName: '' }, { topics: -1 }]) {
    const r = validatePlan({ ...good, ...bad }, S);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(validatePlan(null, S).ok, false);
});
test('planKey va findDuplicates', () => {
  const v = validatePlan(good, S).value;
  assert.equal(planKey(v), '5|math|2|2026/2027|uz|normal');
  assert.deepEqual([...findDuplicates([v, { ...v, grade: 6 }, v])], [0, 2]);
  assert.deepEqual([...findDuplicates([v, { ...v, grading: 'bsb' }])], []);
});
test('validateFilter', () => {
  assert.deepEqual(validateFilter(new URLSearchParams(''), S), { ok: true, value: { page: 1, archived: false } });
  const r = validateFilter(new URLSearchParams('grade=5&subject=math&quarter=2&year=2026/2027&medium=ru&grading=bsb&q=al&page=3&archived=1'), S);
  assert.deepEqual(r, { ok: true, value: { grade: 5, subjectKey: 'math', quarter: 2, year: '2026/2027', medium: 'ru', grading: 'bsb', q: 'al', page: 3, archived: true } });
  for (const q of ['grade=12', 'page=0', 'subject=nope', 'medium=en', 'year=26'])
    assert.equal(validateFilter(new URLSearchParams(q), S).ok, false, q);
});
