// eMaktab import sahifalarini o'qiydigan sof funksiyalar (brauzersiz import uchun).
// Tuzilish 2026-11-14 da sinovchi akkauntida ko'rilgan: test/fixtures/emaktab/README.md

import { W, COLUMN_RULES } from './emaktab.js';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = s => String(s ?? '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&([a-z0-9#]+);/gi, (m, e) => ENT[e.toLowerCase()] ?? m);
const norm = s => decode(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const reAny = list => new RegExp(list.map(r => (r instanceof RegExp ? r.source : r)).join('|'), 'i');

// <tag a="1" b='2' c> → { a: '1', b: '2', c: '' }
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    if (m.index === 0) continue;           // teg nomi
    out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}
const inputs = html => [...String(html).matchAll(/<input\b[^>]*>/gi)].map(m => attrs(m[0]));

export function parseToken(html) {
  const i = inputs(html).find(a => a.name === '__RequestVerificationToken');
  return i ? i.value ?? '' : null;
}

export function parseHidden(html, name) {
  const i = inputs(html).find(a => a.name === name);
  return i ? i.value ?? '' : null;
}

// Token bor formaning yashirin maydonlari (tokensiz)
export function parseFormHidden(html) {
  const forms = [...String(html).matchAll(/<form\b[\s\S]*?<\/form>/gi)].map(m => m[0]);
  const form = forms.find(f => /__RequestVerificationToken/.test(f)) || '';
  const out = {};
  for (const a of inputs(form))
    if ((a.type || '').toLowerCase() === 'hidden' && a.name && a.name !== '__RequestVerificationToken')
      out[a.name] = a.value ?? '';
  return out;
}

export function parseSelect(html, name) {
  const m = String(html).match(new RegExp(`<select\\b[^>]*\\bname=["']${name}["'][^>]*>([\\s\\S]*?)</select>`, 'i'));
  if (!m) return [];
  return [...m[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(o => {
    const a = attrs(`<option ${o[1]}>`);
    return { value: a.value ?? norm(o[2]), label: norm(o[2]), selected: 'selected' in a };
  });
}

// "Мои классы": sinf havolasi, keyin o'sha sinf fanlari (hujjat tartibida)
export function parseMyClasses(html) {
  const classes = [];
  let cur = null, school = null, periodId = null;
  for (const m of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = attrs(`<a ${m[1]}>`);
    const href = a.href || '';
    const cls = href.match(/\/v2\/class\?class=(\d+)/);
    if (cls) {
      const name = norm(m[2]);
      cur = name ? { groupId: cls[1], className: name, subjects: [] } : null;
      if (cur) classes.push(cur);
      continue;
    }
    const s = href.match(/\/journal\/school\/(\d+)\/group\/(\d+)\/subject\/(\d+)(?:\?[^"]*periodId=(\d+))?/);
    if (!s || !cur || s[2] !== cur.groupId) continue;
    school ??= s[1];
    periodId ??= s[4] || null;
    const name = (a.title || norm(m[2])).trim();
    if (!cur.subjects.some(x => x.id === s[3])) cur.subjects.push({ id: s[3], name });
  }
  return { school, periodId, classes: classes.filter(c => c.subjects.length) };
}

const TARGET = { 'Номер урока': 0, 'Тема урока': 1, 'Домашнее задание': 2 };

// Fayl sarlavhasidan select_i qiymatlari (0 raqam, 1 mavzu, 2 vazifa, -1 o'tkazish)
// Birinchi katak raqam bo'lsa — sarlavha yo'q, 1-qator ma'lumot: faqat tartib bo'yicha.
export function mapColumnsFromHeaders(headers) {
  const values = headers.map(() => -1);
  const used = new Set();
  const report = [];
  const hasHeader = !/^\d+$/.test(norm(headers[0]));
  if (!hasHeader) {
    headers.forEach((_, i) => { if (i <= 2) values[i] = i; });
    return { values, done: values.filter(v => v !== -1).length, hasHeader, report: "sarlavha yo'q — tartib bo'yicha" };
  }
  headers.forEach((h, i) => {
    const label = norm(h);
    const rule = COLUMN_RULES.find(r => r.re.test(label) && !used.has(TARGET[r.target]));
    if (!rule) return;
    values[i] = TARGET[rule.target];
    used.add(values[i]);
    report.push(`${label} -> ${rule.target}`);
  });
  // Mavzu ustuni sarlavhadan topilmasa — bo'sh qolgan joylar tartib bo'yicha
  if (!used.has(1)) {
    headers.forEach((h, i) => {
      if (i > 2 || values[i] !== -1 || used.has(i)) return;
      values[i] = i;
      used.add(i);
      report.push(`${norm(h) || `#${i + 1}`} -> ${Object.keys(TARGET)[i]} (tartib bo'yicha)`);
    });
  }
  return { values, done: values.filter(v => v !== -1).length, hasHeader, report: report.join('\n') };
}

export function countColumnSelects(html) {
  return new Set([...String(html).matchAll(/name=["'](select_\d+)["']/g)].map(m => m[1])).size;
}

const RE = {
  lessonNo: /№\s*урока|номер\s*урока|dars\s*raqami|дарс\s*рақами/i,
  topic: reAny(W.topic), hw: reAny(W.homework), check: reAny(W.check), error: reAny(W.error),
};

// 3-qadam jadvali: har qator, rowId (import qilsa bo'ladigan qator) va holat
export function previewFromHtml(html) {
  const table = [...String(html).matchAll(/<table\b[\s\S]*?<\/table>/gi)].map(m => m[0])
    .find(t => /name=["']select["']/.test(t));
  if (!table) return { rows: [] };
  const trs = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(m => m[0]);
  let col = null;
  const rows = [];
  for (const tr of trs) {
    const cellsRaw = [...tr.matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m => m[2]);
    const cells = cellsRaw.map(c => norm(c.replace(/<select\b[\s\S]*?<\/select>/gi, '')));
    if (!col && /<th\b/i.test(tr)) {
      const find = re => cells.findIndex(c => re.test(c));
      col = { lesson: find(RE.lessonNo), topic: find(RE.topic), hw: find(RE.hw), status: find(RE.check) };
      continue;
    }
    if (!col || !/^\d+$/.test(cells[0] || '')) continue;
    const pick = i => (i >= 0 && i < cells.length ? cells[i] : '');
    const rid = tr.match(/value=["'](\d+)=1["']/);
    const status = col.status !== -1 ? pick(col.status) : cells.at(-1);
    // Holat faqat o'z ustunidan: mavzudagi "ошибками" xato emas
    const isError = cells.some(c => /^(xato|хато|ошибка)\s*!?$/i.test(c)) || (!rid && RE.error.test(status));
    const lesson = pick(col.lesson);
    rows.push({
      n: cells[0],
      lesson: /^\d+$/.test(lesson) ? lesson : cells[0],
      topic: pick(col.topic),
      hw: pick(col.hw),
      rowId: rid ? rid[1] : null,
      ok: !!rid && !isError,
      status,
    });
  }
  return { rows };
}

export function periodNumber(label) {
  const t = norm(label);
  const d = t.match(/([1-4])\s*-?\s*(четв|chorak|чорак)/i);
  if (d) return Number(d[1]);
  const r = t.match(/^(IV|III|II|I)\s*-?\s*(четв|chorak|чорак)/i);
  return r ? { I: 1, II: 2, III: 3, IV: 4 }[r[1].toUpperCase()] : null;
}

export function isLoginPage(status, location, html) {
  if (status >= 300 && status < 400 && /login\.emaktab\.uz|\/login/i.test(location || '')) return true;
  return /type=["']password["']/i.test(html || '') && /login\.emaktab\.uz\/login|name=["']password["']/i.test(html || '');
}

const MAINT = /технически[ей]\s*работ|texnik\s*ishlar|техник\s*ишлар|временно\s*недоступ|vaqtincha\s*ishlamayapti|на\s*обслуживании|service\s*unavailable|bad\s*gateway/i;
export function isMaintenance(html) {
  const t = norm(String(html || '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ''));
  return t.length < 1500 && MAINT.test(t);
}

// step3 dan keyingi sahifa. Sarlavha/menyu olib tashlanadi, kalit so'zli parchalar qaytariladi
// (admin hisobotiga — eMaktab javobini o'rganish uchun). Aniq bo'lmasa ok = null.
const RESULT_WORD = /импорт|успешн|заверш|загружен|сохранен|ошибк|xato|хато|muvaffaqiyat|import qilindi/i;
export function parseImportResult(html) {
  const body = String(html || '').replace(/<(script|style|head|header|nav)\b[\s\S]*?<\/\1>/gi, '');
  const all = norm(body);
  const text = all.slice(0, 300);
  const backAtStep1 = /name=["']multifile1["']/.test(body);
  const snippets = all.split(/(?<=[.!?])\s+/).filter(s => RESULT_WORD.test(s)).map(s => s.slice(0, 160)).slice(0, 5);
  if (/name=["']step3["']/.test(body)) return { ok: false, text, snippets, backAtStep1 };
  const bad = snippets.some(s => /ошибк|xato|хато/i.test(s));
  const good = snippets.some(s => /успешн|заверш|загружено|импортирован|muvaffaqiyat|import qilindi/i.test(s));
  return { ok: bad ? false : good ? true : null, text, snippets, backAtStep1 };
}
