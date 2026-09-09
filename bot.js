import 'dotenv/config';

const need = ['BOT_TOKEN', 'DATABASE_URL', 'ENC_KEY'].filter(k => !process.env[k]);
if (need.length) { console.error(`XATO: yo'q o'zgaruvchilar: ${need.join(', ')}`); process.exit(1); }
if (!/^[0-9a-fA-F]{64}$/.test(process.env.ENC_KEY)) {
  console.error('XATO: ENC_KEY 64 ta hex belgi bo\'lishi kerak.'); process.exit(1);
}

import { Bot, InlineKeyboard, Keyboard, InputFile } from 'grammy';
import { EmaktabSession } from './emaktab.js';
import { readRows, writeRows, parsePairs, applyMerges } from './xlsx.js';
import { parseFileName, filterOptions, AUTO_FIELDS } from './hints.js';
import { t, money, LANGS, LANG_NAME } from './i18n.js';
import * as db from './db.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const bot = new Bot(process.env.BOT_TOKEN);
const TMP = '/tmp/emaktab';
const TIMEOUT = 15 * 60 * 1000;
const CHUNK = 3500;

const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const CARD = process.env.CARD_NUMBER || '0000 0000 0000 0000';
const CARD_HOLDER = process.env.CARD_HOLDER || '';
const GUIDE_URL = process.env.GUIDE_URL || '';

const esc = x => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const live = new Map();    // import sessiyasi
const flow = new Map();    // login / topup bosqichlari
const langCache = new Map();

async function L(id) {
  if (langCache.has(id)) return langCache.get(id);
  const u = await db.ensureUser(id);
  const lang = u.lang || 'uz';
  langCache.set(id, lang);
  return lang;
}

function mainKb(lang) {
  return new Keyboard()
    .text(t(lang, 'btn_import')).row()
    .text(t(lang, 'btn_profile')).text(t(lang, 'btn_balance')).row()
    .text(t(lang, 'btn_lang')).text(t(lang, 'btn_guide'))
    .resized().persistent();
}

// Tugma matni -> amal (ikkala tilda)
const BTN = {};
for (const lg of LANGS) {
  BTN[t(lg, 'btn_import')]  = 'import';
  BTN[t(lg, 'btn_profile')] = 'profile';
  BTN[t(lg, 'btn_balance')] = 'balance';
  BTN[t(lg, 'btn_lang')]    = 'lang';
  BTN[t(lg, 'btn_cancel')]  = 'cancel';
  BTN[t(lg, 'btn_guide')]   = 'guide';
}

setInterval(() => {
  for (const [id, s] of live)
    if (Date.now() - s.es.lastUsed > TIMEOUT) { s.es.close(); live.delete(id); }
}, 60_000);

async function notifyAdmin(text) {
  if (!ADMIN_ID) return;
  await bot.api.sendMessage(ADMIN_ID, text, { parse_mode: 'HTML' })
    .catch(e => console.error('admin xabar:', e.message));
}

const who = from =>
  `${from.username ? '@' + from.username : esc(from.first_name || '')} · ` +
  `<a href="tg://user?id=${from.id}">${from.id}</a>`;

async function endSession(id) {
  const s = live.get(id);
  if (s) {
    await s.es.close();
    if (s.filePath) await fs.unlink(s.filePath).catch(() => {});
    live.delete(id);
  }
}

async function sendChunks(ctx, lines, kb, plain) {
  const parts = [];
  let buf = '';
  for (const l of lines) {
    if ((buf + l + '\n').length > CHUNK) { parts.push(buf.trimEnd()); buf = ''; }
    buf += l + '\n';
  }
  if (buf.trim()) parts.push(buf.trimEnd());

  if (parts.length > 10) {
    return ctx.replyWithDocument(
      new InputFile(Buffer.from((plain || lines).join('\n'), 'utf8'), 'mavzular.txt'),
      { reply_markup: kb }
    );
  }
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    await ctx.reply(parts[i], { parse_mode: 'HTML', ...(last ? { reply_markup: kb } : {}) });
  }
}

