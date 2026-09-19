// Admin paneli: ro'yxatlar, qidiruv, balans tuzatish, ommaviy xabar
import { InlineKeyboard, InputFile } from 'grammy';
import * as db from './db.js';
import { money } from './i18n.js';
import { SUBJECTS, COMBOS, subjectName } from './subjects.js';

// Fanlar bazada saqlanadi. Kodagi lug'at faqat birinchi to'ldirish uchun.
const subjCache = new Map();

export async function loadExtraSubjects() {
  // Birinchi marta: kodagi lug'atni bazaga ko'chiramiz
  await db.seedSubjects([...SUBJECTS, ...COMBOS].map(s => ({
    key: s.key, uz: s.uz, ru: s.ru, alias: s.alias || [],
  })));

  const rows = await db.extraSubjects();
  subjCache.clear();
  for (const r of rows) subjCache.set(r.key, r);
  return rows.length;
}

export const allSubjects = () => [...subjCache.values()];

export function nameOf(key, lang = 'uz') {
  const e = subjCache.get(key);
  if (e) return (lang === 'ru' ? e.ru : e.uz) || e.uz || key;
  return subjectName(key, lang);   // zaxira
}

// Bazadagi tanish so'zlar bo'yicha kalit topish
export function keyOfName(name) {
  const norm = t => String(t || '').toLowerCase().replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ').trim();
  const n = norm(name);
  if (!n) return null;

  for (const s of subjCache.values()) {
    if (norm(s.uz) === n || norm(s.ru) === n || norm(s.key) === n) return s.key;
    for (const a of s.alias || []) if (norm(a) === n) return s.key;
  }
  for (const s of subjCache.values()) {
    for (const a of [s.uz, s.ru, ...(s.alias || [])]) {
      const x = norm(a);
      if (x.length >= 5 && (n.includes(x) || x.includes(n))) return s.key;
    }
  }
  return null;
}

const PAGE = 30;
const esc = x => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const LISTS = {
  subs:     { title: '⭐ Obunachilar',       kind: 'acc' },
  money:    { title: '💰 Balansi borlar',    kind: 'acc' },
  linked:   { title: '🔗 Hisob ulaganlar',   kind: 'acc' },
  imported: { title: '📤 Import qilganlar',  kind: 'acc' },
  idle:     { title: '👻 Faol emaslar',      kind: 'idle' },
};

const AUDIENCE = {
  all:    'Hammaga',
  linked: 'Hisob ulaganlarga',
  subs:   'Obunachilarga',
  money:  'Balansi borlarga',
};

export function panelKb() {
  return new InlineKeyboard()
    .text('📊 Hisobot', 'a:stats').text('🔍 Qidirish', 'a:search').row()
    .text('⭐ Obunachilar', 'a:l:subs:0').text('💰 Balansi borlar', 'a:l:money:0').row()
    .text('🔗 Hisob ulaganlar', 'a:l:linked:0').text('📤 Import qilganlar', 'a:l:imported:0').row()
    .text('👻 Faol emaslar', 'a:l:idle:0').text('➕ Balans', 'a:adj').row()
    .text('📚 Ish rejalar', 'a:plans_menu').text('✉️ Xabar', 'a:msg');
}

const hasSub = r => r.sub_until && new Date(r.sub_until) >= new Date();

// Ro'yxat turiga qarab oxirgi ustun o'zgaradi
function accLine(r, key) {
  const marks = (hasSub(r) ? '⭐' : '') + (r.balance > 0 ? '💰' : '');
  const name = esc(r.full_name || r.login);

  let tail = '';
  if (key === 'imported')      tail = ` · ${r.imports_ok} ta`;
  else if (key === 'subs')     tail = ` · ${String(r.sub_until).slice(0, 10)}`;
  else if (key === 'money')    tail = ` · ${money(r.balance)}`;
  else if (key === 'linked')   tail = ` · ${r.imports_ok} ta`;

  return `${marks || '·'} ${name}${tail}`;
}

