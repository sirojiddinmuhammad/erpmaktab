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
import * as admin from './admin.js';
import { subjectKey } from './subjects.js';

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

async function notifyAdmin(text, kb) {
  if (!ADMIN_ID) return;
  await bot.api.sendMessage(ADMIN_ID, text,
    { parse_mode: 'HTML', ...(kb ? { reply_markup: kb } : {}) })
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

  const kb = new InlineKeyboard().text(t(lang, 'btn_login'), 'login');
  if (u.password_enc) kb.row().text(t(lang, 'btn_refresh_classes'), 'refclass');
  const body = t(lang, 'profile', {
    name: esc(u.full_name || t(lang, 'not_set')),
    login: esc(u.username || t(lang, 'not_set')),
    lang: LANG_NAME[lang],
    balance: money(u.balance),
    plan,
    imports: u.imports_ok || 0,
  }) + classesBlock(u.classes, lang);

  await ctx.reply(body, { parse_mode: 'HTML', reply_markup: kb });
}

// Bir xil fanlar to'plamiga ega sinflar birlashtiriladi
function classesBlock(classes, lang) {
  if (!Array.isArray(classes) || !classes.length) return '';

  const groups = new Map();
  for (const c of classes) {
    const key = (c.subjects || []).join('|');
    if (!groups.has(key)) groups.set(key, { subjects: c.subjects || [], list: [] });
    groups.get(key).list.push(c.cls);
  }

  // Fani ko'p bo'lgan blok tepada
  const blocks = [...groups.values()]
    .sort((a, b) => b.subjects.length - a.subjects.length)
    .map(g => `<b>${esc(g.list.join(', '))}</b>\n${esc(g.subjects.join(', '))}`);

  return `\n\n${t(lang, 'my_classes')}\n\n${blocks.join('\n\n')}`;
}

bot.callbackQuery('refclass', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  await ctx.answerCallbackQuery();

  const creds = await db.getCreds(id);
  if (!creds) return ctx.reply(t(lang, 'need_login'));

  const wait = await ctx.reply(t(lang, 'checking'));
  const es = new EmaktabSession();
  try {
    const saved = await db.getState(id);
    let ok = saved ? await es.restore(saved) : false;
    if (!ok) {
      await es.close();
      const es2 = new EmaktabSession();
      await es2.launch();
      const { state } = await es2.login(creds.username, creds.password);
      await db.saveState(id, state);
      const cls2 = await es2.fetchClasses();
      await es2.close();
      await db.setClasses(id, cls2);
    } else {
      const cls = await es.fetchClasses();
      await db.setClasses(id, cls);
    }
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await showProfile(ctx, id, lang);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, wait.message_id,
      e.message === 'MAINTENANCE' ? t(lang, 'maintenance') : t(lang, 'error', { msg: e.message }));
  } finally {
    await es.close();
  }
});