// ---------- /start va til ----------
bot.command('start', async ctx => {
  const id = ctx.from.id;
  const u = await db.ensureUser(id);

  if (u.is_new) await notifyAdmin(`🆕 <b>Yangi foydalanuvchi</b>\n${who(ctx.from)}`);
  if (!u.lang) return askLang(ctx, 'uz');

  const lang = await L(id);
  await ctx.reply(
    u.full_name ? t(lang, 'start_known', { name: esc(u.full_name) }) : t(lang, 'start_anon'),
    { parse_mode: 'HTML', reply_markup: mainKb(lang) }
  );
});

async function askLang(ctx, lang) {
  const kb = new InlineKeyboard();
  LANGS.forEach(l => kb.text(LANG_NAME[l], `lang:${l}`));
  await ctx.reply(t(lang, 'lang_choose'), { reply_markup: kb });
}

bot.callbackQuery(/^lang:(\w+)$/, async ctx => {
  const id = ctx.from.id;
  const lang = ctx.match[1];
  await db.setLang(id, lang);
  langCache.set(id, lang);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t(lang, 'lang_set'));
  await ctx.reply(t(lang, 'start_anon'), { reply_markup: mainKb(lang) });
});

// ---------- asosiy tugmalar ----------
async function showProfile(ctx, id, lang) {
  const u = await db.getUser(id);
  const q = await db.checkQuota(id);
  const plan =
    q.mode === 'sub'  ? t(lang, 'plan_sub', { date: String(u.sub_until).slice(0, 10) }) :
    q.mode === 'free' ? t(lang, 'plan_free', { n: q.left }) :
                        t(lang, 'plan_pay', { price: money(db.PRICE_IMPORT) });

  const kb = new InlineKeyboard()
    .text(t(lang, 'btn_login'), 'login').row()
    .text(t(lang, 'btn_rename'), 'rename');
  await ctx.reply(t(lang, 'profile', {
    name: esc(u.full_name || t(lang, 'not_set')),
    login: esc(u.username || t(lang, 'not_set')),
    lang: LANG_NAME[lang],
    balance: money(u.balance),
    plan,
    imports: u.imports_ok || 0,
  }), { parse_mode: 'HTML', reply_markup: kb });
}

async function showBalance(ctx, id, lang) {
  const u = await db.getUser(id);
  const q = await db.checkQuota(id);
  const plan =
    q.mode === 'sub'  ? t(lang, 'plan_sub', { date: String(u.sub_until).slice(0, 10) }) :
    q.mode === 'free' ? t(lang, 'plan_free', { n: q.left }) : '';

  const kb = new InlineKeyboard()
    .text(t(lang, 'btn_topup'), 'topup').text(t(lang, 'btn_history'), 'history').row()
    .text(t(lang, 'btn_sub'), 'buysub');

  await ctx.reply(t(lang, 'balance', {
    balance: money(u.balance), plan,
    price: money(db.PRICE_IMPORT), sub: money(db.PRICE_SUB),
  }), { parse_mode: 'HTML', reply_markup: kb });
}