function idleLine(r) {
  const d = new Date(r.created_at);
  const dm = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `· <a href="tg://user?id=${r.tg_id}">${r.tg_id}</a> · ${dm}`;
}

export async function showList(ctx, key, offset, edit = false) {
  const meta = LISTS[key];
  if (!meta) return;

  const { rows, total } = meta.kind === 'idle'
    ? await db.listIdle(offset, PAGE)
    : await db.listAccounts(key, offset, PAGE);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const page = Math.floor(offset / PAGE) + 1;

  const body = rows.length
    ? rows.map(r => (meta.kind === 'idle' ? idleLine(r) : accLine(r, key))).join('\n')
    : '—';

  const text = `${meta.title} · ${total} ta\n\n${body}`;

  const kb = new InlineKeyboard();
  if (offset > 0) kb.text('⬅️', `a:l:${key}:${offset - PAGE}`);
  kb.text(`${page}/${pages}`, 'a:noop');
  if (offset + PAGE < total) kb.text('➡️', `a:l:${key}:${offset + PAGE}`);
  kb.row().text('📄 Fayl', `a:f:${key}`).text('🛠 Panel', 'a:panel');

  const opts = { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } };
  if (edit) return ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
  return ctx.reply(text, opts);
}

export async function sendListFile(ctx, key) {
  const meta = LISTS[key];
  if (!meta) return;

  const lines = [];
  for (let off = 0; ; off += 200) {
    const { rows, total } = meta.kind === 'idle'
      ? await db.listIdle(off, 200)
      : await db.listAccounts(key, off, 200);
    if (!rows.length) break;

    for (const r of rows) {
      lines.push(meta.kind === 'idle'
        ? `${r.tg_id}\t${new Date(r.created_at).toISOString().slice(0, 10)}`
        : [
            r.full_name || '',
            r.login,
            r.balance,
            hasSub(r) ? String(r.sub_until).slice(0, 10) : '',
            r.imports_ok,
            r.tg_id || '',
          ].join('\t'));
    }
    if (off + 200 >= total) break;
  }

  const head = meta.kind === 'idle'
    ? 'tg_id\tsana'
    : 'Ism\tLogin\tBalans\tObuna\tImport\ttg_id';

  await ctx.replyWithDocument(
    new InputFile(Buffer.from([head, ...lines].join('\n'), 'utf8'), `${key}.txt`),
    { caption: `${meta.title} · ${lines.length} ta` }
  );
}

export async function showSearch(ctx, q) {
  const rows = await db.searchAccounts(q);
  if (!rows.length) return ctx.reply(`🔍 "${esc(q)}" bo'yicha hech narsa topilmadi.`);

  const text = rows.map(r => {
    const marks = (hasSub(r) ? '⭐' : '') + (r.balance > 0 ? '💰' : '');
    return `${marks || '·'} <b>${esc(r.full_name || '—')}</b>\n` +
           `<code>${esc(r.login)}</code>` +
           (r.tg_id ? ` · <a href="tg://user?id=${r.tg_id}">${r.tg_id}</a>` : '') + '\n' +
           `Balans: ${money(r.balance)} · Import: ${r.imports_ok}` +
           (hasSub(r) ? ` · Obuna: ${String(r.sub_until).slice(0, 10)}` : '');
  }).join('\n\n');

  await ctx.reply(`🔍 ${rows.length} ta topildi:\n\n${text}`, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: new InlineKeyboard().text('🛠 Panel', 'a:panel'),
  });
}

