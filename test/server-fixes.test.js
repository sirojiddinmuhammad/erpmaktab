import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startPanel, ORIGIN } from './helpers.js';
import { parseFileName } from '../hints.js';

const raw = (base, line) => new Promise((resolve, reject) => {
  const { port } = new URL(base);
  const s = net.connect(Number(port), '127.0.0.1', () => s.write(`${line}\r\nHost: x\r\nConnection: close\r\n\r\n`));
  let buf = '';
  s.on('data', d => { buf += d; });
  s.on('end', () => resolve(buf));
  s.on('error', reject);
  s.setTimeout(2000, () => { s.destroy(); resolve(buf || 'TIMEOUT'); });
});

test('"GET //" jarayonni yiqitmaydi', async () => {
  const p = await startPanel();
  try {
    const r = await raw(p.base, 'GET // HTTP/1.1');
    assert.match(r, /^HTTP\/1\.1 200/);
    assert.equal((await fetch(p.base + '/api/meta')).status, 401);
  } finally { await p.close(); }
});

test("yuklab olish: apostrofli nom RFC 5987 bo'yicha kodlanadi", async () => {
  const p = await startPanel({ plans: [{ id: '7', file_id: 'F', file_name: "Ona tili o'zbek.xlsx" }] });
  try {
    const cookie = await p.login();
    const f = await fetch(p.base + '/api/plans/7/file', { headers: { cookie } });
    const cd = f.headers.get('content-disposition');
    assert.match(cd, /filename\*=UTF-8''Ona%20tili%20o%27zbek\.xlsx/);
    assert.equal(cd.split("UTF-8''")[1].includes("'"), false);
  } finally { await p.close(); }
});

test("bot uchun parseFileName o'zgarmagan, dashboard esa \"четв\" ni chorak deb oladi", async () => {
  assert.equal(parseFileName('6 кл Русский язык 2 четв.xlsx').quarter, undefined);
  const p = await startPanel();
  try {
    const cookie = await p.login();
    const r = await fetch(p.base + '/api/files', { method: 'POST', headers: { cookie, origin: ORIGIN, 'x-file-name': encodeURIComponent('6 кл 2 четв.xlsx') }, body: 'x' });
    assert.equal((await r.json()).guess.quarter, 2);
  } finally { await p.close(); }
});

test("batch: bitta qator DB xatosi qolganlarini to'xtatmaydi", async () => {
  let n = 0;
  const p = await startPanel({ db: { async savePlan(v) { if (++n === 2) throw new Error('pool'); return { is_new: true }; } } });
  try {
    const cookie = await p.login();
    const row = { subject: 'math', quarter: 2, year: '2026/2027', medium: 'uz', fileId: 'F', fileName: 'a.xlsx' };
    const r = await fetch(p.base + '/api/plans/batch', { method: 'POST', headers: { cookie, origin: ORIGIN }, body: JSON.stringify({ rows: [5, 6, 7].map(grade => ({ ...row, grade })) }) });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { created: 2, replaced: 0, skipped: [{ index: 1, error: 'server' }] });
  } finally { await p.close(); }
});
