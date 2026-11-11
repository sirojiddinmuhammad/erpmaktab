import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, ORIGIN } from './helpers.js';

const post = (p, cookie, url, data, origin = ORIGIN) =>
  fetch(p.base + url, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(data ?? {}) });

test('fanlar: ro\'yxat, qo\'shish, tahrirlash', async () => {
  const p = await startPanel();
  try {
    const cookie = await p.login();
    const list = await (await fetch(p.base + '/api/subjects', { headers: { cookie } })).json();
    assert.deepEqual(list.rows[0], { key: 'math', uz: 'Matematika', ru: 'Математика', alias: [], plans: 2, archived: false });

    const r = await post(p, cookie, '/api/subjects', { uz: 'Fizika' });
    assert.deepEqual(await r.json(), { key: 'x-fizika' });
    assert.deepEqual(p.calls.subjects[0], ['insert', { key: 'x-fizika', uz: 'Fizika', ru: 'Fizika', alias: [] }]);
    assert.equal(p.calls.reload, 1);

    assert.deepEqual(await (await post(p, cookie, '/api/subjects', { uz: 'Fizika' })).json(), { key: 'x-fizika-2' });
    assert.equal((await post(p, cookie, '/api/subjects', { uz: '!!!' })).status, 400);
    assert.equal((await post(p, cookie, '/api/subjects', { uz: '' })).status, 400);

    assert.deepEqual(await (await post(p, cookie, '/api/subjects/x-fizika', { uz: 'Fizika 2', ru: 'Физика', alias: ['fiz'] })).json(), { ok: true });
    assert.deepEqual(p.calls.subjects.at(-1), ['update', 'x-fizika', { uz: 'Fizika 2', ru: 'Физика', alias: ['fiz'] }]);
    assert.equal((await post(p, cookie, '/api/subjects/x-yoq', { uz: 'A' })).status, 404);
    assert.equal(p.calls.reload, 3);
  } finally { await p.close(); }
});

test('fanlar: arxiv, qaytarish, yomon kalit, Origin', async () => {
  const p = await startPanel();
  try {
    const cookie = await p.login();
    assert.deepEqual(await (await post(p, cookie, '/api/subjects/math/archive', { withPlans: true })).json(), { ok: true });
    assert.deepEqual(p.calls.subjects.at(-1), ['archive', 'math', true]);
    await post(p, cookie, '/api/subjects/math/archive', {});
    assert.deepEqual(p.calls.subjects.at(-1), ['archive', 'math', false]);
    assert.deepEqual(await (await post(p, cookie, '/api/subjects/math/restore')).json(), { ok: true });
    assert.deepEqual(p.calls.subjects.at(-1), ['restore', 'math']);
    assert.equal((await post(p, cookie, '/api/subjects/' + encodeURIComponent('x-русский') + '/restore')).status, 200);
    assert.equal((await post(p, cookie, '/api/subjects/..%2Fx/archive')).status, 404);
    assert.equal((await post(p, cookie, '/api/subjects/math/archive', {}, 'https://evil.example')).status, 403);
    assert.equal(p.calls.reload, 4);
  } finally { await p.close(); }
});