async function showBalance(ctx, id, lang) {
  const u = await db.getUser(id);
  const linked = !!u.password_enc;
  const q = await db.checkQuota(id);
  const plan =
    q.mode === 'sub'  ? t(lang, 'plan_sub', { date: String(u.sub_until).slice(0, 10) }) :
    q.mode === 'free' ? t(lang, 'plan_free', { n: q.left }) : '';

  const kb = new InlineKeyboard();
  if (linked) kb.text(t(lang, 'btn_topup'), 'topup');
  kb.text(t(lang, 'btn_history'), 'history').row();
  if (linked) kb.text(t(lang, 'btn_sub'), 'buysub');

  await ctx.reply(t(lang, 'balance', {
    balance: money(u.balance), plan,
    price: money(db.PRICE_IMPORT), sub: money(db.PRICE_SUB),
  }) + (linked ? '' : `\n\n${t(lang, 'topup_need_login')}`),
    { parse_mode: 'HTML', reply_markup: kb });
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

  if (f.kind === 'topup' && f.stage === 'amount') {
    const amount = Number(String(text).replace(/[^\d]/g, ''));
    if (!amount || amount < 1000) return ctx.reply(t(lang, 'topup_bad_amount'));

    const payId = await db.createPayment(id, amount, null);
    f.amount = amount;
    f.payId = payId;
    f.stage = 'shot';

    const u = await db.getUser(id);
    await notifyAdmin(
      `🟡 <b>To'ldirish #${payId}</b> — skrinshot kutilmoqda\n` +
      `${esc(u.full_name || '—')}\n${who(ctx.from)}\n` +
      `Summa: <b>${money(amount)}</b> so'm\n` +
      `<i>Kartaga tushgan haqiqiy summani qo'ying.</i>`,
      payKb(payId)
    );

    return ctx.reply(t(lang, 'topup_wait_shot'), { parse_mode: 'HTML' });
  }

  if (id === ADMIN_ID && f.kind === 'plan' && f.stage === 'newsubject') {
    const [uz, ru] = text.split('|').map(x => x.trim());
    if (!uz) return ctx.reply('Nomini yozing.');

    const key = 'x-' + uz.toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 30);

    await db.addSubject(key, uz, ru || uz, [uz, ru].filter(Boolean));
    await admin.loadExtraSubjects().catch(() => {});
    f.subject = key;
    f.stage = 'quarter';
    return ctx.reply(`${f.grade}-sinf · ${esc(uz)}\n\nChorakni tanlang:`,
      { parse_mode: 'HTML', reply_markup: admin.quartersKb() });
  }

  if (id === ADMIN_ID && f.kind === 'asearch') {
    flow.delete(id);
    return admin.showSearch(ctx, text.trim());
  }

  if (id === ADMIN_ID && f.kind === 'adj_login') {
    const acc = await db.findByLogin(text.trim());
    if (!acc) return ctx.reply("Bunday login topilmadi. Qaytadan yozing.");
    flow.set(id, { kind: 'adj_sum', login: acc.login, name: acc.full_name });
    return ctx.reply(
      `${esc(acc.full_name || acc.login)}\nJoriy balans: ${money(acc.balance)} so'm\n\n` +
      `Qancha qo'shamiz? (yechish uchun manfiy son, masalan -20000)`,
      { parse_mode: 'HTML' }
    );
  }

  if (id === ADMIN_ID && f.kind === 'adj_sum') {
    const delta = Number(String(text).replace(/[^\d-]/g, ''));
    if (!delta) return ctx.reply('Summani raqam bilan yozing.');
    flow.delete(id);

    const r = await db.adminAdjust(f.login, delta);
    if (!r) return ctx.reply('Xatolik: hisob topilmadi.');

    await ctx.reply(
      `✅ ${esc(f.name || f.login)}\n${delta > 0 ? '+' : ''}${money(delta)} so'm\n` +
      `Yangi balans: ${money(r.balance)} so'm`,
      { parse_mode: 'HTML', reply_markup: admin.panelKb() }
    );

    if (r.tg_id) {
      const ul = await L(r.tg_id);
      await bot.api.sendMessage(r.tg_id,
        t(ul, delta > 0 ? 'admin_added' : 'admin_removed',
          { amount: money(Math.abs(delta)), balance: money(r.balance) }),
        { reply_markup: mainKb(ul) }).catch(() => {});
    }
    return;
  }

  if (id === ADMIN_ID && f.kind === 'bctext') {
    const ids = await db.recipients(f.audience);
    f.text = text;
    return ctx.reply(
      `✉️ <b>${admin.audienceName(f.audience)}</b> · ${ids.length} ta\n\n${text}`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('✅ Yuborish', 'a:bcgo').text('❌ Bekor', 'a:panel'),
      }
    );
  }

  // Admin boshqa summa kiritmoqda
  if (f.kind === 'payamount' && id === ADMIN_ID) {
    const amount = Number(String(text).replace(/[^\d]/g, ''));
    if (!amount) return ctx.reply('Summani raqam bilan yozing.');
    flow.delete(id);
    return finishPayment(ctx, f.payId, amount);
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
    const link = await db.linkAccount(id, username, password, fullName);
    await db.saveState(id, state);

    // Sinf va fanlarni o'qib qo'yamiz
    const classes = await es.fetchClasses();
    if (classes.length) await db.setClasses(id, classes);

    // Oldingi Telegram uzildi — unga xabar beramiz
    for (const old of link.prevTgIds) {
      const oldLang = await L(old);
      await bot.api.sendMessage(old, t(oldLang, 'unlinked')).catch(() => {});
    }
    await ctx.api.editMessageText(ctx.chat.id, wait.message_id,
      fullName ? t(lang, 'connected', { name: fullName }) : t(lang, 'connected_no'));

    await notifyAdmin(
      `${link.isNew ? '✅ <b>Yangi eMaktab hisobi</b>' : '🔄 <b>Hisob qayta ulandi</b>'}\n` +
      `${esc(fullName || '—')}\n${who(ctx.from)}\n` +
      `Login: <code>${esc(username)}</code>` +
      (link.prevTgIds.length ? `\n⚠️ Oldingi Telegram uzildi: ${link.prevTgIds.join(', ')}` : '')
    );
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, wait.message_id,
      e.message === 'MAINTENANCE' ? t(lang, 'maintenance')
      : e.message.startsWith('BAD_CREDENTIALS') ? t(lang, 'bad_creds')
      : t(lang, 'error', { msg: e.message }));
  } finally {
    await es.close();
  }
}

