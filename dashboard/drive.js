// Google Drive (faqat o'qish): xizmat akkaunti JWT bilan token, papka ro'yxati,
// fayl yuklab olish. Yangi paket yo'q — node:crypto va fetch.

import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const MAX_FILES = 2000;
const MAX_FOLDERS = 50;
const TIMEOUT_MS = 20_000;   // sekin Google javobi botni ushlab qolmasin
const RATE = new Set(['userRateLimitExceeded', 'rateLimitExceeded', 'dailyLimitExceeded', 'backendError']);

// GOOGLE_SA_KEY: JSON matn yoki uning base64 ko'rinishi
export function parseKey(raw) {
  if (!raw) return null;
  for (const text of [raw, (() => { try { return Buffer.from(raw, 'base64').toString('utf8'); } catch { return ''; } })()]) {
    try {
      const k = JSON.parse(text);
      if (k?.client_email && k?.private_key) return { client_email: k.client_email, private_key: k.private_key };
    } catch { /* keyingisini sinaymiz */ }
  }
  return null;
}

export function parseFolderId(s) {
  const t = String(s || '').trim();
  const m = t.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || t.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(t) ? t : null;
}

const fail = (code, msg) => Object.assign(new Error(msg || code), { code });
const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');

// 403 sababi: API yoqilmagan / limit / ruxsat yo'q
async function reasonOf(r) {
  try { return (await r.json())?.error?.errors?.[0]?.reason || ''; } catch { return ''; }
}
async function failFor(r, notFoundCode) {
  if (r.status === 404) return fail(notFoundCode);
  if (r.status === 403) {
    const reason = await reasonOf(r);
    if (reason === 'accessNotConfigured') return fail('DRIVE_API_OFF');
    if (RATE.has(reason)) return fail('DRIVE_FAIL', `403 ${reason}`);
    return fail(notFoundCode);
  }
  return fail('DRIVE_FAIL', `${r.status}`);
}

export function createDrive({ key, fetch = globalThis.fetch, now = Date.now }) {
  let token = null, tokenExp = 0;
  const get = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });

  async function accessToken() {
    if (token && now() < tokenExp - 60_000) return token;
    const iat = Math.floor(now() / 1000);
    const head = b64url({ alg: 'RS256', typ: 'JWT' });
    const body = b64url({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 });
    let sig;
    try { sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key.private_key).toString('base64url'); }
    catch { throw fail('DRIVE_KEY', 'private key'); }
    let r;
    try {
      r = await get(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }).toString(),
      });
    } catch (e) { throw fail('DRIVE_FAIL', `token ${e?.name || 'error'}`); }
    // 400/401: kalit noto'g'ri, o'chirilgan yoki boshqa loyihaniki
    if (r.status === 400 || r.status === 401) throw fail('DRIVE_KEY', `token ${r.status}`);
    if (!r.ok) throw fail('DRIVE_FAIL', `token ${r.status}`);
    const j = await r.json();
    token = j.access_token;
    tokenExp = now() + (Number(j.expires_in) || 3600) * 1000;
    return token;
  }

  async function call(path, params) {
    const url = `${API}${path}?${new URLSearchParams(params)}`;
    const auth = `Bearer ${await accessToken()}`;
    try { return await get(url, { headers: { authorization: auth } }); }
    catch (e) { throw fail('DRIVE_FAIL', `${path} ${e?.name || 'error'}`); }
  }

  return {
    email: key.client_email,

    async folderInfo(id) {
      const r = await call(`/files/${encodeURIComponent(id)}`, { fields: 'id,name,mimeType', supportsAllDrives: 'true' });
      if (!r.ok) throw await failFor(r, 'DRIVE_NO_ACCESS');
      const j = await r.json();
      if (j.mimeType !== FOLDER) throw fail('DRIVE_NO_ACCESS', 'not a folder');
      return { id: j.id, name: j.name };
    },

    // Ichki papkalar bilan (kenglik bo'yicha), faqat .xls/.xlsx
    async listXlsx(folderId) {
      const files = [];
      const queue = [{ id: folderId, path: '' }];
      let folders = 0, truncated = false;
      while (queue.length) {
        const { id, path } = queue.shift();
        if (++folders > MAX_FOLDERS) { truncated = true; break; }
        let pageToken = '';
        do {
          const params = {
            q: `'${id}' in parents and trashed = false`,
            fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
            pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
          };
          if (pageToken) params.pageToken = pageToken;
          const r = await call('/files', params);
          if (!r.ok) throw await failFor(r, 'DRIVE_NO_ACCESS');
          const j = await r.json();
          for (const f of j.files || []) {
            if (f.mimeType === FOLDER) queue.push({ id: f.id, path: path ? `${path}/${f.name}` : f.name });
            else if (/\.xlsx?$/i.test(f.name || '')) {
              if (files.length >= MAX_FILES) { truncated = true; break; }
              files.push({ id: f.id, name: f.name, size: Number(f.size) || 0, modifiedTime: f.modifiedTime || null, path });
            }
          }
          pageToken = truncated ? '' : (j.nextPageToken || '');
        } while (pageToken);
        if (truncated) break;
      }
      return { files, truncated };
    },

    async download(fileId) {
      const r = await call(`/files/${encodeURIComponent(fileId)}`, { alt: 'media', supportsAllDrives: 'true' });
      if (!r.ok) throw await failFor(r, 'DRIVE_NOT_FOUND');
      return Buffer.from(await r.arrayBuffer());
    },
  };
}