export async function showStats(ctx) {
  const { users, imp, pay, top, soon } = await db.stats();
  const topList = top.length
    ? top.map((r, i) => `${i + 1}. ${esc(r.name)} — ${r.imports_ok} ta`).join('\n')
    : '—';

  await ctx.reply(
    `📊 <b>Hisobot</b>\n\n` +
    `👥 Botda: ${users.total} · bugun +${users.today}\n` +
    `🔗 Hisob ulagan: ${users.linked}\n` +
    `📤 Import qilgan: ${users.active}\n\n` +
    `📤 <b>Importlar</b>\nBugun: ${imp.today} · 7 kun: ${imp.week} · Jami: ${users.imports_total}\n\n` +
    `💰 <b>Pul</b>\nBalanslarda: ${money(users.balances)} so'm\n` +
    `Jami to'lovlar: ${money(pay.total)} so'm\n` +
    `⭐ Obunachilar: ${users.subs} · ⏳ 30 kunda tugaydi: ${soon}\n\n` +
    `🏆 <b>Eng faollar</b>\n${topList}`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🛠 Panel', 'a:panel') }
  );
}

export function audienceKb() {
  const kb = new InlineKeyboard();
  Object.entries(AUDIENCE).forEach(([k, v], i) => {
    kb.text(v, `a:aud:${k}`);
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text('❌ Bekor', 'a:panel');
}

export const audienceName = k => AUDIENCE[k] || k;

// Ommaviy yuborish — sekin, holat ko'rsatib
export async function broadcast(bot, ctx, kind, text) {
  const ids = await db.recipients(kind);
  const status = await ctx.reply(`Yuborilmoqda... 0/${ids.length}`);

  let ok = 0, fail = 0;
  for (let i = 0; i < ids.length; i++) {
    try {
      await bot.api.sendMessage(ids[i], text, { parse_mode: 'HTML' });
      ok++;
    } catch { fail++; }

    await new Promise(r => setTimeout(r, 35)); // Telegram cheklovi
    if (i % 50 === 49) {
      await ctx.api.editMessageText(ctx.chat.id, status.message_id,
        `Yuborilmoqda... ${i + 1}/${ids.length}`).catch(() => {});
    }
  }

  await ctx.api.editMessageText(ctx.chat.id, status.message_id,
    `✅ ${ok} ta yetkazildi · ❌ ${fail} ta yetmadi`).catch(() => {});
}


// ---------- ish rejalar ----------
const GRADES = [1,2,3,4,5,6,7,8,9,10,11];

// Joriy o'quv yili (sentyabrdan yangisi boshlanadi)
export function currentYear() {
  const d = new Date();
  const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}/${y + 1}`;
}

export function mediumKb() {
  return new InlineKeyboard()
    .text('🇺🇿 O\'zbek', 'a:pm:uz').text('🇷🇺 Rus', 'a:pm:ru').row()
    .text('❌ Bekor', 'a:panel');
}

export const MEDIUM_FLAG = { uz: '🇺🇿', ru: '🇷🇺' };

// O'zbekcha BSB/CHSB, ruscha СОР/СОЧ — bitta tushuncha, ikki nom
const GRADING_LABEL = {
  uz: { normal: 'Oddiy baholash', bsb: 'BSB / CHSB' },
  ru: { normal: 'Обычное оценивание', bsb: 'СОР / СОЧ' },
};

export const gradingName = (key, medium = 'uz') =>
  (GRADING_LABEL[medium === 'ru' ? 'ru' : 'uz'])[key || 'normal'];

export const gradingTag = (key, medium = 'uz') =>
  key === 'bsb' ? (medium === 'ru' ? ' · СОР/СОЧ' : ' · BSB/CHSB') : '';

// Eski kod uchun moslik
export const GRADING_NAME = GRADING_LABEL.uz;

// Fayl nomida BSB bo'lsa taxmin qilinadi, lekin baribir tasdiqlanadi
export function gradingKb(guess = null, prefix = 'pgr', medium = 'uz') {
  const mark = k => {
    const n = gradingName(k, medium);
    return k === guess ? `✅ ${n}` : n;
  };
  return new InlineKeyboard()
    .text(mark('normal'), `a:${prefix}:normal`)
    .text(mark('bsb'), `a:${prefix}:bsb`).row()
    .text('❌ Bekor', 'a:panel');
}

// \b faqat lotin harflari bilan ishlaydi, shuning uchun bo'sh joy bilan ajratamiz
export function guessGrading(name) {
  const s = ' ' + String(name || '').toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, ' ').trim() + ' ';
  return / (bsb|chsb|бсб|чсб|сор|соч) /.test(s) ? 'bsb' : null;
}

export function yearsKb(current) {
  const base = Number(current.slice(0, 4));
  const kb = new InlineKeyboard();
  [base - 1, base, base + 1].forEach(y => {
    const label = `${y}/${y + 1}`;
    kb.text(label === current ? `✅ ${label}` : label, `a:py:${y}`);
  });
  return kb.row().text('❌ Bekor', 'a:panel');
}
const SUBJ_PAGE = 12;

export function gradesKb() {
  const kb = new InlineKeyboard();
  GRADES.forEach((g, i) => {
    kb.text(`${g}`, `a:pg:${g}`);
    if (i % 4 === 3) kb.row();
  });
  return kb.row().text('❌ Bekor', 'a:panel');
}

export async function subjectsKb(page = 0, medium = 'uz') {
  const L = medium === 'ru' ? 'ru' : 'uz';
  const all = allSubjects().map(s => ({ key: s.key, uz: s[L] || s.uz || s.key }));

  const pages = Math.max(1, Math.ceil(all.length / SUBJ_PAGE));
  const slice = all.slice(page * SUBJ_PAGE, (page + 1) * SUBJ_PAGE);

  const kb = new InlineKeyboard();
  slice.forEach((s, i) => {
    kb.text(s.uz, `a:ps:${s.key}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row();
  if (page > 0) kb.text('⬅️', `a:psp:${page - 1}`);
  kb.text(`${page + 1}/${pages}`, 'a:noop');
  if (page + 1 < pages) kb.text('➡️', `a:psp:${page + 1}`);
  kb.row().text('✏️ Qo\'lda qo\'shish', 'a:psnew').text('❌ Bekor', 'a:panel');
  return kb;
}

export function quartersKb() {
  const kb = new InlineKeyboard();
  [1,2,3,4].forEach(q => kb.text(`${q}-chorak`, `a:pq:${q}`));
  return kb.row().text('❌ Bekor', 'a:panel');
}

const PLAN_PAGE = 15;

// Filtr tanlash ekrani
export async function showPlanFilter(ctx, f = {}, edit = false) {
  const total = await db.countPlans();
  const mark = (on, label) => (on ? `✅ ${label}` : label);

  const kb = new InlineKeyboard()
    .text(mark(f.medium === 'uz', "🇺🇿 O'zbek"), 'a:pfm:uz')
    .text(mark(f.medium === 'ru', '🇷🇺 Rus'), 'a:pfm:ru').row();

  GRADES.forEach((g, i) => {
    kb.text(mark(f.grade === g, `${g}`), `a:pfg:${g}`);
    if (i % 6 === 5) kb.row();
  });
  kb.row();

  [1, 2, 3, 4].forEach(q => kb.text(mark(f.quarter === q, `${q}-chorak`), `a:pfq:${q}`));
  kb.row();

  const ready = f.medium && f.grade && f.quarter;
  if (ready) kb.text("📋 Ro'yxatni ko'rish", 'a:plans:0').row();
  kb.text('📚 Reja qo\'shish', 'a:plan').text('🛠 Panel', 'a:panel');

  const text = `🗂 <b>Rejalar bazasi</b> · ${total} ta\n\n` +
    (ready ? "Tanlandi. Ro'yxatni ko'rishingiz mumkin." : 'Til, sinf va chorakni tanlang:');

  const opts = { parse_mode: 'HTML', reply_markup: kb };
  if (edit) return ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
  return ctx.reply(text, opts);
}

export async function showPlans(ctx, offset = 0, edit = false, filter = {}) {
  const { rows, total } = await db.listPlans(offset, PLAN_PAGE, filter);
  const pages = Math.max(1, Math.ceil(total / PLAN_PAGE));
  const page = Math.floor(offset / PLAN_PAGE) + 1;

  // Sinf, til, chorak sarlavhada — qatorlarda faqat fan
  const lang = filter.medium === 'ru' ? 'ru' : 'uz';
  const body = rows.map((r, i) =>
    `${i + 1}. ${esc(nameOf(r.subject_key, lang))}` +
    gradingTag(r.grading, filter.medium) +
    (r.topics ? ` · ${r.topics} mavzu` : '')
  ).join('\n') || '—';

  const kb = new InlineKeyboard();
  rows.forEach((r, i) => {
    kb.text(`${i + 1}`, `a:pv:${r.id}:${offset}`);
    if (i % 5 === 4) kb.row();
  });
  kb.row();
  if (offset > 0) kb.text('⬅️', `a:plans:${offset - PLAN_PAGE}`);
  kb.text(`${page}/${pages}`, 'a:noop');
  if (offset + PLAN_PAGE < total) kb.text('➡️', `a:plans:${offset + PLAN_PAGE}`);
  kb.row().text('🔧 Filtr', 'a:pfilt').text('🛠 Panel', 'a:panel');

  const head = [
    MEDIUM_FLAG[filter.medium] || '',
    filter.grade ? `${filter.grade}-sinf` : '',
    filter.quarter ? `${filter.quarter}-chorak` : '',
  ].filter(Boolean).join(' · ');

  const text = `🗂 <b>${esc(head)}</b> · ${total} ta\n\n${body}`;
  const opts = { parse_mode: 'HTML', reply_markup: kb };
  if (edit) return ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
  return ctx.reply(text, opts);
}

// Bitta rejaning kartochkasi
export async function showPlan(ctx, id, backOffset = 0) {
  const p = await db.getPlan(id);
  if (!p) return ctx.reply('Reja topilmadi.');

  const lang = p.medium === 'ru' ? 'ru' : 'uz';
  await ctx.reply(
    `📗 <b>${p.grade}-sinf · ${esc(nameOf(p.subject_key, lang))}</b>\n` +
    `${p.quarter}-chorak · ${esc(p.year || '—')} · ${MEDIUM_FLAG[p.medium] || ''}\n` +
    `${gradingName(p.grading, p.medium)}\n` +
    (p.topics ? `${p.topics} ta mavzu\n` : '') +
    `Fayl: ${esc(p.file_name || '—')}\n` +
    `Qo'shilgan: ${new Date(p.created_at).toISOString().slice(0, 10)}`,
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text('📥 Faylni olish', `a:pf:${p.id}`)
        .text('🗑 O\'chirish', `a:pd:${p.id}`).row()
        .text('⬅️ Orqaga', `a:plans:${backOffset}`),
    }
  );
}


