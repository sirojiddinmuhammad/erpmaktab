import 'dotenv/config';

// --- muhit o'zgaruvchilarini tekshirish ---
const missing = ['BOT_TOKEN', 'DATABASE_URL', 'ENC_KEY'].filter(k => !process.env[k]);
if (missing.length) {
  console.error(`XATO: quyidagi o'zgaruvchilar yo'q: ${missing.join(', ')}`);
  process.exit(1);
}
if (!/^[0-9a-fA-F]{64}$/.test(process.env.ENC_KEY)) {
  console.error("XATO: ENC_KEY 64 ta hex belgi bo'lishi kerak. Yaratish: openssl rand -hex 32");
  process.exit(1);
}
try {
  const u = new URL(process.env.DATABASE_URL);
  console.log(`DB: host=${u.hostname} user=${u.username} db=${u.pathname.slice(1)} parol=${u.password ? 'bor' : "YO'Q"}`);
  if (!u.password) { console.error('XATO: DATABASE_URL ichida parol yo\'q.'); process.exit(1); }
} catch {
  console.error('XATO: DATABASE_URL noto\'g\'ri formatda.');
  process.exit(1);
}

import { Bot, InlineKeyboard, Keyboard, InputFile } from 'grammy';
import { EmaktabSession } from './emaktab.js';
import { readRows, writeRows, parsePairs, applyMerges } from './xlsx.js';
import { parseFileName, filterOptions, AUTO_FIELDS } from './hints.js';
import { getCreds, setCreds, saveState, getState, getName, ensureSchema } from './db.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const bot = new Bot(process.env.BOT_TOKEN);
const TMP = '/tmp/emaktab';
const TIMEOUT = 15 * 60 * 1000;
const CHUNK = 3500;

const esc = t => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const live = new Map();     // userId -> sessiya
const pending = new Map();  // userId -> login bosqichi

const mainKb = new Keyboard()
  .text('📤 Import').row()
  .text('🔑 Login').text('❌ Bekor')
  .resized()
  .persistent();

const FIELDS = [
  { label: 'Учебный год',    ask: "O'quv yili" },
  { label: 'Класс',          ask: 'Sinf' },
  { label: 'Предмет',        ask: 'Fan' },
  { label: 'Учебная группа', ask: "O'quv guruhi" },
  { label: 'Учебный период', ask: 'Davr' },
];

setInterval(() => {
  for (const [id, s] of live) {
    if (Date.now() - s.es.lastUsed > TIMEOUT) { s.es.close(); live.delete(id); }
  }
}, 60_000);

async function endSession(id) {
  const s = live.get(id);
  if (s) {
    await s.es.close();
    if (s.filePath) await fs.unlink(s.filePath).catch(() => {});
    live.delete(id);
  }
}

// Uzun ro'yxatni bo'lib yuborish, tugmalar oxirgi xabarda
async function sendChunks(ctx, lines, kb, plainLines) {
  const parts = [];
  let buf = '';
  for (const l of lines) {
    if ((buf + l + '\n').length > CHUNK) { parts.push(buf.trimEnd()); buf = ''; }
    buf += l + '\n';
  }
  if (buf.trim()) parts.push(buf.trimEnd());

  if (parts.length > 10) {
    await ctx.replyWithDocument(
      new InputFile(Buffer.from((plainLines || lines).join('\n'), 'utf8'), 'mavzular.txt'),
      { caption: "Ro'yxat juda uzun — fayl qilib yubordim.", reply_markup: kb }
    );
    return;
  }

  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    await ctx.reply(parts[i], {
      parse_mode: 'HTML',
      ...(last ? { reply_markup: kb } : {}),
    });
  }
}

// ---------- start / tugmalar ----------
bot.command('start', async ctx => {
  const name = await getName(ctx.from.id);
  await ctx.reply(
    name
      ? `Salom, ${name}! Yuklash uchun "📤 Import" tugmasini bosing.`
      : 'Salom! Avval "🔑 Login" tugmasi orqali eMaktab hisobingizni ulang.',
    { reply_markup: mainKb }
  );
});

bot.hears('📤 Import', ctx => startImport(ctx));
bot.hears('🔑 Login', ctx => startLogin(ctx));
bot.hears('❌ Bekor', async ctx => {
  pending.delete(ctx.from.id);
  await endSession(ctx.from.id);
  await ctx.reply('Bekor qilindi.', { reply_markup: mainKb });
});

