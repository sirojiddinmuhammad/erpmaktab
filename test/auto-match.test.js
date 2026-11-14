import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAutoConfig, canAuto, gradeOfClass, needsGradingAnswer, buildItems } from '../auto/match.js';

test('readAutoConfig parses testers and limits with defaults', () => {
  const c = readAutoConfig({ AUTO_TESTERS: ' 111, 222 ,x' });
  assert.deepEqual([...c.testers], [111, 222]);
  assert.equal(c.concurrency, 2);
  assert.equal(c.maxItems, 1);
  assert.equal(readAutoConfig({ AUTO_MAX_ITEMS: '50' }).maxItems, 50);
  assert.equal(readAutoConfig({ AUTO_MAX_ITEMS: '-3' }).maxItems, 1);
  assert.equal(readAutoConfig({ AUTO_CONCURRENCY: '4' }).concurrency, 4);
  assert.equal(readAutoConfig({}).testers.size, 0);
});

test('canAuto allows the admin and testers only', () => {
  assert.equal(canAuto(5, { adminId: 5, testers: new Set() }), true);
  assert.equal(canAuto(7, { adminId: 5, testers: new Set([7]) }), true);
  assert.equal(canAuto(8, { adminId: 5, testers: new Set([7]) }), false);
  assert.equal(canAuto(8, { adminId: 0, testers: new Set() }), false);
});

test('gradeOfClass reads the grade from class names', () => {
  assert.equal(gradeOfClass('5-A'), 5);
  assert.equal(gradeOfClass('11-В'), 11);
  assert.equal(gradeOfClass('5А'), 5);
  assert.equal(gradeOfClass('5-A (1-guruh)'), 5);
  assert.equal(gradeOfClass('4-A (1-А)'), 4);
  assert.equal(gradeOfClass('12-A'), null);
  assert.equal(gradeOfClass('A'), null);
  assert.equal(gradeOfClass(''), null);
});

test('needsGradingAnswer only for grades 5–11 without an answer', () => {
  const c = names => names.map(n => ({ className: n, subjects: [] }));
  assert.equal(needsGradingAnswer(c(['4-A', '3-B']), null), false);
  assert.equal(needsGradingAnswer(c(['4-A', '7-B']), null), true);
  assert.equal(needsGradingAnswer(c(['7-B']), 'bsb'), false);
});

const classes = [
  { groupId: 'g4', className: '4-A', subjects: [{ id: 's1', name: 'Математика' }, { id: 's2', name: 'Информатика' }, { id: 's9', name: 'Zzz qqq' }] },
  { groupId: 'g7', className: '7-B', subjects: [{ id: 's2', name: 'Информатика' }] },
  { groupId: 'gx', className: 'Kruzhok', subjects: [{ id: 's2', name: 'Информатика' }] },
];
const keyOf = name => ({ 'Математика': 'math', 'Информатика': 'info' })[name] ?? null;
function finder(found) {
  const calls = [];
  const findPlan = async k => { calls.push(k); return found(k) ? { id: calls.length, topics: 34, file_id: 'f' } : null; };
  return { calls, findPlan };
}
const base = over => ({ classes, quarter: 2, year: '2026/2027', accountGrading: 'bsb', accountMedium: 'uz', keyOf, allowed: null, maxItems: 10, ...over });

test('buildItems matches plans with the exact key fields', async () => {
  const f = finder(() => true);
  const items = await buildItems(base({ findPlan: f.findPlan }));
  assert.deepEqual(f.calls[0], { grade: 4, subjectKey: 'math', quarter: 2, year: '2026/2027', medium: 'uz', grading: 'normal' });
  assert.equal(items.find(i => i.groupId === 'g7').grading, 'bsb');
  assert.equal(items.find(i => i.groupId === 'g4' && i.subjectId === 's1').grading, 'normal');
});

test('buildItems explains why an item has no plan', async () => {
  const f = finder(k => k.subjectKey === 'math');
  const items = await buildItems(base({ findPlan: f.findPlan }));
  const by = (g, s) => items.find(i => i.groupId === g && i.subjectId === s);
  assert.equal(by('g4', 's1').reason, null);
  assert.equal(by('g4', 's2').reason, 'noplan');
  assert.equal(by('g4', 's9').reason, 'subject');
  assert.equal(by('gx', 's2').reason, 'grade');
  assert.equal(by('g4', 's2').plan, null);
  assert.equal(by('g4', 's2').selected, false);
});

test('buildItems selects only the first maxItems items that have a plan', async () => {
  const f = finder(() => true);
  const items = await buildItems(base({ findPlan: f.findPlan, maxItems: 1 }));
  assert.deepEqual(items.filter(i => i.selected).map(i => [i.groupId, i.subjectId]), [['g4', 's1']]);
  assert.equal(items.filter(i => i.plan).length, 3);
});

test('buildItems medium follows the account answer and per-class overrides', async () => {
  const ru = await buildItems(base({ findPlan: finder(() => true).findPlan, accountMedium: 'ru' }));
  assert.ok(ru.every(i => i.medium === 'ru'));
  const both = await buildItems(base({ findPlan: finder(() => true).findPlan, accountMedium: 'both', mediumOverride: { g7: 'ru' } }));
  assert.equal(both.find(i => i.groupId === 'g7').medium, 'ru');
  assert.equal(both.find(i => i.groupId === 'g4').medium, 'uz');
});

test('buildItems respects the allowed subject keys', async () => {
  const items = await buildItems(base({ findPlan: finder(() => true).findPlan, allowed: new Set(['info']) }));
  assert.equal(items.find(i => i.subjectId === 's1').reason, 'subject');
});

test('buildItems items carry index, names and default whole-class subgroup', async () => {
  const items = await buildItems(base({ findPlan: finder(() => true).findPlan }));
  assert.deepEqual(items.map(i => i.i), items.map((_, k) => k));
  assert.equal(items[0].className, '4-A');
  assert.equal(items[0].subjectName, 'Математика');
  assert.equal(items[0].subgroupId, '');
  assert.equal(items[0].subgroupName, 'Весь класс');
});
