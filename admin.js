// Admin paneli: ro'yxatlar, qidiruv, balans tuzatish, ommaviy xabar
import { InlineKeyboard, InputFile } from 'grammy';
import * as db from './db.js';
import { money } from './i18n.js';

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
    .text('✉️ Xabar', 'a:msg');
}

const hasSub = r => r.sub_until && new Date(r.sub_until) >= new Date();

// "⭐💰 Ism · 12 000"
function accLine(r) {
  const marks = (hasSub(r) ? '⭐' : '') + (r.balance > 0 ? '💰' : '');
  const name = esc(r.full_name || r.login);
  return `${marks || '·'} ${name} · ${money(r.balance)}`;
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
    ? rows.map(meta.kind === 'idle' ? idleLine : accLine).join('\n')
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
