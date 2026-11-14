import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createDrive, parseKey, parseFolderId } from '../dashboard/drive.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { client_email: 'bot@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const res = (status, body) => ({ ok: status < 300, status, json: async () => body, arrayBuffer: async () => (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))) });

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) return res(200, { access_token: 'TOK' + calls.length, expires_in: 3600 });
    for (const [re, fn] of routes) { const m = String(url).match(re); if (m) return fn(m, url, opts); }
    return res(404, { error: { code: 404 } });
  };
  f.calls = calls;
  return f;
}

test('parseKey va parseFolderId', () => {
  assert.equal(parseKey(JSON.stringify(key)).client_email, key.client_email);
  assert.equal(parseKey(Buffer.from(JSON.stringify(key)).toString('base64')).client_email, key.client_email);
  assert.equal(parseKey('buzuq'), null);
  assert.equal(parseKey(undefined), null);
  assert.equal(parseKey(JSON.stringify({ a: 1 })), null);
  assert.equal(parseFolderId('https://drive.google.com/drive/folders/1AbC_dEf-GhIjK?usp=sharing'), '1AbC_dEf-GhIjK');
  assert.equal(parseFolderId('https://drive.google.com/open?id=1AbC_dEf-GhIjK'), '1AbC_dEf-GhIjK');
  assert.equal(parseFolderId('1AbC_dEf-GhIjK'), '1AbC_dEf-GhIjK');
  assert.equal(parseFolderId('salom'), null);
});

test('token: JWT RS256 to\'g\'ri, keshlanadi, muddati o\'tsa yangilanadi', async () => {
  let t = 1_800_000_000_000;
  const f = fakeFetch([[/\/files\/F1\?/, () => res(200, { id: 'F1', name: 'Papka', mimeType: 'application/vnd.google-apps.folder' })]]);
  const d = createDrive({ key, fetch: f, now: () => t });
  assert.equal(d.email, key.client_email);
  await d.folderInfo('F1');
  await d.folderInfo('F1');
  const tokenCalls = f.calls.filter(c => c.url.startsWith('https://oauth2'));
  assert.equal(tokenCalls.length, 1);
  const body = new URLSearchParams(tokenCalls[0].opts.body);
  assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [h, p, s] = body.get('assertion').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const pl = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(pl.iss, key.client_email);
  assert.equal(pl.scope, 'https://www.googleapis.com/auth/drive.readonly');
  assert.equal(pl.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(pl.exp - pl.iat, 3600);
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url')), true);
  assert.equal(f.calls.at(-1).opts.headers.authorization, 'Bearer TOK1');
  t += 3600_000;
  await d.folderInfo('F1');
  assert.equal(f.calls.filter(c => c.url.startsWith('https://oauth2')).length, 2);
});

test('listXlsx: ichki papkalar, filtr, sahifalar', async () => {
  const f = fakeFetch([[/\/files\?/, (m, url) => {
    const q = new URL(url).searchParams;
    const parent = q.get('q').match(/'([^']+)' in parents/)[1];
    if (parent === 'ROOT' && !q.get('pageToken')) return res(200, { nextPageToken: 'P2', files: [
      { id: 'a', name: 'a.xlsx', mimeType: 'x', size: '100', modifiedTime: '2026-11-09T08:00:00Z' },
      { id: 'b', name: 'b.pdf', mimeType: 'x', size: '5' } ] });
    if (parent === 'ROOT') return res(200, { files: [{ id: 'S', name: '2-chorak', mimeType: 'application/vnd.google-apps.folder' }] });
    if (parent === 'S') return res(200, { files: [{ id: 'c', name: 'c.XLS', mimeType: 'x', size: '7', modifiedTime: '2026-11-10T08:00:00Z' }] });
    return res(200, { files: [] });
  }]]);
  const d = createDrive({ key, fetch: f });
  const r = await d.listXlsx('ROOT');
  assert.deepEqual(r, { truncated: false, files: [
    { id: 'a', name: 'a.xlsx', size: 100, modifiedTime: '2026-11-09T08:00:00Z', path: '' },
    { id: 'c', name: 'c.XLS', size: 7, modifiedTime: '2026-11-10T08:00:00Z', path: '2-chorak' } ] });
  const listCall = f.calls.find(c => c.url.includes('/files?'));
  assert.match(listCall.url, /supportsAllDrives=true/);
  assert.match(new URL(listCall.url).searchParams.get('q'), /trashed = false/);
});

test('xatolar: download 404, papka 403, papka emas', async () => {
  const f = fakeFetch([
    [/\/files\/NOPE\?alt=media/, () => res(404, {})],
    [/\/files\/OK\?alt=media/, () => res(200, Buffer.from('xlsx'))],
    [/\/files\/DENY\?/, () => res(403, {})],
    [/\/files\/FILE\?/, () => res(200, { id: 'FILE', name: 'a.xlsx', mimeType: 'application/vnd.openxmlformats' })],
    [/\/files\/BOOM\?alt=media/, () => res(500, {})],
  ]);
  const d = createDrive({ key, fetch: f });
  assert.equal((await d.download('OK')).toString(), 'xlsx');
  await assert.rejects(d.download('NOPE'), e => e.code === 'DRIVE_NOT_FOUND');
  await assert.rejects(d.download('BOOM'), e => e.code === 'DRIVE_FAIL');
  await assert.rejects(d.folderInfo('DENY'), e => e.code === 'DRIVE_NO_ACCESS');
  await assert.rejects(d.folderInfo('FILE'), e => e.code === 'DRIVE_NO_ACCESS');
});
