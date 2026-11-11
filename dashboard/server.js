// Rejalar bazasi dashboardi: /panel sahifasi va /api/* yo'llari.
// Barcha tashqi bog'liqliklar (DB, Telegram, Excel) deps orqali keladi.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createAuth, parseCookies, sessionCookie } from './auth.js';
import { validateFilter, validatePlan, findDuplicates } from './validate.js';
import { parseFileName, guessSubject } from '../hints.js';
import { quarterOfDate, schoolYearOfDate } from './inbox.js';
import { makeSubjectKey, validateSubject } from './subjects.js';
import { buildCoverage } from './coverage.js';

const PAGE_SIZE = 50;
const MAX_FILE = 5_000_000;
const MAX_JSON = 1_000_000;
const MAX_BATCH = 300;
const MAX_TAKE = 50;
const SESSION_SEC = 7 * 24 * 3600;
const EXPIRED_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  '<title>Dashboard</title><body style="font:16px system-ui;padding:24px">' +
  '<p>Havola eskirgan. Botga /panel yozing.</p></body>';

export class HttpError extends Error {
  constructor(status, error) { super(error); this.status = status; this.error = error; }
}

export function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

// Tanani o'qiydi; limitdan oshsa qolganini xotiraga yig'may tashlab 413 beradi.
function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (declared > limit) {
    req.resume();
    return Promise.reject(new HttpError(413, 'Fayl 5 MB dan katta'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, over = false;
    req.on('data', c => {
      if (over) return;
      size += c.length;
      if (size > limit) { over = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on('end', () => over ? reject(new HttpError(413, 'Fayl 5 MB dan katta')) : resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, MAX_JSON);
  try { return JSON.parse(buf.toString('utf8') || '{}'); }
  catch { throw new HttpError(400, "So'rov noto'g'ri"); }
}

// RFC 5987/6266: filename* da ' ( ) * ham kodlanadi; eski brauzerlar uchun ASCII nom
export function contentDisposition(name) {
  const enc = encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${enc}`;
}

// Fayl nomidagi chorak: parseFileName + qisqa "2 четв" (faqat dashboard uchun;
// botdagi import oqimi o'zgarmasin)
function quarterOf(fileName, h) {
  if (h.quarter >= 1 && h.quarter <= 4) return h.quarter;
  const m = String(fileName).toLowerCase().match(/(?:^|\D)([1-4])\s*-?\s*четв/);
  return m ? Number(m[1]) : null;
}

const idsOr400 = (body, max) => {
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > max || !ids.every(i => Number.isInteger(i) && i > 0))
    throw new HttpError(400, `ids: 1–${max} ta butun son`);
  return ids;
};

const html = (res, status, text) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
};

export function createDashboard(deps) {
  const auth = deps.auth || createAuth();
  const log = deps.log || ((...a) => console.error(...a));
  const db = deps.db;
  const subjectKeys = () => new Set(deps.subjects().map(s => s.key));
  const routes = [];   // [method, RegExp, handler]
  const on = (method, re, fn) => routes.push([method, re, fn]);

  const archivedSubjects = async () =>
    (await db.subjectsForPanel()).filter(s => s.archived).map(({ key, uz, ru }) => ({ key, uz, ru }));
  const filterOr400 = (query, keys = subjectKeys()) => {
    const f = validateFilter(query, keys);
    if (!f.ok) throw new HttpError(400, f.error);
    return f.value;
  };
  // year, quarter, medium majburiy; grading standart 'normal'
  const sliceOr400 = query => {
    const f = filterOr400(query);
    if (!f.year || !f.quarter || !f.medium) throw new HttpError(400, 'Yil, chorak va til kerak');
    return { year: f.year, quarter: f.quarter, medium: f.medium, grading: f.grading || 'normal' };
  };
  const planOr404 = async id => {
    const p = await db.planForPanel(Number(id));
    if (!p) throw new HttpError(404, 'Reja topilmadi');
    return p;
  };
  // Taxmin: avval fayl nomi, keyin izoh; chorak/yil topilmasa — post sanasidan
  const guessFrom = (fileName, caption = null, { postedAt = null } = {}) => {
    const base = String(fileName).replace(/\.[^.]+$/, '');
    const text = `${base} ${caption || ''}`;
    const h = parseFileName(text + '.x');
    const grade = h.grade >= 1 && h.grade <= 11 ? h.grade : null;
    let year = h.year && Number(h.year[1]) === Number(h.year[0]) + 1 ? `${h.year[0]}/${h.year[1]}` : null;
    let quarter = quarterOf(text, h);
    if (postedAt) {
      const d = new Date(postedAt);
      if (!Number.isNaN(d.getTime())) {
        quarter ??= quarterOfDate(d);
        year ??= schoolYearOfDate(d);
      }
    }
    const keys = subjectKeys();
    const pick = k => (k && keys.has(k) ? k : null);
    const subject = pick(guessSubject(fileName, deps.keyOf)) ||
      (caption ? pick(guessSubject(caption + '.x', deps.keyOf)) : null);
    return {
      grade, subject,
      grading: deps.guessGrading(text) === 'bsb' ? 'bsb' : null,
      year, quarter,
    };
  };

  const countTopics = async (buf, fileName) => {
    if (!/\.xlsx$/i.test(fileName)) return null;
    const tmp = path.join(deps.tmpDir, `panel-${crypto.randomBytes(8).toString('hex')}.xlsx`);
    try {
      await fs.mkdir(deps.tmpDir, { recursive: true });
      await fs.writeFile(tmp, buf);
      return (await deps.readRows(tmp)).rows.length;
    } catch { return null; }
    finally { await fs.unlink(tmp).catch(() => {}); }
  };

  const coverage = async s =>
    buildCoverage(await db.coverageRows({ medium: s.medium, grading: s.grading }), s);

  // ---------- o'qish ----------
  on('GET', /^\/api\/meta$/, async (req, res) => json(res, 200, {
    subjects: deps.subjects().map(({ key, uz, ru }) => ({ key, uz, ru })),
    archivedSubjects: await archivedSubjects(),   // faqat nom va filtr uchun
    years: await db.planYears(),
    currentYear: deps.currentYear(),
  }));

  on('GET', /^\/api\/plans$/, async (req, res, u) => {
    const keys = new Set([...subjectKeys(), ...(await archivedSubjects()).map(s => s.key)]);
    const { page, ...filter } = filterOr400(u.searchParams, keys);
    const { rows, total } = await db.listPlans((page - 1) * PAGE_SIZE, PAGE_SIZE, filter);
    json(res, 200, { rows, total, page, pageSize: PAGE_SIZE });
  });

  on('GET', /^\/api\/stats$/, async (req, res, u) => {
    const s = sliceOr400(u.searchParams);
    const c = await db.panelCounts(s);
    const cov = await coverage(s);
    json(res, 200, { total: c.total, inQuarter: c.inQuarter, missing: cov.missing, archived: c.archived });
  });

  on('GET', /^\/api\/coverage$/, async (req, res, u) => {
    const s = sliceOr400(u.searchParams);
    const cov = await coverage(s);
    const byKey = new Map([...(await archivedSubjects()), ...deps.subjects()].map(x => [x.key, x]));
    const names = {};
    for (const k of cov.subjects) {
      const x = byKey.get(k);
      names[k] = { uz: x?.uz || k, ru: x?.ru || x?.uz || k };
    }
    json(res, 200, { ...cov, names });
  });

  on('GET', /^\/api\/plans\/exists$/, async (req, res, u) => {
    const f = filterOr400(u.searchParams);
    if (!f.grade || !f.subjectKey || !f.quarter || !f.year || !f.medium)
      throw new HttpError(400, "Sinf, fan, chorak, yil va til kerak");
    const hit = await db.findPlanByKey({ ...f, grading: f.grading || 'normal' });
    json(res, 200, { exists: !!hit, id: hit ? hit.id : null, archived: hit ? hit.archived : false });
  });

  on('GET', /^\/api\/plans\/(\d+)\/topics$/, async (req, res, u, m) => {
    const p = await planOr404(m[1]);
    if (!/\.xlsx$/i.test(p.file_name || '')) throw new HttpError(415, 'xls');
    const tmp = path.join(deps.tmpDir, `panel-${crypto.randomBytes(8).toString('hex')}.xlsx`);
    await fs.mkdir(deps.tmpDir, { recursive: true });
    try {
      await fs.writeFile(tmp, await deps.downloadFile(p.file_id));
      const { rows } = await deps.readRows(tmp);
      json(res, 200, { rows: rows.map((r, i) => ({ n: i + 1, topic: r.topic, hw: r.hw })) });
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  });

  on('GET', /^\/api\/plans\/(\d+)\/file$/, async (req, res, u, m) => {
    const p = await planOr404(m[1]);
    const buf = await deps.downloadFile(p.file_id);
    const name = p.file_name || `reja-${p.id}.xlsx`;
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': buf.length,
      'content-disposition': contentDisposition(name),
      'cache-control': 'no-store',
    });
    res.end(buf);
  });

  // ---------- yozish ----------
  on('POST', /^\/api\/files$/, async (req, res) => {
    let fileName;
    try { fileName = path.basename(decodeURIComponent(String(req.headers['x-file-name'] || ''))).slice(0, 200); }
    catch { fileName = ''; }
    if (!fileName) { req.resume(); throw new HttpError(400, "Fayl nomi yo'q"); }
    const ext = (fileName.match(/\.(xlsx?)$/i) || [])[1]?.toLowerCase();
    if (!ext) { req.resume(); throw new HttpError(415, 'Faqat .xls yoki .xlsx'); }

    const buf = await readBody(req, MAX_FILE);
    if (!buf.length) throw new HttpError(400, "Fayl bo'sh");

    const topics = await countTopics(buf, fileName);

    let fileId;
    try { fileId = await deps.sendDocument(buf, fileName); }
    catch (e) { log('[panel] sendDocument', e?.message || e); throw new HttpError(502, 'telegram'); }

    json(res, 200, { fileId, fileName, topics, guess: guessFrom(fileName) });
  });

  // ---------- fanlar ----------
  // Eski kalitlarda '+' ham bor (algebra+geometry); kalit faqat parametr sifatida ishlatiladi
  const keyOr404 = raw => {
    let k;
    try { k = decodeURIComponent(raw); } catch { k = ''; }
    if (!k || k.length > 64 || k.includes('/')) throw new HttpError(404, 'Fan topilmadi');
    return k;
  };
  const subjectOr400 = body => {
    const v = validateSubject(body);
    if (!v.ok) throw new HttpError(400, v.error);
    return v.value;
  };
  const reload = () => deps.reloadSubjects().catch(e => log('[panel] reloadSubjects', e?.message || e));

  on('GET', /^\/api\/subjects$/, async (req, res) => {
    json(res, 200, { rows: await db.subjectsForPanel() });
  });

  on('POST', /^\/api\/subjects$/, async (req, res) => {
    const v = subjectOr400(await readJson(req));
    const key = await makeSubjectKey(v.uz, k => db.subjectKeyExists(k));
    if (!key) throw new HttpError(400, "Nomda harf yoki raqam bo'lishi kerak");
    await db.insertSubject({ key, ...v });
    await reload();
    json(res, 200, { key });
  });

  on('POST', /^\/api\/subjects\/([^/]+)$/, async (req, res, u, m) => {
    const key = keyOr404(m[1]);
    const v = subjectOr400(await readJson(req));
    if (!(await db.getSubject(key))) throw new HttpError(404, 'Fan topilmadi');
    await db.updateSubject(key, v);
    await reload();
    json(res, 200, { ok: true });
  });

  on('POST', /^\/api\/subjects\/([^/]+)\/archive$/, async (req, res, u, m) => {
    const key = keyOr404(m[1]);
    const body = await readJson(req);
    const ok = await db.archiveSubject(key, body?.withPlans === true);
    await reload();
    json(res, 200, { ok });
  });

  on('POST', /^\/api\/subjects\/([^/]+)\/restore$/, async (req, res, u, m) => {
    const key = keyOr404(m[1]);
    req.resume();
    const ok = await db.restoreSubject(key);
    await reload();
    json(res, 200, { ok });
  });

  // ---------- kiruvchi (forward qilingan) fayllar ----------
  on('GET', /^\/api\/inbox$/, async (req, res) => {
    const rows = await db.listInbox();
    json(res, 200, {
      count: await db.countInbox(),
      rows: rows.map(r => ({ id: r.id, fileName: r.file_name, caption: r.caption, source: r.source, postedAt: r.posted_at })),
    });
  });

  on('POST', /^\/api\/inbox\/take$/, async (req, res) => {
    const ids = idsOr400(await readJson(req), MAX_TAKE);
    const out = [];
    const taken = [];
    for (const r of await db.getInbox(ids)) {
      let buf;
      try { buf = await deps.downloadFile(r.file_id); }
      catch (e) { log('[panel] inbox download', e?.message || e); out.push({ inboxId: r.id, error: 'telegram' }); continue; }
      out.push({
        inboxId: r.id, fileId: r.file_id, fileName: r.file_name,
        topics: await countTopics(buf, r.file_name),
        guess: guessFrom(r.file_name, r.caption, { postedAt: r.posted_at }),
      });
      taken.push(r.id);
    }
    if (taken.length) await db.markInbox(taken, 'taken_at');
    json(res, 200, { rows: out });
  });

  on('POST', /^\/api\/inbox\/dismiss$/, async (req, res) => {
    const ids = idsOr400(await readJson(req), MAX_BATCH);
    json(res, 200, { ok: true, n: await db.markInbox(ids, 'dismissed_at') });
  });

  on('POST', /^\/api\/plans\/batch$/, async (req, res) => {
    const { rows } = await readJson(req);
    if (!Array.isArray(rows) || rows.length > MAX_BATCH) throw new HttpError(400, `Qatorlar ro'yxati kerak (ko'pi bilan ${MAX_BATCH})`);
    const keys = subjectKeys();
    const skipped = [];
    const valid = [];
    rows.forEach((r, index) => {
      const v = validatePlan(r, keys);
      if (v.ok) valid.push({ index, value: v.value });
      else skipped.push({ index, error: v.error });
    });
    const dups = findDuplicates(valid.map(v => v.value));
    let created = 0, replaced = 0;
    for (const [i, v] of valid.entries()) {
      if (dups.has(i)) { skipped.push({ index: v.index, error: 'Takror' }); continue; }
      try {
        const saved = await db.savePlan(v.value);
        if (saved?.is_new) created++; else replaced++;
      } catch (e) {
        log('[panel] savePlan', e?.message || e);
        skipped.push({ index: v.index, error: 'server' });
      }
    }
    skipped.sort((a, b) => a.index - b.index);
    json(res, 200, { created, replaced, skipped });
  });

  on('POST', /^\/api\/plans\/(\d+)\/replace$/, async (req, res, u, m) => {
    const body = await readJson(req);
    const p = await planOr404(m[1]);
    const v = validatePlan({
      grade: p.grade, subjectKey: p.subject_key, quarter: p.quarter, year: p.year,
      medium: p.medium, grading: p.grading, fileId: body.fileId, fileName: body.fileName, topics: body.topics,
    }, new Set([...subjectKeys(), p.subject_key]));
    if (!v.ok) throw new HttpError(400, v.error);
    await db.savePlan(v.value);
    json(res, 200, { ok: true });
  });

  on('POST', /^\/api\/plans\/(\d+)\/archive$/, async (req, res, u, m) => {
    req.resume();
    json(res, 200, { ok: await db.archivePlan(Number(m[1])) });
  });

  on('POST', /^\/api\/plans\/(\d+)\/restore$/, async (req, res, u, m) => {
    req.resume();
    json(res, 200, { ok: await db.restorePlan(Number(m[1])) });
  });

  // ---------- kirish ----------
  async function panelRoutes(req, res, u, sid) {
    const p = u.pathname;
    if (p === '/panel/login' && req.method === 'GET') {
      const newSid = auth.redeem(u.searchParams.get('t') || '');
      if (!newSid) return html(res, 401, EXPIRED_HTML);
      res.writeHead(302, { location: '/panel', 'set-cookie': sessionCookie(newSid, SESSION_SEC), 'cache-control': 'no-store' });
      return res.end();
    }
    if (p === '/panel/logout' && req.method === 'POST') {
      if (req.headers.origin !== deps.publicOrigin) return json(res, 403, { error: 'origin' });
      if (sid) auth.logout(sid);
      res.writeHead(302, { location: '/panel', 'set-cookie': sessionCookie('', 0) });
      return res.end();
    }
    if ((p === '/panel' || p === '/panel/') && req.method === 'GET') {
      if (!auth.check(sid)) return html(res, 401, EXPIRED_HTML);
      return html(res, 200, await fs.readFile(deps.htmlPath, 'utf8'));
    }
    return json(res, 404, { error: 'not found' });
  }

  async function handle(req, res) {
    let u;
    try { u = new URL(req.url || '/', 'http://local'); }
    catch { return false; }   // masalan "GET //" — bizning yo'l emas
    const p = u.pathname;
    const isPanel = p === '/panel' || p.startsWith('/panel/');
    if (!isPanel && !p.startsWith('/api/')) return false;

    try {
      const sid = parseCookies(req.headers.cookie).sid;
      if (isPanel) { await panelRoutes(req, res, u, sid); return true; }

      if (!auth.check(sid)) { json(res, 401, { error: 'session' }); return true; }
      if (req.method === 'POST' && req.headers.origin !== deps.publicOrigin) {
        req.resume();
        json(res, 403, { error: 'origin' });
        return true;
      }
      for (const [method, re, fn] of routes) {
        const m = req.method === method && p.match(re);
        if (m) { await fn(req, res, u, m); return true; }
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof HttpError) {
        if (!res.headersSent) json(res, e.status, { error: e.error });
        else res.end();
      } else {
        log('[panel]', e);
        if (!res.headersSent) json(res, 500, { error: 'server' });
        else res.end();
      }
    }
    return true;
  }

  return {
    handle,
    issueLoginLink: () => `${deps.publicOrigin}/panel/login?t=${auth.issueToken()}`,
  };
}
