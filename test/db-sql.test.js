import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgres://x@localhost/none';
const { buildPlanFilter, SCHEMA } = await import('../db.js');

test('buildPlanFilter: standart — faqat arxivlanmaganlar', () => {
  assert.deepEqual(buildPlanFilter({}), { where: 'where archived_at is null', args: [] });
});
test('buildPlanFilter: hamma filtrlar tartib bilan', () => {
  const r = buildPlanFilter({ medium: 'uz', grade: 5, q: 'mat', archived: true });
  assert.equal(r.where, 'where medium = $1 and grade = $2 and (file_name ilike $3 or subject_key ilike $3) and archived_at is not null');
  assert.deepEqual(r.args, ['uz', 5, '%mat%']);
  const all = buildPlanFilter({ medium: 'ru', quarter: 2, year: '2026/2027', grade: 7, grading: 'bsb', subjectKey: 'math', q: 'a%b' });
  assert.equal(all.where, 'where medium = $1 and quarter = $2 and year = $3 and grade = $4 and grading = $5 and subject_key = $6 and (file_name ilike $7 or subject_key ilike $7) and archived_at is null');
  assert.deepEqual(all.args, ['ru', 2, '2026/2027', 7, 'bsb', 'math', '%a\\%b%']);
});
test('SCHEMA: archived_at faqat ADD COLUMN bilan', () => {
  assert.match(SCHEMA, /alter table plans add column if not exists archived_at timestamptz;/);
  assert.doesNotMatch(SCHEMA.split('archived_at')[1] ?? '', /\b(drop table|truncate|delete from)\b/i);
});

test('SCHEMA: plan_inbox va subject_extra.archived_at faqat qo\'shish bilan', () => {
  assert.match(SCHEMA, /create table if not exists plan_inbox \(/);
  assert.match(SCHEMA, /alter table subject_extra add column if not exists archived_at timestamptz;/);
  assert.doesNotMatch(SCHEMA.split('plan_inbox')[1] ?? '', /\b(drop table|truncate|delete from)\b/i);
});

test('SCHEMA: auto_grading va auto_medium faqat ADD COLUMN bilan', () => {
  assert.match(SCHEMA, /alter table accounts add column if not exists auto_grading text;/);
  assert.match(SCHEMA, /alter table accounts add column if not exists auto_medium text;/);
});

test('setAutoGrading / setAutoMedium rad etadi noto\'g\'ri qiymatni (bazaga bormasdan)', async () => {
  const db = await import('../db.js');
  await assert.rejects(db.setAutoGrading(1, 'x'), /grading/);
  await assert.rejects(db.setAutoMedium(1, 'en'), /medium/);
});

test('FIND_ACTIVE_PLAN_SQL: faqat arxivlanmagan, kalitning 6 maydoni', async () => {
  const db = await import('../db.js');
  assert.match(db.FIND_ACTIVE_PLAN_SQL, /archived_at is null/);
  for (const c of ['grade=$1', 'subject_key=$2', 'quarter=$3', 'year=$4', 'medium=$5', 'grading=$6'])
    assert.ok(db.FIND_ACTIVE_PLAN_SQL.includes(c), c);
  assert.match(db.FIND_ACTIVE_PLAN_SQL, /file_id/);
});