// ---------- login ----------
async function startLogin(ctx) {
  pending.set(ctx.from.id, { stage: 'user' });
  await ctx.reply('eMaktab loginingizni yuboring:');
}
bot.command('login', startLogin);

bot.on('message:text', async (ctx, next) => {
  const id = ctx.from.id;
  const text = ctx.message.text;
  if (text.startsWith('/') || ['📤 Import', '🔑 Login', '❌ Bekor'].includes(text)) return next();

  // birlashtirish javobi
  const s = live.get(id);
  if (s?.step === 'merge') return handleMergeInput(ctx, id, text);

  const p = pending.get(id);
  if (!p) return next();

  if (p.stage === 'user') {
    p.username = text.trim();
    p.stage = 'pass';
    return ctx.reply("Endi parolni yuboring. (Xabar avtomat o'chiriladi)");
  }

  const password = text;
  await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
  pending.delete(id);

  const wait = await ctx.reply('Tekshirilyapti...');
  const es = new EmaktabSession();
  try {
    await es.launch();
    const { state, fullName } = await es.login(p.username, password);
    await setCreds(id, p.username, password, fullName);
    await saveState(id, state);
    await ctx.api.editMessageText(ctx.chat.id, wait.message_id,
      fullName
        ? `✅ Ulandi: ${fullName}\n\nEndi "📤 Import" tugmasini bosing.`
        : '✅ Ulandi. Endi "📤 Import" tugmasini bosing.');
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, wait.message_id,
      e.message.startsWith('BAD_CREDENTIALS')
        ? "❌ Login yoki parol noto'g'ri. Qayta urinib ko'ring."
        : `❌ Xatolik: ${e.message}`);
  } finally {
    await es.close();
  }
});

// ---------- import boshlanishi ----------
async function startImport(ctx) {
  const id = ctx.from.id;
  if (!(await getCreds(id)))
    return ctx.reply('Avval "🔑 Login" tugmasi orqali hisobingizni ulang.', { reply_markup: mainKb });

  await endSession(id);
  live.set(id, { es: new EmaktabSession(), step: 'await_file', fields: [], asked: [], answers: [] });
  await ctx.reply('Excel faylni yuboring (.xls yoki .xlsx).', { reply_markup: mainKb });
}
bot.command('import', startImport);