// ---------- matnli xabarlar ----------
bot.on('message:text', async (ctx, next) => {
  const id = ctx.from.id;
  const text = ctx.message.text;
  const lang = await L(id);

  // Buyruqlarni keyingi ishlovchilarga o'tkazamiz
  if (text.startsWith('/')) return next();

  // tugmalar
  const act = BTN[text];
  if (act === 'import')  return startImport(ctx, id, lang);
  if (act === 'profile') return showProfile(ctx, id, lang);
  if (act === 'balance') return showBalance(ctx, id, lang);
  if (act === 'lang')    return askLang(ctx, lang);
  if (act === 'guide') {
    if (!GUIDE_URL) return ctx.reply(t(lang, 'guide_none'));
    return ctx.reply(t(lang, 'guide_msg'), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().webApp(t(lang, 'btn_open'), GUIDE_URL),
    });
  }
  if (act === 'cancel') {
    flow.delete(id);
    await endSession(id);
    return ctx.reply(t(lang, 'cancelled'), { reply_markup: mainKb(lang) });
  }

  // birlashtirish javobi
  const s = live.get(id);
  if (s?.step === 'merge') return handleMerge(ctx, id, lang, text);

  // login / to'ldirish bosqichlari
  const f = flow.get(id);
  if (!f) return;

  if (f.kind === 'login') {
    if (f.stage === 'user') {
      f.username = text.trim();
      f.stage = 'pass';
      return ctx.reply(t(lang, 'ask_password'));
    }
    return doLogin(ctx, id, lang, f.username, text);
  }

  if (f.kind === 'rename') {
    const name = text.trim().slice(0, 60);
    if (name.length < 3) return ctx.reply(t(lang, 'ask_name'));
    await db.setName(id, name);
    flow.delete(id);
    return ctx.reply(t(lang, 'name_saved', { name: esc(name) }),
      { parse_mode: 'HTML', reply_markup: mainKb(lang) });
  }

  if (f.kind === 'topup' && f.stage === 'amount') {
    const amount = Number(String(text).replace(/[^\d]/g, ''));
    if (!amount || amount < 1000) return ctx.reply(t(lang, 'topup_bad_amount'));
    f.amount = amount;
    f.stage = 'shot';
    return ctx.reply(t(lang, 'topup_screenshot'));
  }
});

// ---------- login ----------
bot.callbackQuery('login', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  flow.set(id, { kind: 'login', stage: 'user' });
  await ctx.answerCallbackQuery();
  await ctx.reply(t(lang, 'ask_login'));
});

async function doLogin(ctx, id, lang, username, password) {
  await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
  flow.delete(id);

  const wait = await ctx.reply(t(lang, 'checking'));
  const es = new EmaktabSession();
  try {
    await es.launch();
    const { state, fullName } = await es.login(username, password);
    await db.setCreds(id, username, password, fullName);
    await db.saveState(id, state);
    await ctx.api.editMessageText(ctx.chat.id, wait.message_id,
      fullName ? t(lang, 'connected', { name: fullName }) : t(lang, 'connected_no'));

    await notifyAdmin(
      `✅ <b>eMaktab ulandi</b>\n${esc(fullName || '—')}\n` +
      `${who(ctx.from)}\nLogin: <code>${esc(username)}</code>`
    );
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, wait.message_id,
      e.message.startsWith('BAD_CREDENTIALS')
        ? t(lang, 'bad_creds')
        : t(lang, 'error', { msg: e.message }));
  } finally {
    await es.close();
  }
}

bot.callbackQuery('rename', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  flow.set(id, { kind: 'rename' });
  await ctx.answerCallbackQuery();
  await ctx.reply(t(lang, 'ask_name'));
});

// ---------- balans: to'ldirish ----------
bot.callbackQuery('topup', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  flow.set(id, { kind: 'topup', stage: 'amount' });
  await ctx.answerCallbackQuery();
  await ctx.reply(t(lang, 'topup_card', { card: CARD, holder: esc(CARD_HOLDER) }),
    { parse_mode: 'HTML' });
});

bot.on('message:photo', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  const f = flow.get(id);
  if (f?.kind !== 'topup' || f.stage !== 'shot') return;

  const fileId = ctx.message.photo.at(-1).file_id;
  const payId = await db.createPayment(id, f.amount, fileId);
  flow.delete(id);

  await ctx.reply(t(lang, 'topup_sent'), { reply_markup: mainKb(lang) });

  if (ADMIN_ID) {
    const u = await db.getUser(id);
    const kb = new InlineKeyboard()
      .text('✅ Tasdiqlash', `pay:ok:${payId}`)
      .text('❌ Rad etish', `pay:no:${payId}`);
    await bot.api.sendPhoto(ADMIN_ID, fileId, {
      caption: `💰 <b>To'ldirish so'rovi #${payId}</b>\n` +
               `${esc(u.full_name || '—')} · @${ctx.from.username || id}\n` +
               `Summa: <b>${money(f.amount)}</b> so'm`,
      parse_mode: 'HTML',
      reply_markup: kb,
    }).catch(e => console.error('admin xabar:', e.message));
  }
});

