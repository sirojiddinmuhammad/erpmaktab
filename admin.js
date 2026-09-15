// Admin paneli: ro'yxatlar, qidiruv, balans tuzatish, ommaviy xabar
import { InlineKeyboard, InputFile } from 'grammy';
import * as db from './db.js';
import { money } from './i18n.js';
import { SUBJECTS, COMBOS, subjectName } from './subjects.js';

// Qo'lda qo'shilgan fanlar (bazadan), nom topish uchun
const extraNames = new Map();

export async function loadExtraSubjects() {
  const rows = await db.extraSubjects();
  extraNames.clear();
  for (const r of rows) extraNames.set(r.key, { uz: r.uz, ru: r.ru });
  return rows.length;
}

// Lug'atdan yoki bazadan fan nomini oladi
export function nameOf(key, lang = 'uz') {
  const e = extraNames.get(key);
  if (e) return e[lang] || e.uz || key;
  return subjectName(key, lang);
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
    .text('📚 Reja qo\'shish', 'a:plan').text('🗂 Rejalar bazasi', 'a:pfilt').row()
    .text('✉️ Xabar', 'a:msg');
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
  const extra = await db.extraSubjects();
  const all = [
    ...SUBJECTS.map(s => ({ key: s.key, uz: s[L] || s.uz })),
    ...COMBOS.map(s => ({ key: s.key, uz: s[L] || s.uz })),
    ...extra.map(s => ({ key: s.key, uz: s[L] || s.uz || s.key })),
  ].filter((s, i, arr) => arr.findIndex(x => x.key === s.key) === i);

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
const STAGE_NAME = { low: "Boshlang'ich 1-4", high: 'Yuqori 5-11' };

// Filtr tanlash ekrani
export async function showPlanFilter(ctx, f = {}, edit = false) {
  const total = await db.countPlans();

  const mark = (on, label) => (on ? `✅ ${label}` : label);
  const kb = new InlineKeyboard()
    .text(mark(f.medium === 'uz', "🇺🇿 O'zbek"), 'a:pfm:uz')
    .text(mark(f.medium === 'ru', '🇷🇺 Rus'), 'a:pfm:ru').row()
    .text(mark(f.stage === 'low', STAGE_NAME.low), 'a:pfs:low')
    .text(mark(f.stage === 'high', STAGE_NAME.high), 'a:pfs:high').row()
    .text(mark(f.quarter === 1, '1-chorak'), 'a:pfq:1')
    .text(mark(f.quarter === 2, '2-chorak'), 'a:pfq:2').row()
    .text(mark(f.quarter === 3, '3-chorak'), 'a:pfq:3')
    .text(mark(f.quarter === 4, '4-chorak'), 'a:pfq:4').row();

  const ready = f.medium && f.stage && f.quarter;
  if (ready) kb.text("📋 Ro'yxatni ko'rish", 'a:plans:0').row();
  kb.text('📚 Reja qo\'shish', 'a:plan').text('🛠 Panel', 'a:panel');

  const text = `🗂 <b>Rejalar bazasi</b> · ${total} ta\n\n` +
    (ready ? 'Tanlandi. Ro\'yxatni ko\'rishingiz mumkin.' : 'Til, sinf va chorakni tanlang:');

  const opts = { parse_mode: 'HTML', reply_markup: kb };
  if (edit) return ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
  return ctx.reply(text, opts);
}

export async function showPlans(ctx, offset = 0, edit = false, filter = {}) {
  const { rows, total } = await db.listPlans(offset, PLAN_PAGE, filter);
  const pages = Math.max(1, Math.ceil(total / PLAN_PAGE));
  const page = Math.floor(offset / PLAN_PAGE) + 1;

  // Sinf bo'yicha guruhlaymiz (til, chorak, yil sarlavhada)
  const groups = new Map();
  rows.forEach((r, i) => {
    const key = `${r.grade}-sinf`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...r, n: i + 1 });
  });

  const lang = filter.medium === 'ru' ? 'ru' : 'uz';
  const body = [...groups.entries()].map(([g, list]) =>
    `<b>${esc(g)}</b>\n` + list.map(r =>
      `${r.n}. ${esc(nameOf(r.subject_key, lang))}` +
      (r.topics ? ` · ${r.topics} mavzu` : '')
    ).join('\n')
  ).join('\n\n') || '—';

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
    STAGE_NAME[filter.stage] || '',
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