// ---------- balans: to'ldirish ----------
bot.callbackQuery('topup', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  await ctx.answerCallbackQuery();

  if (!(await db.getCreds(id))) return ctx.reply(t(lang, 'topup_need_login'));

  flow.set(id, { kind: 'topup', stage: 'amount' });
  await ctx.reply(
    t(lang, 'topup_card', { card: CARD, holder: esc(CARD_HOLDER), ref: id }),
    { parse_mode: 'HTML' }
  );
});

// Admin uchun to'lov tugmalari
const payKb = payId => new InlineKeyboard()
  .text('✅ Tasdiqlash', `pay:ok:${payId}`)
  .text('✏️ Boshqa summa', `pay:edit:${payId}`).row()
  .text('❌ Rad etish', `pay:no:${payId}`);

bot.on('message:photo', async ctx => {
  const id = ctx.from.id;
  const lang = await L(id);
  const f = flow.get(id);
  if (f?.kind !== 'topup' || f.stage !== 'shot') return;

  const fileId = ctx.message.photo.at(-1).file_id;
  await db.attachPhoto(f.payId, fileId);
  const payId = f.payId;
  const amount = f.amount;
  flow.delete(id);

  await ctx.reply(t(lang, 'topup_sent'), { reply_markup: mainKb(lang) });

  if (ADMIN_ID) {
    const u = await db.getUser(id);
    await bot.api.sendPhoto(ADMIN_ID, fileId, {
      caption: `💰 <b>To'ldirish #${payId}</b>\n` +
               `${esc(u.full_name || '—')}\n${who(ctx.from)}\n` +
               `Summa: <b>${money(amount)}</b> so'm`,
      parse_mode: 'HTML',
      reply_markup: payKb(payId),
    }).catch(e => console.error('admin xabar:', e.message));
  }
});

// To'lovni yakunlash (tasdiqlash yoki boshqa summa bilan)
async function finishPayment(ctx, payId, amount = null) {
  const res = await db.approvePayment(payId, amount);
  if (!res) return ctx.reply(`⚠️ #${payId} allaqachon ko'rilgan`);

  await ctx.reply(
    `✅ Tasdiqlandi #${payId}\n+${money(res.amount)} so'm · Balans: ${money(res.balance)}`
  );

  const lang = await L(res.tgId);
  await bot.api.sendMessage(res.tgId,
    t(lang, 'topup_ok', { amount: money(res.amount), balance: money(res.balance) }),
    { reply_markup: mainKb(lang) }
  ).catch(() => {});
}

