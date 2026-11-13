import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { startPanel, ORIGIN } from './helpers.js';

const post = (p, cookie, url, body, headers = {}) =>
  fetch(p.base + url, { method: 'POST', headers: { cookie, origin: ORIGIN, ...headers }, body });

test('files: kirillcha nom, taxmin, vaqtinchalik fayl o\'chadi', async () => {
  const p = await startPanel();
  try {
    const cookie = await p.login();
    const name = '6 кл Русский язык 2 четв 2026-2027.xlsx';
    const r = await post(p, cookie, '/api/files', Buffer.from('abc'), { 'x-file-name': encodeURIComponent(name), 'content-type': 'application/octet-stream' });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.deepEqual(b, { fileId: 'FILE1', fileName: name, topics: 2, guess: { grade: 6, grades: [6], subject: 'russian', medium: 'ru', grading: null, year: '2026/2027', quarter: 2 } });
    assert.deepEqual(p.calls.sendDocument, [{ size: 3, fileName: name }]);
    assert.deepEqual((await fs.readdir(p.tmp)).filter(f => f !== 'index.html'), []);
  } finally { await p.close(); }
});

test('files: .xls topics null, readRows xatosi topics null', async () => {
  const p = await startPanel({ deps: { readRows: async () => { throw new Error('bad'); } } });
  try {
    const cookie = await p.login();
    for (const n of ['a.xls', 'b.xlsx']) {
      const r = await post(p, cookie, '/api/files', Buffer.from('abc'), { 'x-file-name': n });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).topics, null);
    }
  } finally { await p.close(); }
});

test('files: 5 MB dan katta 413, .pdf 415, Telegram xatosi 502', async () => {
  const p = await startPanel();
  try {
    const cookie = await p.login();
    const big = await post(p, cookie, '/api/files', Buffer.alloc(5_000_001), { 'x-file-name': 'a.xlsx' });
    assert.equal(big.status, 413);
    const pdf = await post(p, cookie, '/api/files', Buffer.from('x'), { 'x-file-name': 'a.pdf' });
    assert.equal(pdf.status, 415);
    assert.equal(p.calls.sendDocument.length, 0);
  } finally { await p.close(); }
  const q = await startPanel({ deps: { sendDocument: async () => { throw new Error('tg down'); } } });
  try {
    const cookie = await q.login();
    const r = await post(q, cookie, '/api/files', Buffer.from('x'), { 'x-file-name': 'a.xlsx' });
    assert.equal(r.status, 502);
    assert.deepEqual(await r.json(), { error: 'telegram' });
  } finally { await q.close(); }
});

test('batch: takrorlar va noto\'g\'ri qatorlar o\'tkaziladi', async () => {
  const p = await startPanel();
  try {
    const cookie = await p.login();
    const row = { grade: 5, subject: 'math', quarter: 2, year: '2026/2027', medium: 'uz', grading: 'normal', fileId: 'F', fileName: 'a.xlsx', topics: 3 };
    const r = await post(p, cookie, '/api/plans/batch', JSON.stringify({ rows: [row, row, { ...row, grade: 6 }, { ...row, grade: 13 }] }), { 'content-type': 'application/json' });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.created, 1);
    assert.equal(b.replaced, 0);
    assert.deepEqual(b.skipped.map(s => s.index), [0, 1, 3]);
    assert.equal(b.skipped[0].error, 'Takror');
    assert.equal(p.calls.savePlan.length, 1);
    assert.equal(p.calls.savePlan[0].grade, 6);
  } finally { await p.close(); }
});

test('replace, archive, origin, yomon JSON', async () => {
  const p = await startPanel({ plans: [{ id: '7', grade: 5, subject_key: 'math', quarter: 2, year: '2026/2027', medium: 'uz', grading: 'normal', file_id: 'OLD', file_name: 'a.xlsx' }] });
  try {
    const cookie = await p.login();
    const ok = await post(p, cookie, '/api/plans/7/replace', JSON.stringify({ fileId: 'NEW', fileName: 'b.xlsx', topics: 4 }));
    assert.deepEqual(await ok.json(), { ok: true });
    assert.equal(p.calls.savePlan[0].fileId, 'NEW');
    assert.equal(p.calls.savePlan[0].subjectKey, 'math');
    assert.equal((await post(p, cookie, '/api/plans/99/replace', JSON.stringify({ fileId: 'N', fileName: 'b.xlsx' }))).status, 404);
    assert.deepEqual(await (await post(p, cookie, '/api/plans/7/archive', '')).json(), { ok: true });
    assert.deepEqual(p.calls.archive, [7]);
    assert.deepEqual(await (await post(p, cookie, '/api/plans/7/restore', '')).json(), { ok: true });
    assert.equal((await post(p, cookie, '/api/plans/batch', '{bad')).status, 400);
    const evil = await fetch(p.base + '/api/plans/7/archive', { method: 'POST', headers: { cookie, origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    assert.deepEqual(p.calls.archive, [7]);
  } finally { await p.close(); }
});

test('files: "1-4 sinf" oralig\'i — grades [1,2,3,4]', async () => {
  const p = await startPanel();
  try {
    const cookie = await p.login();
    for (const [name, grades] of [['1-4 sinf Tarbiya.xlsx', [1, 2, 3, 4]], ['5–6 кл Математика.xlsx', [5, 6]], ['7 sinf.xlsx', [7]], ['reja.xlsx', []], ['4-1 sinf.xlsx', [1]], ['1-12 sinf.xlsx', [12].filter(() => false)]]) {
      const b = await (await post(p, cookie, '/api/files', Buffer.from('x'), { 'x-file-name': encodeURIComponent(name) })).json();
      assert.deepEqual(b.guess.grades, grades, name);
      assert.equal(b.guess.grade, grades[0] ?? null, name);
    }
  } finally { await p.close(); }
});

test('files: til fayl nomidan aniqlanadi', async () => {
  const p = await startPanel();
  try {
    const cookie = await p.login();
    for (const [name, medium] of [
      ['Математика 5 кл.xlsx', 'ru'],
      ['Matematika 5 sinf.xlsx', 'uz'],
      ['Математика 5 синф.xlsx', 'uz'],       // o'zbekcha kirill
      ['Русский язык 6 класс 2 четверть.xlsx', 'ru'],
      ['Rus tili 6 sinf.xlsx', 'uz'],
      ['Ona tili.xlsx', 'uz'],
      ['Литература.xlsx', 'ru'],
      ['Ўқиш 2 синф.xlsx', 'uz'],
      ['2026.xlsx', null],
    ]) {
      const b = await (await post(p, cookie, '/api/files', Buffer.from('x'), { 'x-file-name': encodeURIComponent(name) })).json();
      assert.equal(b.guess.medium, medium, name);
    }
  } finally { await p.close(); }
});
