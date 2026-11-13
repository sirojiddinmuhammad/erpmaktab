import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, ORIGIN } from './helpers.js';

const post = (p, cookie, url, data, origin = ORIGIN) =>
  fetch(p.base + url, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(data) });
const row = (id, over = {}) => ({ id, file_id: 'TG' + id, file_name: 'reja.xlsx', caption: null, source: 'Kanal', posted_at: new Date('2026-11-09T08:00:00Z'), ...over });

test('GET /api/inbox', async () => {
  const p = await startPanel({ inbox: [row(1, { caption: '<b>x</b>' })] });
  try {
    const cookie = await p.login();
    assert.deepEqual(await (await fetch(p.base + '/api/inbox', { headers: { cookie } })).json(),
      { count: 1, rows: [{ id: 1, fileName: 'reja.xlsx', caption: '<b>x</b>', source: 'Kanal', postedAt: '2026-11-09T08:00:00.000Z' }] });
  } finally { await p.close(); }
});

test('take: izoh va sanadan taxmin, qayta yuborilmaydi', async () => {
  const p = await startPanel({ inbox: [row(1, { caption: '6-sinf Matematika' })] });
  try {
    const cookie = await p.login();
    const r = await post(p, cookie, '/api/inbox/take', { ids: [1] });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { rows: [{ inboxId: 1, fileId: 'TG1', fileName: 'reja.xlsx', topics: 2,
      guess: { grade: 6, grades: [6], subject: 'math', medium: 'uz', grading: null, year: '2026/2027', quarter: 2 } }] });
    assert.equal(p.calls.sendDocument.length, 0);
    assert.deepEqual(p.calls.markInbox, [{ ids: [1], field: 'taken_at' }]);
  } finally { await p.close(); }
});

test('take: fayl nomidagi qiymat sanadan ustun', async () => {
  const p = await startPanel({ inbox: [row(1, { file_name: '5 sinf 3-chorak 2025-2026.xls' })] });
  try {
    const cookie = await p.login();
    const b = await (await post(p, cookie, '/api/inbox/take', { ids: [1] })).json();
    assert.deepEqual(b.rows[0].guess, { grade: 5, grades: [5], subject: null, medium: 'uz', grading: null, year: '2025/2026', quarter: 3 });
    assert.equal(b.rows[0].topics, null);
  } finally { await p.close(); }
});

test('take: bitta fayl yuklanmasa qolganlari olinadi', async () => {
  const p = await startPanel({
    inbox: [row(1), row(2)],
    deps: { downloadFile: async id => { if (id === 'TG1') throw new Error('gone'); return Buffer.from('x'); } },
  });
  try {
    const cookie = await p.login();
    const b = await (await post(p, cookie, '/api/inbox/take', { ids: [1, 2] })).json();
    assert.deepEqual(b.rows[0], { inboxId: 1, error: 'telegram' });
    assert.equal(b.rows[1].inboxId, 2);
    assert.deepEqual(p.calls.markInbox, [{ ids: [2], field: 'taken_at' }]);
  } finally { await p.close(); }
});

test('take/dismiss tekshiruvlari va Origin', async () => {
  const p = await startPanel({ inbox: [row(1)] });
  try {
    const cookie = await p.login();
    assert.equal((await post(p, cookie, '/api/inbox/take', { ids: Array.from({ length: 51 }, (_, i) => i + 1) })).status, 400);
    assert.equal((await post(p, cookie, '/api/inbox/take', { ids: ['a'] })).status, 400);
    assert.equal((await post(p, cookie, '/api/inbox/take', { ids: [1] }, 'https://evil.example')).status, 403);
    assert.deepEqual(await (await post(p, cookie, '/api/inbox/dismiss', { ids: [1] })).json(), { ok: true, n: 1 });
    assert.deepEqual(p.calls.markInbox, [{ ids: [1], field: 'dismissed_at' }]);
  } finally { await p.close(); }
});