bot.callbackQuery(/^pay:(ok|no|edit|undo):(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery("Ruxsat yo'q");
  const [, action, idStr] = ctx.match;
  const payId = Number(idStr);
  await ctx.answerCallbackQuery();

  if (action === 'undo') {
    const r = await db.undoReject(payId);
    if (!r) return ctx.reply(`⚠️ #${payId} qaytarib bo'lmadi.`);
    return finishPayment(ctx, payId);
  }

  if (action === 'edit') {
    flow.set(ADMIN_ID, { kind: 'payamount', payId });
    return ctx.reply(`#${payId} — kartaga tushgan haqiqiy summani yozing:`);
  }

  if (action === 'no') {
    const tgId = await db.rejectPayment(payId);
    await ctx.reply(`❌ Rad etildi #${payId}`, {
      reply_markup: new InlineKeyboard().text('↩️ Qaytarish', `pay:undo:${payId}`),
    });
    if (tgId) {
      const lang = await L(tgId);
      await bot.api.sendMessage(tgId, t(lang, 'topup_rejected')).catch(() => {});
    }
    return;
  }

  return finishPayment(ctx, payId);
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

  const af = flow.get(id);

  // Ommaviy yuklash: faylni navbatga qo'shamiz
  if (id === ADMIN_ID && af?.kind === 'bulk' && af.stage === 'files') {
    const doc = ctx.message.document;
    if (!/\.xlsx?$/i.test(doc.file_name || '')) return;

    const h = parseFileName(doc.file_name);
    let topics = null;
    if (/\.xlsx$/i.test(doc.file_name)) {
      try {
        const g = await ctx.api.getFile(doc.file_id);
        const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${g.file_path}`;
        await fs.mkdir(TMP, { recursive: true });
        const local = path.join(TMP, `b_${Date.now()}.xlsx`);
        await fs.writeFile(local, Buffer.from(await (await fetch(url)).arrayBuffer()));
        topics = (await readRows(local)).rows.length;
        await fs.unlink(local).catch(() => {});
      } catch {}
    }

    af.queue.push({
      fileId: doc.file_id,
      name: doc.file_name,
      topics,
      gradeGuess: h.grade || null,
      subjectGuess: guessSubject(doc.file_name, af.medium),
    });
    af.total = af.queue.length;

    // Har bir faylga javob bermaymiz — har 5 tada bir marta
    if (af.queue.length % 5 === 0 || af.queue.length === 1) {
      await ctx.reply(`📥 ${af.queue.length} ta fayl navbatda`, {
        reply_markup: new InlineKeyboard()
          .text('▶️ Boshlash', 'a:bgo').text('❌ To\'xtatish', 'a:bstop'),
      });
    }
    return;
  }

  // Admin ish reja yuklayapti
  if (id === ADMIN_ID && af?.kind === 'plan' && af.stage === 'file') {
    const doc = ctx.message.document;
    if (!/\.xlsx?$/i.test(doc.file_name || '')) return ctx.reply('Faqat .xls yoki .xlsx');

    af.fileId = doc.file_id;
    af.fileName = doc.file_name;
    af.topics = null;

    // Mavzular sonini hisoblaymiz (.xlsx uchun)
    if (/\.xlsx$/i.test(doc.file_name)) {
      try {
        const f = await ctx.api.getFile(doc.file_id);
        const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${f.file_path}`;
        await fs.mkdir(TMP, { recursive: true });
        const local = path.join(TMP, `plan_${Date.now()}.xlsx`);
        await fs.writeFile(local, Buffer.from(await (await fetch(url)).arrayBuffer()));
        const parsed = await readRows(local);
        af.topics = parsed.rows.length;
        await fs.unlink(local).catch(() => {});
      } catch {}
    }

    af.stage = 'grade';
    return ctx.reply(
      `📄 ${esc(doc.file_name)}` + (af.topics ? `\n${af.topics} ta mavzu` : '') +
      `\n\nSinfni tanlang:`,
      { parse_mode: 'HTML', reply_markup: admin.gradesKb() }
    );
  }

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
    await ctx.reply(
      e.message === 'MAINTENANCE' ? t(lang, 'maintenance')
      : e.message.startsWith('BAD_CREDENTIALS') ? t(lang, 'bad_creds')
      : t(lang, 'error', { msg: e.message })
    );
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
  // Diagnostika: xato qatorlarning sababini logga yozamiz
  for (const r of s.siteRows.filter(x => !x.ok))
    console.log(`[xato qator] ${r.lesson}. ${r.topic} -> ${r.status}`);
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
    await ctx.reply(e.message === 'MAINTENANCE'
      ? t(lang, 'maintenance') : t(lang, 'error', { msg: e.message }));
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
    await ctx.reply(e.message === 'MAINTENANCE'
      ? t(lang, 'maintenance') : t(lang, 'error', { msg: e.message }));
  } finally {
    await endSession(id);
  }
});

