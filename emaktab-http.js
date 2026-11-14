// eMaktab bilan brauzersiz ishlash: Playwright login'idan olingan cookie'lar bilan
// oddiy HTTP so'rovlar. Faqat avtomatik import (sinov bosqichi) ishlatadi.

import {
  parseToken, parseHidden, parseFormHidden, parseMyClasses, mapColumnsFromHeaders,
  countColumnSelects, previewFromHtml, isLoginPage, isMaintenance, parseImportResult, periodNumber,
} from './emaktab-parse.js';
import { readSheetInfo } from './xlsx.js';

const BASE = 'https://schools.emaktab.uz';
const IMPORT = `${BASE}/v2/journals/planning/import`;
const fail = (code, msg) => Object.assign(new Error(msg || code), { code });
const pageText = html => String(html || '')
  .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
  .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);

export function cookiesFromState(state) {
  return (state?.cookies || [])
    .filter(c => /(^|\.)emaktab\.uz$/i.test(String(c.domain || '').replace(/^\./, '')))
    .map(({ name, value, domain, path }) => ({ name, value, domain, path: path || '/' }));
}

export function createEmaktabHttp({ cookies = [], fetch = globalThis.fetch, timeoutMs = 30_000 } = {}) {
  const keyOf = c => `${c.name}|${String(c.domain || '').replace(/^\./, '')}|${c.path || '/'}`;
  const jar = new Map(cookies.map(c => [keyOf(c), c]));

  const cookieFor = url => {
    const host = new URL(url).hostname;
    return [...jar.values()]
      .filter(c => { const d = String(c.domain || host).replace(/^\./, ''); return host === d || host.endsWith(`.${d}`); })
      .map(c => `${c.name}=${c.value}`).join('; ');
  };
  const keep = (r, url) => {
    const list = r.headers.getSetCookie?.() || [];
    for (const line of list) {
      const [pair, ...rest] = line.split(';');
      const i = pair.indexOf('=');
      if (i < 1) continue;
      const attr = rest.map(s => s.trim());
      const domain = attr.find(s => /^domain=/i.test(s))?.slice(7) || new URL(url).hostname;
      const path = attr.find(s => /^path=/i.test(s))?.slice(5) || '/';
      const c = { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), domain, path };
      const maxAge = attr.find(s => /^max-age=/i.test(s))?.slice(8);
      const expires = attr.find(s => /^expires=/i.test(s))?.slice(8);
      const gone = (maxAge != null && Number(maxAge) <= 0) || (expires && Date.parse(expires) < Date.now());
      if (gone) jar.delete(keyOf(c)); else jar.set(keyOf(c), c);
    }
  };

  async function request(url, opts = {}, hops = 0) {
    let r;
    try {
      r = await fetch(url, {
        ...opts,
        redirect: 'manual',
        headers: { ...(opts.headers || {}), cookie: cookieFor(url) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) { throw fail('MAINTENANCE', `network ${e?.name || 'error'}`); }
    keep(r, url);
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location') || '';
      if (isLoginPage(r.status, loc, '')) throw fail('SESSION_EXPIRED');
      if (!loc || hops > 4) throw fail('EMAKTAB_UNEXPECTED', `redirect ${r.status}`);
      return request(new URL(loc, url).href, { method: 'GET' }, hops + 1);
    }
    const html = await r.text();
    if ([500, 502, 503, 504].includes(r.status) || isMaintenance(html)) throw fail('MAINTENANCE');
    if (isLoginPage(r.status, null, html)) throw fail('SESSION_EXPIRED');
    if (!r.ok) throw fail('EMAKTAB_UNEXPECTED', `${r.status} ${pageText(html)}`);
    return html;
  }
  const getJson = async path => {
    const t = await request(`${BASE}${path}`);
    try { return JSON.parse(t); } catch { throw fail('EMAKTAB_UNEXPECTED', `json ${path}`); }
  };

  // .xls (exceljs o'qiy olmaydi) — sarlavha bor deb, tartib bo'yicha; qatorlar soni tekshirilmaydi
  async function sheetInfo(file) {
    try { return await readSheetInfo(file); } catch { return { headers: [], rowCount: null }; }
  }

  return {
    async listClassSubjects() {
      return parseMyClasses(await request(`${BASE}/v2/myclasses`));
    },

    async subgroups(groupId) {
      const list = await getJson(`/v2/journals/getsubgroups-cmd?group=${encodeURIComponent(groupId)}`);
      return [{ id: '', name: 'Весь класс' }, ...list.map(x => ({ id: String(x.value), name: x.name }))];
    },

    async periods(groupId) {
      const list = await getJson(`/v2/journals/getperiods-cmd?group=${encodeURIComponent(groupId)}`);
      return list.map(x => ({ id: String(x.value), name: x.name, n: periodNumber(x.name) }));
    },

    // Bitta sinf × fan: 1-qadam (fayl) → 2-qadam (parametr, ustunlar) → ko'rib chiqish → import
    async importOne({ file, fileName = 'reja.xlsx', year, school, groupId, subjectId, subgroupId = '', periodId, okOnly = false }) {
      const html1 = await request(IMPORT);
      const token1 = parseToken(html1);
      if (!token1) throw fail('EMAKTAB_UNEXPECTED', `1-qadam: ${pageText(html1)}`);

      const info = await sheetInfo(file);
      const hasHeader = !/^\d+$/.test(String(info.headers[0] ?? '').trim());
      const fd = new FormData();
      fd.set('__RequestVerificationToken', token1);
      const set = { group: groupId, subject: subjectId, subgroup: subgroupId || '0', period: periodId, year };
      if (school) set.school = school;
      for (const [k, v] of Object.entries({ ...parseFormHidden(html1), ...set })) fd.set(k, v ?? '');
      fd.set('multifile1', new Blob([file]), fileName);
      fd.set('firstRow', hasHeader ? '0' : '1');   // 0 — 1-qatorda ustun nomlari, 1 — ma'lumot
      fd.set('step1', 'Далее >');
      const html2 = await request(IMPORT, { method: 'POST', body: fd });
      const stored = parseHidden(html2, 'file');
      const token2 = parseToken(html2);
      if (!stored || !token2) throw fail('EMAKTAB_UNEXPECTED', `fayl qabul qilinmadi: ${pageText(html2)}`);

      const count = countColumnSelects(html2);
      const map = mapColumnsFromHeaders(Array.from({ length: count }, (_, i) => info.headers[i] ?? ''));
      if (!map.values.includes(1)) throw fail('EMAKTAB_UNEXPECTED', 'mavzu ustuni aniqlanmadi');

      const p2 = new URLSearchParams();
      p2.append('__RequestVerificationToken', token2);
      for (const [k, v] of Object.entries(parseFormHidden(html2))) p2.append(k, v);
      for (const [k, v] of Object.entries({ year, group: groupId, subject: subjectId, subgroup: subgroupId, period: periodId, pageIndex: '1' }))
        p2.set(k, v ?? '');
      map.values.forEach((v, i) => p2.append(`select_${i}`, String(v)));
      p2.append('step2', 'Далее >');
      const html3 = await request(IMPORT, { method: 'POST', body: p2 });
      const { rows } = previewFromHtml(html3);
      const token3 = parseToken(html3);
      if (!rows.length || !token3) throw fail('EMAKTAB_UNEXPECTED', `ko'rib chiqish jadvali yo'q: ${pageText(html3)}`);

      // eMaktab qiymatlarni o'zgartirmaganini tekshiramiz (noto'g'ri sinf/fan/chorakka tushmasin)
      const h3 = parseFormHidden(html3);
      const want = { group: groupId, subject: subjectId, period: periodId, year };
      for (const [k, v] of Object.entries(want))
        if (String(h3[k] ?? '') !== String(v ?? '')) throw fail('EMAKTAB_UNEXPECTED', `eMaktab qiymatni o'zgartirdi: ${k}`);
      const sub = v => (v === '0' ? '' : String(v ?? ''));
      if (sub(h3.subgroup) !== sub(subgroupId)) throw fail('EMAKTAB_UNEXPECTED', "eMaktab qiymatni o'zgartirdi: subgroup");

      // Sahifalash: ko'rib chiqishda fayldagidan kam qator bo'lsa — qisman import qilmaymiz
      const expected = info.rowCount == null ? null : info.rowCount - (hasHeader ? 1 : 0);
      if (expected != null && rows.length < expected)
        return { state: 'failed', rows, imported: 0, error: `ko'rib chiqishda faqat ${rows.length}/${expected} qator ko'rindi` };

      const ready = rows.filter(r => r.ok);
      if (ready.length < rows.length && !okOnly) return { state: 'needs_choice', rows, imported: 0, mapReport: map.report };
      if (!ready.length) return { state: 'failed', rows, imported: 0, error: "tayyor qator yo'q" };

      const p3 = new URLSearchParams();
      p3.append('__RequestVerificationToken', token3);
      for (const [k, v] of Object.entries(parseFormHidden(html3))) p3.append(k, v);
      for (const r of rows) p3.append('select', r.ok ? `${r.rowId}=1` : (r.rowId ? `${r.rowId}=0` : '0=0'));
      p3.append('step3', 'Импортировать >');
      const html4 = await request(IMPORT, { method: 'POST', body: p3 });
      const result = parseImportResult(html4);
      if (result.ok === false) return { state: 'failed', rows, imported: 0, result, error: result.text };
      return { state: 'done', rows, imported: ready.length, result };
    },
  };
}