bot.on('message:document', async ctx => {
  const id = ctx.from.id;
  const s = live.get(id);
  if (!s || s.step !== 'await_file') return;

  const doc = ctx.message.document;
  if (!/\.xlsx?$/i.test(doc.file_name || ''))
    return ctx.reply('Faqat .xls yoki .xlsx fayl qabul qilinadi.');
  if (doc.file_size > 5_000_000) return ctx.reply('Fayl juda katta.');

  const wait = await ctx.reply('Fayl qabul qilindi. eMaktabga ulanyapman...');

  try {
    const f = await ctx.api.getFile(doc.file_id);
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${f.file_path}`;
    await fs.mkdir(TMP, { recursive: true });
    const local = path.join(TMP, `${id}_${Date.now()}${path.extname(doc.file_name)}`);
    await fs.writeFile(local, Buffer.from(await (await fetch(url)).arrayBuffer()));
    s.filePath = local;
    s.hints = parseFileName(doc.file_name);

    // Eski .xls formatini o'qiy olmaymiz — birlashtirish faqat .xlsx uchun
    s.canMerge = /\.xlsx$/i.test(doc.file_name);
    if (s.canMerge) {
      try {
        const parsed = await readRows(local);
        s.rows = parsed.rows;
        s.sheetName = parsed.sheetName;
      } catch { s.canMerge = false; }
    }

    const saved = await getState(id);
    let ok = saved ? await s.es.restore(saved) : false;
    if (!ok) {
      await s.es.close();
      s.es = new EmaktabSession();
      await s.es.launch();
      const { username, password } = await getCreds(id);
      const { state } = await s.es.login(username, password);
      await saveState(id, state);
    }

    await s.es.uploadFile(local);

    s.step = 'params';
    s.fields = [...FIELDS];
    s.asked = [];
    s.answers = [];
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await askNext(ctx, id);
  } catch (e) {
    await endSession(id);
    await ctx.reply(e.message.startsWith('BAD_CREDENTIALS')
      ? "❌ Login yoki parol noto'g'ri. Qayta /login qiling."
      : `❌ Xatolik: ${e.message}`);
  }
});

// ---------- parametrlar ----------
async function askNext(ctx, id) {
  const s = live.get(id);
  s.es.touch();

  const field = s.fields.shift();
  if (!field) return startMapping(ctx, id);

  const all = await s.es.options(field.label);
  if (!all.length) {
    const info = await s.es.debugSelect(field.label);
    await endSession(id);
    return ctx.reply(`❌ "${field.ask}" ro'yxati bo'sh chiqdi.\n\n${info}`);
  }

  // Fayl nomidagi ishoralar bo'yicha filtr
  const showAll = s.showAllFor === field.label;
  const hit = showAll ? [] : filterOptions(field.label, all, s.hints);
  const opts = hit.length ? hit : all;
  const filtered = opts.length < all.length;

  // Avtomat qo'yish: yagona variant bo'lsa, yoki yil/chorak fayldan aniq bo'lsa
  const auto = all.length === 1 || (filtered && opts.length === 1 && AUTO_FIELDS.has(field.label));
  if (auto) {
    await s.es.pick(field.label, opts[0].index);
    s.asked.push(field);
    s.answers.push({ label: field.label, ask: field.ask, optionLabel: opts[0].label });
    s.showAllFor = null;
    return askNext(ctx, id);
  }

  s.current = field;
  s.opts = opts;

  const kb = new InlineKeyboard();
  opts.slice(0, 60).forEach((o, i) => {
    kb.text(o.label, `p:${i}`);
    if (i % 3 === 2) kb.row();
  });
  kb.row();
  if (filtered) kb.text('🔍 Hammasi', 'all');
  if (s.asked.length) kb.text('⬅️ Orqaga', 'back');

  const done = s.answers.map(a => `<i>${esc(a.optionLabel)}</i>`).join(' · ');
  const note = filtered ? ` <i>(fayl bo'yicha)</i>` : '';
  await ctx.reply(
    (done ? `${done}\n\n` : '') + `<b>${esc(field.ask)}</b>ni tanlang:${note}`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
}

bot.callbackQuery('all', async ctx => {
  const id = ctx.from.id;
  const s = live.get(id);
  if (!s?.current) return ctx.answerCallbackQuery('Sessiya tugagan. /import');

  await ctx.answerCallbackQuery();
  await ctx.editMessageText("To'liq ro'yxat:");

  s.showAllFor = s.current.label;
  s.fields.unshift(s.current);
  s.current = null;
  await askNext(ctx, id);
});

bot.callbackQuery(/^p:(\d+)$/, async ctx => {
  const id = ctx.from.id;
  const s = live.get(id);
  if (!s?.current) return ctx.answerCallbackQuery('Sessiya tugagan. /import');

  const opt = s.opts[Number(ctx.match[1])];
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`${s.current.ask}: ${opt.label} ✅`);

  await s.es.pick(s.current.label, opt.index);
  s.asked.push(s.current);
  s.answers.push({ label: s.current.label, ask: s.current.ask, optionLabel: opt.label });
  s.showAllFor = null;
  s.current = null;

  await askNext(ctx, id);
});

bot.callbackQuery('back', async ctx => {
  const id = ctx.from.id;
  const s = live.get(id);
  if (!s?.current || !s.asked.length) return ctx.answerCallbackQuery('Orqaga qaytib bo\'lmaydi.');

  await ctx.answerCallbackQuery();
  await ctx.editMessageText('⬅️ Orqaga');

  s.fields.unshift(s.current);        // hozirgi savol navbatga qaytadi
  s.fields.unshift(s.asked.pop());    // oldingi savol qayta so'raladi
  s.answers.pop();
  s.showAllFor = null;
  s.current = null;

  await askNext(ctx, id);
});

// ---------- ustun mosligi ----------
async function startMapping(ctx, id) {
  const s = live.get(id);
  await ctx.reply('Ustunlar moslanyapti...');

  const res = await s.es.mapColumns();
  if (res.done === res.need) return submitAndPreview(ctx, id);

  const sels = await s.es.mappingSelects();
  if (!sels.length) {
    await endSession(id);
    return ctx.reply(`❌ Ustun moslash jadvali topilmadi.\n\n${res.report}`);
  }

  s.manual = sels;
  await ctx.reply("Ustunlarni qo'lda moslaymiz.");
  return askMapping(ctx, id);
}

async function askMapping(ctx, id) {
  const s = live.get(id);
  s.es.touch();

  const item = s.manual.shift();
  if (!item) return submitAndPreview(ctx, id);

  s.curMap = item;
  const kb = new InlineKeyboard();
  item.options.forEach((o, i) => kb.text(o.label, `m:${i}`).row());

  await ctx.reply(`Fayldagi "${item.label}" ustuni nimaga to'g'ri keladi?`, { reply_markup: kb });
}

bot.callbackQuery(/^m:(\d+)$/, async ctx => {
  const id = ctx.from.id;
  const s = live.get(id);
  if (!s?.curMap) return ctx.answerCallbackQuery('Sessiya tugagan. /import');

  const opt = s.curMap.options[Number(ctx.match[1])];
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`${s.curMap.label} → ${opt.label} ✅`);

  await s.es.setSelect(s.curMap.selectIndex, opt.index);
  s.curMap = null;
  await askMapping(ctx, id);
});

// ---------- tekshiruv ----------
async function submitAndPreview(ctx, id) {
  const s = live.get(id);
  await s.es.submitMapping();

  const { rows, ok, bad, diag, mapReport } = await s.es.preview();
  if (!rows.length) {
    await endSession(id);
    return ctx.reply(`❌ Tekshiruv jadvali topilmadi.\n\n${mapReport}\n\n${diag}`.slice(0, 3800));
  }

  // Himoya: eski emaktab.js "ok" bermasa, holat matnidan aniqlaymiz
  s.siteRows = rows.map(r => ({
    ...r,
    ok: typeof r.ok === 'boolean' ? r.ok : /Готов|Tayyor/i.test(r.status || ''),
  }));
  s.bad = s.siteRows.filter(r => !r.ok);
  s.ok = s.siteRows.length - s.bad.length;
  s.step = 'confirm';

  await renderPreview(ctx, id, false);
}

// HTML formatida, raqamlar tekislangan
function previewLines(s) {
  const width = String(s.siteRows.length).length;
  return s.siteRows.map(r => {
    const num = String(r.lesson || r.n).padStart(width, ' ');
    const topic = esc(r.topic);
    const hw = r.hw ? ` — <i>${esc(r.hw)}</i>` : '';
    return r.ok
      ? `${num}. ${topic}${hw}`
      : `⚠️ <b>${num}. ${topic}</b>${hw}`;
  });
}

// Fayl uchun — belgilarsiz
function plainLines(s) {
  return s.siteRows.map(r => `${r.lesson || r.n}. ${r.topic}${r.hw ? ` — ${r.hw}` : ''}`);
}

function previewHeader(s) {
  const get = ask => s.answers.find(a => a.ask === ask)?.optionLabel || '';
  const subject = esc(get('Fan'));
  const rest = [get('Sinf'), get('Davr'), get("O'quv guruhi")]
    .filter(v => v && v !== 'Весь класс').map(esc).join(' · ');

  const total = s.siteRows.length;
  const bad = s.bad?.length || 0;

  const title = `📗 <b>${subject}</b>${rest ? ` · ${rest}` : ''}`;
  const stats = bad
    ? `${total} mavzu · ✅ ${s.ok} tayyor · ⚠️ ${bad} xato`
    : `${total} mavzu · ✅ hammasi tayyor`;

  if (!bad) return `${title}\n${stats}`;

  const nums = s.bad.slice(0, 10).map(r => r.lesson || r.n).join(', ');
  const more = bad > 10 ? '…' : '';
  return `${title}\n${stats}\n\n<b>Xato qatorlar:</b> ${nums}${more}\n` +
         `<i>Import qilsangiz ular kirmaydi.</i>`;
}

function previewKb(s, { truncated }) {
  const kb = new InlineKeyboard().text('✅ Import', 'go');
  if (s.canMerge) kb.text('🔗 Birlashtirish', 'merge');
  kb.row();
  if (truncated) kb.text("📋 To'liq ro'yxat", 'full');
  kb.text('❌ Bekor', 'no');
  return kb;
}

async function renderPreview(ctx, id, full) {
  const s = live.get(id);
  const lines = previewLines(s);
  const header = previewHeader(s);

  if (full) {
    await ctx.reply(header, { parse_mode: 'HTML' });
    await sendChunks(ctx, lines, previewKb(s, { truncated: false }), plainLines(s));
    return;
  }

  const body = lines.join('\n');
  const whole = `${header}\n\n${body}\n\nYuklaymi?`;

  if (whole.length <= CHUNK) {
    return ctx.reply(whole, {
      parse_mode: 'HTML',
      reply_markup: previewKb(s, { truncated: false }),
    });
  }

  // Juda uzun: bosh qism + xato qatorlar
  const bad = lines.filter(l => l.startsWith('⚠️')).slice(0, 5);
  const short = [...lines.slice(0, 3), '…', ...(bad.length ? bad : [lines.at(-1)])].join('\n');
  await ctx.reply(`${header}\n\n${short}\n\nYuklaymi?`, {
    parse_mode: 'HTML',
    reply_markup: previewKb(s, { truncated: true }),
  });
}

bot.callbackQuery('full', async ctx => {
  const id = ctx.from.id;
  if (!live.get(id)?.siteRows) return ctx.answerCallbackQuery('Sessiya tugagan. /import');
  await ctx.answerCallbackQuery();
  await renderPreview(ctx, id, true);
});

// ---------- birlashtirish ----------
bot.callbackQuery('merge', async ctx => {
  const id = ctx.from.id;
  const s = live.get(id);
  if (!s?.rows) return ctx.answerCallbackQuery('Sessiya tugagan. /import');

  await ctx.answerCallbackQuery();
  s.step = 'merge';
  await ctx.reply(
    `🔗 <b>Mavzularni birlashtirish</b>\n\n` +
    `Yonma-yon turgan juftliklarni yozing:\n<code>3-4, 8-9</code>\n\n` +
    `<i>Bekor qilish uchun "❌ Bekor".</i>`,
    { parse_mode: 'HTML' }
  );
});

async function handleMergeInput(ctx, id, text) {
  const s = live.get(id);
  const { pairs, error } = parsePairs(text, s.rows.length);
  if (error) return ctx.reply(`❌ ${error}\n\nQayta yozing.`);

  const merged = applyMerges(s.rows, pairs);
  const wait = await ctx.reply(
    `Birlashtirildi: ${s.rows.length} → ${merged.length} ta dars.\nQayta yuklanyapti...`
  );

  try {
    const newPath = path.join(TMP, `${id}_${Date.now()}_merged.xlsx`);
    await writeRows(merged, newPath, s.sheetName);

    await fs.unlink(s.filePath).catch(() => {});
    s.filePath = newPath;
    s.prevRows = s.rows;
    s.rows = merged;

    await s.es.uploadFile(newPath);
    await s.es.applyParams(s.answers);

    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    s.step = 'params';
    await startMapping(ctx, id);
  } catch (e) {
    s.step = 'confirm';
    await ctx.reply(`❌ Qayta yuklashda xatolik: ${e.message}`);
  }
}

// ---------- yakun ----------
bot.callbackQuery('no', async ctx => {
  await ctx.answerCallbackQuery();
  await endSession(ctx.from.id);
  await ctx.editMessageText('Bekor qilindi.');
});

bot.callbackQuery('go', async ctx => {
  const id = ctx.from.id;
  const s = live.get(id);
  if (!s) return ctx.answerCallbackQuery('Sessiya tugagan. /import');

  await ctx.answerCallbackQuery();
  await ctx.editMessageText('Yuklanyapti...');

  try {
    const shot = await s.es.confirmImport();
    const skipped = s.bad?.length
      ? `\n\n⚠️ Kirmadi (${s.bad.length} ta):\n` +
        s.bad.map(r => `${r.lesson || r.n}. ${esc(r.topic)}`).join('\n')
      : '';
    await ctx.replyWithPhoto(new InputFile(shot, 'result.png'), {
      caption: `✅ <b>${s.ok} ta dars kiritildi.</b>${skipped}`.slice(0, 1000),
      parse_mode: 'HTML',
      reply_markup: mainKb,
    });
  } catch (e) {
    await ctx.reply(`❌ Import paytida xatolik: ${e.message}`);
  } finally {
    await endSession(id);
  }
});

bot.catch(err => console.error('bot error', err));

await ensureSchema();
console.log('DB tayyor. Bot ishga tushyapti...');
bot.start();