bot.callbackQuery(/^pay:(ok|no):(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery('Ruxsat yo\'q');
  const [, action, idStr] = ctx.match;
  const payId = Number(idStr);
  await ctx.answerCallbackQuery();

  if (action === 'no') {
    const tgId = await db.rejectPayment(payId);
    await ctx.editMessageCaption({ caption: `❌ Rad etildi (#${payId})` });
    if (tgId) {
      const lang = await L(tgId);
      await bot.api.sendMessage(tgId, t(lang, 'topup_rejected')).catch(() => {});
    }
    return;
  }

  const res = await db.approvePayment(payId);
  if (!res) return ctx.editMessageCaption({ caption: `⚠️ #${payId} allaqachon ko'rilgan` });

  await ctx.editMessageCaption({
    caption: `✅ Tasdiqlandi (#${payId})\n+${money(res.amount)} so'm · Balans: ${money(res.balance)}`,
  });
  const lang = await L(res.tgId);
  await bot.api.sendMessage(res.tgId,
    t(lang, 'topup_ok', { amount: money(res.amount), balance: money(res.balance) }),
    { reply_markup: mainKb(lang) }
  ).catch(() => {});
});

bot.callbackQuery('history', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  await ctx.answerCallbackQuery();

  const rows = await db.ledgerRecent(id);
  if (!rows.length) return ctx.reply(t(lang, 'history_empty'));

  const label = { topup: '➕', import: '📤', subscription: '⭐' };
  const list = rows.map(r =>
    `${label[r.reason] || '•'} ${r.delta > 0 ? '+' : ''}${money(r.delta)} · ` +
    `${new Date(r.created_at).toISOString().slice(0, 10)}`
  ).join('\n');

  await ctx.reply(t(lang, 'history', { rows: list }), { parse_mode: 'HTML' });
});

bot.callbackQuery('buysub', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  await ctx.answerCallbackQuery();

  const r = await db.buySub(id);
  if (r.ok) {
    return ctx.reply(t(lang, 'sub_bought', { date: String(r.until).slice(0, 10) }),
      { reply_markup: mainKb(lang) });
  }
  if (r.reason === 'have') {
    return ctx.reply(t(lang, 'sub_have', { date: String(r.until).slice(0, 10) }));
  }
  return ctx.reply(t(lang, 'sub_nomoney', {
    sub: money(db.PRICE_SUB), balance: money(r.balance),
  }));
});

// ---------- import ----------
async function startImport(ctx, id, lang) {
  if (!(await db.getCreds(id)))
    return ctx.reply(t(lang, 'need_login'), { reply_markup: mainKb(lang) });

  const q = await db.checkQuota(id);
  if (!q.ok) {
    return ctx.reply(t(lang, 'no_money', {
      price: money(db.PRICE_IMPORT), balance: money(q.balance),
    }), { reply_markup: mainKb(lang) });
  }

  await endSession(id);
  live.set(id, { es: new EmaktabSession(), step: 'await_file', fields: [], asked: [], answers: [], quota: q });
  await ctx.reply(t(lang, 'send_file'), { reply_markup: mainKb(lang) });
}
bot.command('import', async ctx => startImport(ctx, ctx.from.id, await L(ctx.from.id)));