// ---------- admin paneli ----------
const isAdmin = ctx => ctx.from?.id === ADMIN_ID;

// Admin uchun joriy filtr (bitta admin bo'lgani uchun yagona obyekt yetarli)
const planFilter = {};

bot.command('admin', async ctx => {
  if (!isAdmin(ctx)) return;
  await ctx.reply('🛠 <b>Admin panel</b>', { parse_mode: 'HTML', reply_markup: admin.panelKb() });
});
bot.command('stats', async ctx => { if (isAdmin(ctx)) await admin.showStats(ctx); });

bot.callbackQuery(/^a:(.+)$/, async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCallbackQuery("Ruxsat yo'q");
  const parts = ctx.match[1].split(':');
  const cmd = parts[0];
  await ctx.answerCallbackQuery();

  if (cmd === 'noop') return;

  if (cmd === 'panel')
    return ctx.reply('🛠 <b>Admin panel</b>', { parse_mode: 'HTML', reply_markup: admin.panelKb() });

  if (cmd === 'stats') return admin.showStats(ctx);

  if (cmd === 'l') return admin.showList(ctx, parts[1], Number(parts[2]) || 0, true);
  if (cmd === 'f') return admin.sendListFile(ctx, parts[1]);

  if (cmd === 'search') {
    flow.set(ADMIN_ID, { kind: 'asearch' });
    return ctx.reply("🔍 Ism, login yoki Telegram ID ni yozing:");
  }

  if (cmd === 'adj') {
    flow.set(ADMIN_ID, { kind: 'adj_login' });
    return ctx.reply('➕ eMaktab loginini yozing:');
  }

  // --- ommaviy yuklash ---
  if (cmd === 'bulk') {
    flow.set(ADMIN_ID, { kind: 'bulk', stage: 'medium', queue: [], saved: 0, skipped: 0 });
    return ctx.reply("📦 <b>Ommaviy yuklash</b>\n\nTa'lim tili:", {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text("🇺🇿 O'zbek", 'a:bm:uz').text('🇷🇺 Rus', 'a:bm:ru').row()
        .text('❌ Bekor', 'a:panel'),
    });
  }

  if (cmd === 'bm') {
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'bulk') return;
    f.medium = parts[1];
    f.stage = 'quarter';
    const qk = new InlineKeyboard();
    [1, 2, 3, 4].forEach(q => qk.text(`${q}-chorak`, `a:bq:${q}`));
    return ctx.reply(`${admin.MEDIUM_FLAG[f.medium]}\n\nChorakni tanlang:`,
      { reply_markup: qk.row().text('❌ Bekor', 'a:panel') });
  }

  if (cmd === 'bq') {
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'bulk') return;
    f.quarter = Number(parts[1]);
    f.year = admin.currentYear();
    f.stage = 'files';
    return ctx.reply(
      `${admin.MEDIUM_FLAG[f.medium]} · ${f.quarter}-chorak · ${f.year}\n\n` +
      `Endi fayllarni tashlayvering. Tugagach "▶️ Boshlash" ni bosing.`,
      { reply_markup: new InlineKeyboard()
          .text('▶️ Boshlash', 'a:bgo').text('❌ To\'xtatish', 'a:bstop') }
    );
  }

  if (cmd === 'bgo') {
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'bulk') return;
    if (!f.queue.length) return ctx.reply('Hali fayl yuborilmadi.');
    return askBulkFile(ctx);
  }

  if (cmd === 'bg') {   // sinf
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'bulk' || !f.cur) return;
    f.cur.grade = Number(parts[1]);
    return ctx.reply(
      `📄 ${f.done + 1}/${f.total} · ${esc(f.cur.name)}\n${f.cur.grade}-sinf\n\nFanni tanlang:`,
      { parse_mode: 'HTML',
        reply_markup: await admin.bulkSubjectKb(0, f.medium, f.cur.subjectGuess) }
    );
  }

  if (cmd === 'bsp') {  // fan sahifasi
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'bulk') return;
    return ctx.editMessageReplyMarkup({
      reply_markup: await admin.bulkSubjectKb(Number(parts[1]), f.medium, f.cur?.subjectGuess),
    });
  }

  if (cmd === 'bs') {   // fan -> saqlash
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'bulk' || !f.cur) return;

    await db.savePlan({
      grade: f.cur.grade, subjectKey: parts.slice(1).join(':'),
      quarter: f.quarter, year: f.year, medium: f.medium,
      fileId: f.cur.fileId, fileName: f.cur.name, topics: f.cur.topics,
    });
    f.saved++;
    f.done++;
    f.cur = null;
    return askBulkFile(ctx);
  }

  if (cmd === 'bskip') {
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'bulk') return;
    f.skipped++;
    f.done++;
    f.cur = null;
    return askBulkFile(ctx);
  }

  if (cmd === 'bstop') {
    const f = flow.get(ADMIN_ID);
    flow.delete(ADMIN_ID);
    return ctx.reply(
      `⏹ To'xtatildi\nSaqlandi: ${f?.saved || 0} · O'tkazildi: ${f?.skipped || 0}`,
      { reply_markup: new InlineKeyboard().text('🛠 Panel', 'a:panel') }
    );
  }

  // --- ish rejalar ---
  if (cmd === 'plan') {
    flow.set(ADMIN_ID, { kind: 'plan', stage: 'file' });
    return ctx.reply('📚 Ish reja faylini yuboring (.xlsx yoki .xls):');
  }

  if (cmd === 'pfilt') return admin.showPlanFilter(ctx, planFilter, true);

  if (cmd === 'pfm') { planFilter.medium = parts[1]; return admin.showPlanFilter(ctx, planFilter, true); }
  if (cmd === 'pfg') { planFilter.grade = Number(parts[1]); return admin.showPlanFilter(ctx, planFilter, true); }
  if (cmd === 'pfq') { planFilter.quarter = Number(parts[1]); return admin.showPlanFilter(ctx, planFilter, true); }

  if (cmd === 'plans') {
    if (!planFilter.medium || !planFilter.grade || !planFilter.quarter)
      return admin.showPlanFilter(ctx, planFilter, true);
    return admin.showPlans(ctx, Number(parts[1]) || 0, true, planFilter);
  }

  if (cmd === 'pg') {   // sinf tanlandi -> ta'lim tili
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'plan') return;
    f.grade = Number(parts[1]);
    f.stage = 'medium';
    return ctx.reply(`${f.grade}-sinf\n\nTa'lim tili:`, { reply_markup: admin.mediumKb() });
  }

  if (cmd === 'pm') {   // til tanlandi -> fan
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'plan') return;
    f.medium = parts[1];
    f.stage = 'subject';
    return ctx.reply(
      `${f.grade}-sinf · ${admin.MEDIUM_FLAG[f.medium]}\n\nFanni tanlang:`,
      { reply_markup: await admin.subjectsKb(0, f.medium) }
    );
  }

  if (cmd === 'pv') return admin.showPlan(ctx, Number(parts[1]), Number(parts[2]) || 0);

  if (cmd === 'pf') {   // faylni yuborish
    const p = await db.getPlan(Number(parts[1]));
    if (!p) return ctx.reply('Reja topilmadi.');
    return ctx.replyWithDocument(p.file_id, { caption: p.file_name || '' });
  }

  if (cmd === 'pd') {   // o'chirishni tasdiqlash
    return ctx.reply(`🗑 Rejani o'chiramizmi?`, {
      reply_markup: new InlineKeyboard()
        .text('✅ Ha', `a:pdy:${parts[1]}`).text('❌ Yo\'q', `a:pv:${parts[1]}:0`),
    });
  }

  if (cmd === 'pdy') {
    await db.deletePlan(Number(parts[1]));
    return ctx.reply('🗑 O\'chirildi.', {
      reply_markup: new InlineKeyboard().text('🗂 Baza', 'a:pfilt'),
    });
  }

  if (cmd === 'psp') {  // fan ro'yxati sahifasi
    const f0 = flow.get(ADMIN_ID);
    return ctx.editMessageReplyMarkup({
      reply_markup: await admin.subjectsKb(Number(parts[1]), f0?.medium),
    });
  }

  if (cmd === 'psnew') {
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'plan') return;
    f.stage = 'newsubject';
    return ctx.reply("Fan nomini yozing (o'zbekcha va ruschasini | bilan ajrating):\n" +
                     "<code>Astronomiya | Астрономия</code>", { parse_mode: 'HTML' });
  }

  if (cmd === 'ps') {   // fan tanlandi
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'plan') return;
    f.subject = parts.slice(1).join(':');
    f.stage = 'quarter';
    return ctx.reply(
      `${f.grade}-sinf · ${admin.nameOf(f.subject, f.medium)}\n\nChorakni tanlang:`,
      { reply_markup: admin.quartersKb() });
  }

  if (cmd === 'pq') {   // chorak tanlandi -> o'quv yili
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'plan') return;
    f.quarter = Number(parts[1]);
    f.year = admin.currentYear();

    return ctx.reply(
      `${f.grade}-sinf · ${admin.nameOf(f.subject, f.medium)} · ${f.quarter}-chorak\n\n` +
      `O'quv yili:`,
      { reply_markup: admin.yearsKb(f.year) }
    );
  }

  if (cmd === 'py') {   // yil tanlandi -> saqlaymiz
    const f = flow.get(ADMIN_ID);
    if (f?.kind !== 'plan') return;
    const y = Number(parts[1]);
    f.year = `${y}/${y + 1}`;

    const res = await db.savePlan({
      grade: f.grade, subjectKey: f.subject, quarter: f.quarter,
      year: f.year, medium: f.medium,
      fileId: f.fileId, fileName: f.fileName, topics: f.topics,
    });
    flow.delete(ADMIN_ID);

    return ctx.reply(
      `${res.is_new ? '✅ Saqlandi' : '♻️ Yangilandi'}\n\n` +
      `${f.grade}-sinf · ${admin.nameOf(f.subject, f.medium)} · ${f.quarter}-chorak · ` +
      `${f.year} · ${admin.MEDIUM_FLAG[f.medium]}` +
      (f.topics ? `\n${f.topics} ta mavzu` : ''),
      { parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('➕ Yana qo\'shish', 'a:plan').text('🗂 Baza', 'a:pfilt') }
    );
  }

  if (cmd === 'msg') {
    return ctx.reply('✉️ Kimga yuboramiz?', { reply_markup: admin.audienceKb() });
  }

  if (cmd === 'aud') {
    flow.set(ADMIN_ID, { kind: 'bctext', audience: parts[1] });
    return ctx.reply(`✉️ <b>${admin.audienceName(parts[1])}</b>\n\nXabar matnini yozing:`,
      { parse_mode: 'HTML' });
  }

  if (cmd === 'bcgo') {
    const f = flow.get(ADMIN_ID);
    if (!f?.text) return ctx.reply('Matn topilmadi, qaytadan boshlang.');
    flow.delete(ADMIN_ID);
    return admin.broadcast(bot, ctx, f.audience, f.text);
  }
});

