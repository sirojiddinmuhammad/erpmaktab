import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, ORIGIN } from './helpers.js';

const post = (p, cookie, url, data, origin = ORIGIN) =>
  fetch(p.base + url, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(data ?? {}) });
const err = code => Object.assign(new Error(code), { code });
const fakeDrive = (over = {}) => ({
  email: 'bot@proj.iam.gserviceaccount.com',
  folderInfo: async id => ({ id, name: 'Ish rejalar' }),
  listXlsx: async () => ({ truncated: false, files: [
    { id: 'n1', name: '5 sinf Matematika.xlsx', size: 100, modifiedTime: '2026-11-10T08:00:00Z', path: '2-chorak' },
    { id: 'n2', name: 'b.xlsx', size: 200, modifiedTime: '2026-11-10T08:00:00Z', path: '' },
    { id: 'old', name: 'c.xlsx', size: 300, modifiedTime: '2026-11-10T08:00:00Z', path: '' },
    { id: 'big', name: 'd.xlsx', size: 6_000_000, modifiedTime: '2026-11-10T08:00:00Z', path: '' },
  ] }),
  ...over,
});

test('GET /api/drive: sozlanmagan va sozlangan', async () => {
  const a = await startPanel();
  try {
    const cookie = await a.login();
    assert.deepEqual(await (await fetch(a.base + '/api/drive', { headers: { cookie } })).json(), { configured: false, email: null, folder: null });
  } finally { await a.close(); }
  const b = await startPanel({ deps: { drive: fakeDrive() }, meta: { drive_folder_id: 'ABCDEFGHIJK', drive_folder_name: 'Ish rejalar' } });
  try {
    const cookie = await b.login();
    assert.deepEqual(await (await fetch(b.base + '/api/drive', { headers: { cookie } })).json(),
      { configured: true, email: 'bot@proj.iam.gserviceaccount.com', folder: { id: 'ABCDEFGHIJK', name: 'Ish rejalar' } });
  } finally { await b.close(); }
});

test('POST /api/drive/folder', async () => {
  const p = await startPanel({ deps: { drive: fakeDrive({ folderInfo: async id => { if (id === 'DENIEDFOLDER1') throw err('DRIVE_NO_ACCESS'); return { id, name: 'Ish rejalar' }; } }) } });
  try {
    const cookie = await p.login();
    assert.deepEqual(await (await post(p, cookie, '/api/drive/folder', { url: 'https://drive.google.com/drive/folders/ABCDEFGHIJK?usp=sharing' })).json(), { id: 'ABCDEFGHIJK', name: 'Ish rejalar' });
    assert.deepEqual(p.calls.setMeta, [['drive_folder_id', 'ABCDEFGHIJK'], ['drive_folder_name', 'Ish rejalar']]);
    const denied = await post(p, cookie, '/api/drive/folder', { url: 'DENIEDFOLDER1' });
    assert.equal(denied.status, 400);
    assert.match((await denied.json()).error, /bot@proj\.iam\.gserviceaccount\.com/);
    assert.equal((await post(p, cookie, '/api/drive/folder', { url: 'salom' })).status, 400);
    assert.equal((await post(p, cookie, '/api/drive/folder', { url: 'ABCDEFGHIJK' }, 'https://evil.example')).status, 403);
  } finally { await p.close(); }
  const q = await startPanel();
  try {
    const cookie = await q.login();
    assert.equal((await post(q, cookie, '/api/drive/folder', { url: 'ABCDEFGHIJK' })).status, 400);
  } finally { await q.close(); }
});

test('POST /api/drive/scan: yangi, ma\'lum, katta', async () => {
  const p = await startPanel({ deps: { drive: fakeDrive() }, meta: { drive_folder_id: 'ABCDEFGHIJK', drive_folder_name: 'Ish rejalar' }, knownDrive: ['old'] });
  try {
    const cookie = await p.login();
    const b = await (await post(p, cookie, '/api/drive/scan')).json();
    assert.deepEqual(b, { found: 4, added: 2, known: 1, tooBig: 1, truncated: false, folder: { id: 'ABCDEFGHIJK', name: 'Ish rejalar' } });
    assert.deepEqual(p.calls.addInboxMany[0][0], { fileId: 'drive:n1', fileUniqueId: 'drive:n1', fileName: '5 sinf Matematika.xlsx', fileSize: 100, caption: '2-chorak', source: 'Google Drive', postedAt: '2026-11-10T08:00:00Z' });
    assert.equal(p.calls.addInboxMany[0][1].caption, null);
  } finally { await p.close(); }
  const q = await startPanel({ deps: { drive: fakeDrive() } });
  try {
    const cookie = await q.login();
    assert.equal((await post(q, cookie, '/api/drive/scan')).status, 400);
  } finally { await q.close(); }
  const r = await startPanel({ deps: { drive: fakeDrive({ listXlsx: async () => { throw err('DRIVE_FAIL'); } }) }, meta: { drive_folder_id: 'ABCDEFGHIJK' } });
  try {
    const cookie = await r.login();
    const x = await post(r, cookie, '/api/drive/scan');
    assert.equal(x.status, 502);
    assert.deepEqual(await x.json(), { error: 'drive' });
  } finally { await r.close(); }
});

test('POST /api/plans/exists-many', async () => {
  const p = await startPanel();
  try {
    const cookie = await p.login();
    const k = { subject: 'math', quarter: 2, year: '2026/2027', medium: 'uz', grading: 'normal' };
    assert.deepEqual(await (await post(p, cookie, '/api/plans/exists-many', { keys: [{ ...k, grade: 5 }, { ...k, grade: 6 }] })).json(), { existing: [0] });
    assert.equal(p.calls.existsMany[0][0].subjectKey, 'math');
    assert.equal((await post(p, cookie, '/api/plans/exists-many', { keys: Array(501).fill({ ...k, grade: 5 }) })).status, 400);
    assert.equal((await post(p, cookie, '/api/plans/exists-many', { keys: [{ ...k, grade: 12 }] })).status, 400);
  } finally { await p.close(); }
});

test('Drive\'dan o\'chirilgan fayl: 404 drive', async () => {
  const p = await startPanel({ plans: [{ id: '7', file_id: 'drive:gone', file_name: 'a.xlsx' }], deps: { downloadFile: async () => { throw err('DRIVE_NOT_FOUND'); } } });
  try {
    const cookie = await p.login();
    for (const u of ['/api/plans/7/file', '/api/plans/7/topics']) {
      const r = await fetch(p.base + u, { headers: { cookie } });
      assert.equal(r.status, 404, u);
      assert.deepEqual(await r.json(), { error: 'drive' });
    }
  } finally { await p.close(); }
});
