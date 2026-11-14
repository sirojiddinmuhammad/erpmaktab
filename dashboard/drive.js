// Google Drive (faqat o'qish): xizmat akkaunti JWT bilan token, papka ro'yxati,
// fayl yuklab olish. Yangi paket yo'q — node:crypto va fetch.

import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const MAX_FILES = 2000;
const MAX_FOLDERS = 50;

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

export function createDrive({ key, fetch = globalThis.fetch, now = Date.now }) {
  let token = null, tokenExp = 0;

  async function accessToken() {
    if (token && now() < tokenExp - 60_000) return token;
    const iat = Math.floor(now() / 1000);
    const head = b64url({ alg: 'RS256', typ: 'JWT' });
    const body = b64url({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 });
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key.private_key).toString('base64url');
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }).toString(),
    });
    if (!r.ok) throw fail('DRIVE_FAIL', `token ${r.status}`);
    const j = await r.json();
    token = j.access_token;
    tokenExp = now() + (Number(j.expires_in) || 3600) * 1000;
    return token;
  }

  async function call(path, params) {
    const url = `${API}${path}?${new URLSearchParams(params)}`;
    return fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } });
  }

  return {
    email: key.client_email,

    async folderInfo(id) {
      const r = await call(`/files/${encodeURIComponent(id)}`, { fields: 'id,name,mimeType', supportsAllDrives: 'true' });
      if (r.status === 403 || r.status === 404) throw fail('DRIVE_NO_ACCESS');
      if (!r.ok) throw fail('DRIVE_FAIL', `folder ${r.status}`);
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
          if (r.status === 403 || r.status === 404) throw fail('DRIVE_NO_ACCESS');
          if (!r.ok) throw fail('DRIVE_FAIL', `list ${r.status}`);
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
      if (r.status === 404 || r.status === 403) throw fail('DRIVE_NOT_FOUND');
      if (!r.ok) throw fail('DRIVE_FAIL', `download ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    },
  };
}