// Fayl nomidan fanni taxmin qilamiz
function guessSubject(fileName, medium) {
  const base = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/@[\w.-]+/g, ' ')
    .replace(/[_]+/g, ' ');
  return subjectKey(base);
}

// Ommaviy yuklash: navbatdagi faylni so'raymiz
async function askBulkFile(ctx) {
  const f = flow.get(ADMIN_ID);
  if (!f || f.kind !== 'bulk') return;

  const next = f.queue.shift();
  if (!next) {
    flow.delete(ADMIN_ID);
    return ctx.reply(
      `✅ <b>Tugadi</b>\nSaqlandi: ${f.saved} ta · O'tkazildi: ${f.skipped} ta`,
      { parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('🗂 Baza', 'a:pfilt').text('📦 Yana yuklash', 'a:bulk') }
    );
  }

  f.cur = next;
  return ctx.reply(
    `📄 ${f.done + 1}/${f.total} · ${esc(next.name)}` +
    (next.topics ? `\n${next.topics} ta mavzu` : '') +
    `\n\nSinfni tanlang:`,
    { parse_mode: 'HTML', reply_markup: admin.bulkGradeKb(next.gradeGuess) }
  );
}

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
await admin.loadExtraSubjects().catch(() => {});
console.log('DB tayyor. Bot ishga tushyapti...');
bot.start();