// ---------- ommaviy yuklash ----------
// Sinf tugmalari: fayl nomidan taxmin qilingani birinchi va ✅ bilan
export function bulkGradeKb(guess) {
  const kb = new InlineKeyboard();
  const order = guess ? [guess, ...GRADES.filter(g => g !== guess)] : GRADES;
  order.forEach((g, i) => {
    kb.text(g === guess ? `✅ ${g}` : `${g}`, `a:bg:${g}`);
    if (i % 4 === 3) kb.row();
  });
  return kb.row().text('⏭ O\'tkazish', 'a:bskip').text('❌ To\'xtatish', 'a:bstop');
}

// Fan tugmalari: taxmin qilingani tepada
export async function bulkSubjectKb(page = 0, medium = 'uz', guess = null) {
  const L = medium === 'ru' ? 'ru' : 'uz';
  let all = allSubjects().map(s => ({ key: s.key, name: s[L] || s.uz || s.key }));

  if (guess) {
    const hit = all.find(s => s.key === guess);
    if (hit) all = [hit, ...all.filter(s => s.key !== guess)];
  }

  const pages = Math.max(1, Math.ceil(all.length / SUBJ_PAGE));
  const slice = all.slice(page * SUBJ_PAGE, (page + 1) * SUBJ_PAGE);

  const kb = new InlineKeyboard();
  slice.forEach((s, i) => {
    kb.text(s.key === guess ? `✅ ${s.name}` : s.name, `a:bs:${s.key}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row();
  if (page > 0) kb.text('⬅️', `a:bsp:${page - 1}`);
  kb.text(`${page + 1}/${pages}`, 'a:noop');
  if (page + 1 < pages) kb.text('➡️', `a:bsp:${page + 1}`);
  return kb.row().text('⏭ O\'tkazish', 'a:bskip').text('❌ To\'xtatish', 'a:bstop');
}


// ---------- fanlar ro'yxati ----------
const SUBJ_LIST_PAGE = 15;

export async function showSubjects(ctx, offset = 0, edit = false) {
  const all = allSubjects();
  const total = all.length;
  const slice = all.slice(offset, offset + SUBJ_LIST_PAGE);
  const pages = Math.max(1, Math.ceil(total / SUBJ_LIST_PAGE));
  const page = Math.floor(offset / SUBJ_LIST_PAGE) + 1;

  const body = slice.map((s, i) =>
    `${i + 1}. ${esc(s.uz || s.key)} / ${esc(s.ru || '—')}` + (s.seeded ? '' : ' ✏️')
  ).join('\n') || '—';

  const kb = new InlineKeyboard();
  slice.forEach((s, i) => {
    kb.text(`${i + 1}`, `a:sv:${s.key}:${offset}`);
    if (i % 5 === 4) kb.row();
  });
  kb.row();
  if (offset > 0) kb.text('⬅️', `a:subs:${offset - SUBJ_LIST_PAGE}`);
  kb.text(`${page}/${pages}`, 'a:noop');
  if (offset + SUBJ_LIST_PAGE < total) kb.text('➡️', `a:subs:${offset + SUBJ_LIST_PAGE}`);
  kb.row().text('➕ Fan qo\'shish', 'a:snew').text('📚 Ish rejalar', 'a:plans_menu');

  const text = `📖 <b>Fanlar</b> · ${total} ta\n\n${body}`;
  const opts = { parse_mode: 'HTML', reply_markup: kb };
  if (edit) return ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
  return ctx.reply(text, opts);
}

export async function showSubject(ctx, key, backOffset = 0) {
  const s = await db.getSubject(key);
  if (!s) return ctx.reply('Fan topilmadi.');

  const n = await db.countPlansBySubject(key);
  const alias = (s.alias || []).filter(a => a && a !== s.uz && a !== s.ru);

  await ctx.reply(
    `📖 <b>${esc(s.uz || key)}</b>\n` +
    `🇺🇿 ${esc(s.uz || '—')}\n🇷🇺 ${esc(s.ru || '—')}\n` +
    (alias.length ? `Tanish so'zlar: ${esc(alias.join(', '))}\n` : '') +
    `\nBazada: ${n} ta reja`,
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text('✏️ Nomini o\'zgartirish', `a:sed:${key}`).row()
        .text('🏷 Tanish so\'z qo\'shish', `a:sal:${key}`).row()
        .text('🗑 O\'chirish', `a:sdel:${key}`)
        .text('⬅️ Orqaga', `a:subs:${backOffset}`),
    }
  );
}

// Ish rejalar bo'limi menyusi
export function plansMenuKb() {
  return new InlineKeyboard()
    .text('➕ Reja qo\'shish', 'a:plan').text('📦 Ommaviy yuklash', 'a:bulk').row()
    .text('🗂 Rejalar bazasi', 'a:pfilt').text('📖 Fanlar ro\'yxati', 'a:subs:0').row()
    .text('🛠 Panel', 'a:panel');
}