bot.on('message:document', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  const s = live.get(id);
  if (!s || s.step !== 'await_file') return;

  const doc = ctx.message.document;
  if (!/\.xlsx?$/i.test(doc.file_name || '')) return ctx.reply(t(lang, 'only_xlsx'));
  if (doc.file_size > 5_000_000) return ctx.reply(t(lang, 'too_big'));

  const wait = await ctx.reply(t(lang, 'file_got'));

  try {
    const f = await ctx.api.getFile(doc.file_id);
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${f.file_path}`;
    await fs.mkdir(TMP, { recursive: true });
    const local = path.join(TMP, `${id}_${Date.now()}${path.extname(doc.file_name)}`);
    await fs.writeFile(local, Buffer.from(await (await fetch(url)).arrayBuffer()));

    s.filePath = local;
    s.hints = parseFileName(doc.file_name);
    s.canMerge = /\.xlsx$/i.test(doc.file_name);
    if (s.canMerge) {
      try {
        const p = await readRows(local);
        s.rows = p.rows;
        s.sheetName = p.sheetName;
      } catch { s.canMerge = false; }
    }

    const saved = await db.getState(id);
    let ok = saved ? await s.es.restore(saved) : false;
    if (!ok) {
      await s.es.close();
      s.es = new EmaktabSession();
      await s.es.launch();
      const { username, password } = await db.getCreds(id);
      const { state } = await s.es.login(username, password);
      await db.saveState(id, state);
    }

    // Ism bazada yo'q bo'lsa, sahifadan o'qib olamiz
    const u = await db.getUser(id);
    if (!u.full_name) {
      const nm = await s.es.fetchNameIfNeeded();
      if (nm) await db.setName(id, nm);
    }

    await s.es.uploadFile(local);
    s.step = 'params';
    s.fields = [...FIELDS];
    s.asked = [];
    s.answers = [];
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await askNext(ctx, id, lang);
  } catch (e) {
    await endSession(id);
    await ctx.reply(e.message.startsWith('BAD_CREDENTIALS')
      ? t(lang, 'bad_creds') : t(lang, 'error', { msg: e.message }));
  }
});

const FIELDS = [
  { label: 'Учебный год',    uz: "O'quv yili",   ru: 'учебный год' },
  { label: 'Класс',          uz: 'Sinf',         ru: 'класс' },
  { label: 'Предмет',        uz: 'Fan',          ru: 'предмет' },
  { label: 'Учебная группа', uz: "O'quv guruhi", ru: 'учебную группу' },
  { label: 'Учебный период', uz: 'Davr',         ru: 'период' },
];

async function askNext(ctx, id, lang) {
  const s = live.get(id);
  s.es.touch();

  const field = s.fields.shift();
  if (!field) return startMapping(ctx, id, lang);

  const all = await s.es.options(field.label);
  if (!all.length) {
    const info = await s.es.debugSelect(field.label);
    await endSession(id);
    return ctx.reply(t(lang, 'empty_list', { field: field[lang], info }));
  }

  const showAll = s.showAllFor === field.label;
  const hit = showAll ? [] : filterOptions(field.label, all, s.hints);
  const opts = hit.length ? hit : all;
  const filtered = opts.length < all.length;

  if (all.length === 1 || (filtered && opts.length === 1 && AUTO_FIELDS.has(field.label))) {
    await s.es.pick(field.label, opts[0].index);
    s.asked.push(field);
    s.answers.push({ label: field.label, optionLabel: opts[0].label });
    s.showAllFor = null;
    return askNext(ctx, id, lang);
  }

  s.current = field;
  s.opts = opts;

  const kb = new InlineKeyboard();
  opts.slice(0, 60).forEach((o, i) => {
    kb.text(o.label, `p:${i}`);
    if (i % 3 === 2) kb.row();
  });
  kb.row();
  if (filtered) kb.text(t(lang, 'btn_all'), 'all');
  if (s.asked.length) kb.text(t(lang, 'btn_back'), 'back');
  kb.text(t(lang, 'btn_cancel'), 'no');

  const done = s.answers.map(a => `<i>${esc(a.optionLabel)}</i>`).join(' · ');
  await ctx.reply(
    (done ? `${done}\n\n` : '') +
    t(lang, 'choose', { field: esc(field[lang]) }) + (filtered ? t(lang, 'by_file') : ''),
    { parse_mode: 'HTML', reply_markup: kb }
  );
}

bot.callbackQuery(/^p:(\d+)$/, async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  const s = live.get(id);
  if (!s?.current) return ctx.answerCallbackQuery(t(lang, 'session_end'));

  const opt = s.opts[Number(ctx.match[1])];
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`${esc(s.current[lang])}: ${esc(opt.label)} ✅`, { parse_mode: 'HTML' });

  await s.es.pick(s.current.label, opt.index);
  s.asked.push(s.current);
  s.answers.push({ label: s.current.label, optionLabel: opt.label });
  s.showAllFor = null;
  s.current = null;
  await askNext(ctx, id, lang);
});

bot.callbackQuery('all', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  const s = live.get(id);
  if (!s?.current) return ctx.answerCallbackQuery(t(lang, 'session_end'));

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t(lang, 'full_list'));
  s.showAllFor = s.current.label;
  s.fields.unshift(s.current);
  s.current = null;
  await askNext(ctx, id, lang);
});

bot.callbackQuery('back', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  const s = live.get(id);
  if (!s?.current || !s.asked.length) return ctx.answerCallbackQuery(t(lang, 'session_end'));

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t(lang, 'btn_back'));
  s.fields.unshift(s.current);
  s.fields.unshift(s.asked.pop());
  s.answers.pop();
  s.showAllFor = null;
  s.current = null;
  await askNext(ctx, id, lang);
});

// ---------- ustun mosligi ----------
async function startMapping(ctx, id, lang) {
  const s = live.get(id);
  await ctx.reply(t(lang, 'mapping'));

  const res = await s.es.mapColumns();
  if (res.done === res.need) return submitAndPreview(ctx, id, lang);

  const sels = await s.es.mappingSelects();
  if (!sels.length) {
    await endSession(id);
    return ctx.reply(t(lang, 'no_map', { report: res.report }));
  }
  s.manual = sels;
  await ctx.reply(t(lang, 'manual_map'));
  return askMapping(ctx, id, lang);
}

async function askMapping(ctx, id, lang) {
  const s = live.get(id);
  s.es.touch();
  const item = s.manual.shift();
  if (!item) return submitAndPreview(ctx, id, lang);

  s.curMap = item;
  const kb = new InlineKeyboard();
  item.options.forEach((o, i) => kb.text(o.label, `m:${i}`).row());
  kb.text(t(lang, 'btn_cancel'), 'no');
  await ctx.reply(t(lang, 'map_q', { col: esc(item.label) }), { parse_mode: 'HTML', reply_markup: kb });
}

bot.callbackQuery(/^m:(\d+)$/, async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  const s = live.get(id);
  if (!s?.curMap) return ctx.answerCallbackQuery(t(lang, 'session_end'));

  const opt = s.curMap.options[Number(ctx.match[1])];
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`${esc(s.curMap.label)} → ${esc(opt.label)} ✅`, { parse_mode: 'HTML' });
  await s.es.setSelect(s.curMap.selectIndex, opt.index);
  s.curMap = null;
  await askMapping(ctx, id, lang);
});

// ---------- tekshiruv ----------
async function submitAndPreview(ctx, id, lang) {
  const s = live.get(id);
  await s.es.submitMapping();

  const { rows, diag, mapReport } = await s.es.preview();
  if (!rows.length) {
    await endSession(id);
    return ctx.reply(t(lang, 'no_table', { info: `${mapReport}\n\n${diag}` }).slice(0, 3800));
  }

  s.siteRows = rows.map(r => ({
    ...r,
    ok: typeof r.ok === 'boolean' ? r.ok : /Готов|Tayyor/i.test(r.status || ''),
  }));
  s.bad = s.siteRows.filter(r => !r.ok);
  s.ok = s.siteRows.length - s.bad.length;
  s.step = 'confirm';

  await renderPreview(ctx, id, lang, false);
}

const lines_ = s => {
  const w = String(s.siteRows.length).length;
  return s.siteRows.map(r => {
    const n = String(r.lesson || r.n).padStart(w, ' ');
    const hw = r.hw ? ` — <i>${esc(r.hw)}</i>` : '';
    return r.ok ? `${n}. ${esc(r.topic)}${hw}` : `⚠️ <b>${n}. ${esc(r.topic)}</b>${hw}`;
  });
};
const plain_ = s => s.siteRows.map(r => `${r.lesson || r.n}. ${r.topic}${r.hw ? ` — ${r.hw}` : ''}`);

function header_(s, lang) {
  const get = l => s.answers.find(a => a.label === l)?.optionLabel || '';
  const subject = esc(get('Предмет'));
  const rest = [get('Класс'), get('Учебный период')].filter(Boolean).map(esc).join(' · ');
  const total = s.siteRows.length;
  const bad = s.bad.length;

  const title = `📗 <b>${subject}</b>${rest ? ` · ${rest}` : ''}`;
  const stats = bad
    ? t(lang, 'stats_bad', { n: total, ok: s.ok, bad })
    : t(lang, 'stats_ok', { n: total });

  if (!bad) return `${title}\n${stats}`;
  const nums = s.bad.slice(0, 10).map(r => r.lesson || r.n).join(', ') + (bad > 10 ? '…' : '');
  return `${title}\n${stats}\n\n${t(lang, 'bad_rows', { nums })}`;
}

function costNote(s, lang) {
  const q = s.quota || {};
  if (q.mode === 'sub')  return t(lang, 'cost_sub');
  if (q.mode === 'free') return t(lang, 'cost_free', { n: q.left });
  return t(lang, 'cost_note', { price: money(db.PRICE_IMPORT) });
}

function previewKb(s, lang, truncated) {
  const kb = new InlineKeyboard().text(t(lang, 'btn_ok'), 'go');
  if (s.canMerge) kb.text(t(lang, 'btn_merge'), 'merge');
  kb.row();
  if (truncated) kb.text(t(lang, 'btn_full'), 'full');
  kb.text(t(lang, 'btn_cancel'), 'no');
  return kb;
}

async function renderPreview(ctx, id, lang, full) {
  const s = live.get(id);
  const lines = lines_(s);
  const head = header_(s, lang);
  const tail = `\n\n${t(lang, 'confirm_q')}${costNote(s, lang)}`;

  if (full) {
    await ctx.reply(head, { parse_mode: 'HTML' });
    return sendChunks(ctx, [...lines, tail], previewKb(s, lang, false), plain_(s));
  }

  const whole = `${head}\n\n${lines.join('\n')}${tail}`;
  if (whole.length <= CHUNK)
    return ctx.reply(whole, { parse_mode: 'HTML', reply_markup: previewKb(s, lang, false) });

  const bad = lines.filter(l => l.startsWith('⚠️')).slice(0, 5);
  const short = [...lines.slice(0, 3), '…', ...(bad.length ? bad : [lines.at(-1)])].join('\n');
  await ctx.reply(`${head}\n\n${short}${tail}`,
    { parse_mode: 'HTML', reply_markup: previewKb(s, lang, true) });
}

bot.callbackQuery('full', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  if (!live.get(id)?.siteRows) return ctx.answerCallbackQuery(t(lang, 'session_end'));
  await ctx.answerCallbackQuery();
  await renderPreview(ctx, id, lang, true);
});

// ---------- birlashtirish ----------
bot.callbackQuery('merge', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  const s = live.get(id);
  if (!s?.rows) return ctx.answerCallbackQuery(t(lang, 'session_end'));

  await ctx.answerCallbackQuery();
  s.step = 'merge';
  await ctx.reply(t(lang, 'merge_prompt'), { parse_mode: 'HTML' });
});

async function handleMerge(ctx, id, lang, text) {
  const s = live.get(id);
  const { pairs, error } = parsePairs(text, s.rows.length);
  if (error) return ctx.reply(t(lang, 'merge_err', { err: error }));

  const merged = applyMerges(s.rows, pairs);
  const wait = await ctx.reply(t(lang, 'merged', { from: s.rows.length, to: merged.length }));

  try {
    const p = path.join(TMP, `${id}_${Date.now()}_merged.xlsx`);
    await writeRows(merged, p, s.sheetName);
    await fs.unlink(s.filePath).catch(() => {});
    s.filePath = p;
    s.rows = merged;

    await s.es.uploadFile(p);
    await s.es.applyParams(s.answers.map(a => ({ label: a.label, optionLabel: a.optionLabel })));
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    s.step = 'params';
    await startMapping(ctx, id, lang);
  } catch (e) {
    s.step = 'confirm';
    await ctx.reply(t(lang, 'error', { msg: e.message }));
  }
}

// ---------- yakun ----------
bot.callbackQuery('no', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  await ctx.answerCallbackQuery();
  await endSession(id);
  await ctx.editMessageText(t(lang, 'cancelled'));
});

bot.callbackQuery('go', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  const s = live.get(id);
  if (!s) return ctx.answerCallbackQuery(t(lang, 'session_end'));

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t(lang, 'uploading'));

  try {
    const shot = await s.es.confirmImport();

    // Pul faqat shu yerda yechiladi
    const charge = await db.chargeImport(id);

    let caption = t(lang, 'done', { n: s.ok });
    if (s.bad.length) {
      caption += t(lang, 'skipped', {
        n: s.bad.length,
        rows: s.bad.map(r => `${r.lesson || r.n}. ${esc(r.topic)}`).join('\n'),
      });
    }
    if (charge.ok && charge.mode === 'paid') {
      caption += t(lang, 'charged', {
        price: money(db.PRICE_IMPORT), balance: money(charge.balance),
      });
    } else if (charge.ok && charge.mode === 'free') {
      caption += t(lang, 'cost_free', { n: charge.left });
    }

    await ctx.replyWithPhoto(new InputFile(shot, 'result.png'), {
      caption: caption.slice(0, 1000),
      parse_mode: 'HTML',
      reply_markup: mainKb(lang),
    });
  } catch (e) {
    await ctx.reply(t(lang, 'error', { msg: e.message }));
  } finally {
    await endSession(id);
  }
});

// ---------- admin hisoboti ----------
bot.command('stats', async ctx => {
  if (ctx.from.id !== ADMIN_ID) return;
  const { users, imp, pay, top } = await db.stats();

  const topList = top.length
    ? top.map((r, i) => `${i + 1}. ${esc(r.name)} — ${r.imports_ok} ta`).join('\n')
    : '—';

  await ctx.reply(
    `📊 <b>Hisobot</b>\n\n` +
    `👥 <b>Foydalanuvchilar</b>\n` +
    `Jami: ${users.total}\n` +
    `eMaktab ulangan: ${users.linked}\n` +
    `Import qilgan: ${users.active}\n` +
    `Bugun qo'shildi: ${users.today}\n\n` +
    `📤 <b>Importlar</b>\n` +
    `Bugun: ${imp.today}\n` +
    `7 kunda: ${imp.week}\n` +
    `Jami: ${users.imports_total}\n\n` +
    `💰 <b>Pul</b>\n` +
    `Balanslarda: ${money(users.balances)} so'm\n` +
    `Jami to'lovlar: ${money(pay.total)} so'm\n` +
    `Obunachilar: ${users.subs} ta\n\n` +
    `🏆 <b>Eng faollar</b>\n${topList}`,
    { parse_mode: 'HTML' }
  );
});

// ---------- qo'llanma (Telegram Mini App) ----------
// Railway PORT bersa, guide.html shu manzilda ochiladi.
if (process.env.PORT) {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(dir, 'guide.html');

  http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];

    if (url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok');
    }

    try {
      const html = await fs.readFile(file, 'utf8');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300',
      });
      res.end(html);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end("guide.html topilmadi");
    }
  }).listen(process.env.PORT, () => {
    console.log(`Qo'llanma serveri: port ${process.env.PORT}`);
  });
}

bot.catch(err => console.error('bot error', err));

await db.ensureSchema();
console.log('DB tayyor. Bot ishga tushyapti...');
bot.start();
