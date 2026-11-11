import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, ORIGIN } from './helpers.js';

test('login: token bir marta ishlaydi, cookie beriladi', async () => {
  const p = await startPanel();
  try {
    const link = new URL(p.dash.issueLoginLink());
    assert.equal(link.origin, ORIGIN);
    assert.equal(link.pathname, '/panel/login');
    const r1 = await fetch(p.base + link.pathname + link.search, { redirect: 'manual' });
    assert.equal(r1.status, 302);
    assert.equal(r1.headers.get('location'), '/panel');
    assert.match(r1.headers.get('set-cookie'), /^sid=[0-9a-f]{64}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=604800$/);
    const r2 = await fetch(p.base + link.pathname + link.search, { redirect: 'manual' });
    assert.equal(r2.status, 401);
    assert.match(await r2.text(), /Botga \/panel yozing/);
  } finally { await p.close(); }
});

test('sessiyasiz: API 401 JSON, /panel 401 HTML', async () => {
  const p = await startPanel();
  try {
    const r = await fetch(p.base + '/api/meta');
    assert.equal(r.status, 401);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await r.json(), { error: 'session' });
    const h = await fetch(p.base + '/panel');
    assert.equal(h.status, 401);
    assert.match(h.headers.get('content-type'), /text\/html/);
  } finally { await p.close(); }
});

test('sessiya bilan: panel, meta, plans, filtr xatosi, logout', async () => {
  const p = await startPanel();
  try {
    const cookie = await p.login();
    const h = await fetch(p.base + '/panel', { headers: { cookie } });
    assert.equal(h.status, 200);
    assert.match(await h.text(), /<title>Panel/);

    const m = await (await fetch(p.base + '/api/meta', { headers: { cookie } })).json();
    assert.deepEqual(m, { subjects: [{ key: 'math', uz: 'Matematika', ru: 'Математика' }, { key: 'russian', uz: 'Rus tili', ru: 'Русский язык' }], archivedSubjects: [{ key: 'x-robot', uz: 'Robototexnika', ru: 'Робототехника' }], years: ['2026/2027'], currentYear: '2026/2027' });

    const r = await fetch(p.base + '/api/plans?grade=5&page=2', { headers: { cookie } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.pageSize, 50);
    assert.equal(body.page, 2);
    assert.deepEqual(p.calls.listPlans[0], { offset: 50, limit: 50, filter: { grade: 5, archived: false } });

    const bad = await fetch(p.base + '/api/plans?grade=12', { headers: { cookie } });
    assert.equal(bad.status, 400);
    assert.equal(typeof (await bad.json()).error, 'string');

    const out = await fetch(p.base + '/panel/logout', { method: 'POST', headers: { cookie, origin: ORIGIN }, redirect: 'manual' });
    assert.equal(out.status, 302);
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await fetch(p.base + '/api/meta', { headers: { cookie } })).status, 401);
  } finally { await p.close(); }
});

test('stats, coverage, exists', async () => {
  const p = await startPanel();
  try {
    const cookie = await p.login();
    const q = 'year=2026/2027&quarter=2&medium=uz&grading=normal';
    assert.deepEqual(await (await fetch(p.base + '/api/stats?' + q, { headers: { cookie } })).json(), { total: 3, inQuarter: 1, missing: 1, archived: 0 });
    const c = await (await fetch(p.base + '/api/coverage?' + q, { headers: { cookie } })).json();
    assert.deepEqual(c.cells['6|math'], { state: 'missing' });
    assert.deepEqual(c.names.math, { uz: 'Matematika', ru: 'Математика' });
    assert.equal((await fetch(p.base + '/api/stats?year=2026/2027', { headers: { cookie } })).status, 400);
    const e = await (await fetch(p.base + '/api/plans/exists?grade=5&subject=math&' + q, { headers: { cookie } })).json();
    assert.deepEqual(e, { exists: false, id: null, archived: false });
  } finally { await p.close(); }
});

test('topics va file', async () => {
  const p = await startPanel({ plans: [
    { id: '7', file_id: 'F7', file_name: '5 sinf Matematika.xlsx' },
    { id: '8', file_id: 'F8', file_name: 'old.xls' },
  ] });
  try {
    const cookie = await p.login();
    assert.deepEqual(await (await fetch(p.base + '/api/plans/7/topics', { headers: { cookie } })).json(),
      { rows: [{ n: 1, topic: 'a', hw: '' }, { n: 2, topic: 'b', hw: 'x' }] });
    const x = await fetch(p.base + '/api/plans/8/topics', { headers: { cookie } });
    assert.equal(x.status, 415);
    assert.equal((await fetch(p.base + '/api/plans/99/topics', { headers: { cookie } })).status, 404);
    const f = await fetch(p.base + '/api/plans/7/file', { headers: { cookie } });
    assert.equal(f.status, 200);
    assert.equal(f.headers.get('content-disposition'), `attachment; filename="5 sinf Matematika.xlsx"; filename*=UTF-8''5%20sinf%20Matematika.xlsx`);
    assert.equal(await f.text(), 'xlsx-bytes');
  } finally { await p.close(); }
});

test('boshqa yo\'llar handle=false', async () => {
  const p = await startPanel();
  try {
    assert.equal(await (await fetch(p.base + '/')).text(), 'guide');
    assert.equal(await (await fetch(p.base + '/panelx')).text(), 'guide');
  } finally { await p.close(); }
});
