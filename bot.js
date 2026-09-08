import 'dotenv/config';

// --- muhit o'zgaruvchilarini tekshirish ---
const missing = ['BOT_TOKEN', 'DATABASE_URL', 'ENC_KEY'].filter(k => !process.env[k]);
if (missing.length) {
  console.error(`XATO: quyidagi o'zgaruvchilar yo'q: ${missing.join(', ')}`);
  console.error('Railway -> servis -> Variables bo\'limiga qo\'shing.');
  process.exit(1);
}
if (!/^[0-9a-fA-F]{64}$/.test(process.env.ENC_KEY)) {
  console.error("XATO: ENC_KEY 64 ta hex belgi bo'lishi kerak (32 bayt).");
  console.error('Yaratish: openssl rand -hex 32');
  process.exit(1);
}

// --- DATABASE_URL tekshiruvi ---
try {
  const u = new URL(process.env.DATABASE_URL);
  console.log(`DB: host=${u.hostname} port=${u.port} user=${u.username} db=${u.pathname.slice(1)} parol=${u.password ? 'bor' : 'YO\'Q'}`);
  if (!u.password) {
    console.error("XATO: DATABASE_URL ichida parol yo'q.");
    console.error('Railway -> Variables -> DATABASE_URL = ${{Postgres.DATABASE_URL}}');
    process.exit(1);
  }
} catch {
  console.error('XATO: DATABASE_URL noto\'g\'ri formatda:', process.env.DATABASE_URL?.slice(0, 30));
  process.exit(1);
}

import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { EmaktabSession } from './emaktab.js';
import { getCreds, setCreds, saveState, getState, ensureSchema } from './db.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const bot = new Bot(process.env.BOT_TOKEN);
const TMP = '/tmp/emaktab';
const TIMEOUT = 10 * 60 * 1000;

// userId -> { es, step, fields, picked }
const live = new Map();

const FIELDS = [
  { label: 'Учебный год', ask: "O'quv yili" },
  { label: 'Класс',       ask: 'Sinf' },
  { label: 'Предмет',     ask: 'Fan' },
  { label: 'Учебная группа', ask: "O'quv guruhi" },
  { label: 'Учебный период',  ask: 'Davr' },
];

// eskirgan sessiyalarni yopish
setInterval(() => {
  for (const [id, s] of live) {
    if (Date.now() - s.es.lastUsed > TIMEOUT) { s.es.close(); live.delete(id); }
  }
}, 60_000);

async function endSession(id) {
  const s = live.get(id);
  if (s) { await s.es.close(); live.delete(id); }
}

bot.command('start', ctx =>
  ctx.reply('Salom! Dars mavzularini eMaktabga yuklash uchun /import buyrug\'ini bosing.')
);

// ---------- /login ----------
const pending = new Map(); // userId -> { stage, username }

bot.command('login', async ctx => {
  pending.set(ctx.from.id, { stage: 'user' });
  await ctx.reply('eMaktab loginingizni yuboring:');
});

bot.on('message:text', async (ctx, next) => {
  const id = ctx.from.id;
  const p = pending.get(id);
  if (!p || ctx.message.text.startsWith('/')) return next();

  if (p.stage === 'user') {
    p.username = ctx.message.text.trim();
    p.stage = 'pass';
    return ctx.reply('Endi parolni yuboring. (Xabar avtomat o\'chiriladi)');
  }

  const password = ctx.message.text;
  // parol chatda qolmasin
  await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
  pending.delete(id);

  const wait = await ctx.reply('Tekshirilyapti...');
  const es = new EmaktabSession();
  try {
    await es.launch();
    const state = await es.login(p.username, password);
    await setCreds(id, p.username, password);
    await saveState(id, state);
    await ctx.api.editMessageText(ctx.chat.id, wait.message_id,
      '✅ Ulandi. Endi /import buyrug\'ini bosing.');
  } catch (e) {
    const msg = e.message === 'BAD_CREDENTIALS'
      ? '❌ Login yoki parol noto\'g\'ri. /login orqali qayta urinib ko\'ring.'
      : `❌ Xatolik: ${e.message}`;
    await ctx.api.editMessageText(ctx.chat.id, wait.message_id, msg);
  } finally {
    await es.close();
  }
});

bot.command('import', async ctx => {
  const id = ctx.from.id;
  if (!(await getCreds(id)))
    return ctx.reply('Avval /login orqali eMaktab hisobingizni ulang.');

  await endSession(id);
  live.set(id, { es: new EmaktabSession(), step: 'await_file', fields: [], picked: {} });
  await ctx.reply('Excel faylni yuboring (.xls yoki .xlsx).');
});

bot.command('cancel', async ctx => {
  await endSession(ctx.from.id);
  await ctx.reply('Bekor qilindi.');
});

// ---------- fayl ----------
bot.on('message:document', async ctx => {
  const id = ctx.from.id;
  const s = live.get(id);
  if (!s || s.step !== 'await_file') return;

  const doc = ctx.message.document;
  if (!/\.xlsx?$/i.test(doc.file_name || ''))
    return ctx.reply('Faqat .xls yoki .xlsx fayl qabul qilinadi.');
  if (doc.file_size > 5_000_000)
    return ctx.reply('Fayl juda katta.');

  const wait = await ctx.reply('Fayl qabul qilindi. eMaktabga ulanyapman...');

  try {
    const f = await ctx.api.getFile(doc.file_id);
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${f.file_path}`;
    await fs.mkdir(TMP, { recursive: true });
    const local = path.join(TMP, `${id}_${Date.now()}${path.extname(doc.file_name)}`);
    await fs.writeFile(local, Buffer.from(await (await fetch(url)).arrayBuffer()));

    // sessiya: avval cookie, bo'lmasa login
    const saved = await getState(id);
    let ok = saved ? await s.es.restore(saved) : false;
    if (!ok) {
      await s.es.close();
      s.es = new EmaktabSession();
      await s.es.launch();
      const { username, password } = await getCreds(id);
      await saveState(id, await s.es.login(username, password));
    }

    await s.es.uploadFile(local);
    await fs.unlink(local).catch(() => {});

    s.step = 'fields';
    s.fields = [...FIELDS];
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id);
    await askNext(ctx, id);
  } catch (e) {
    await endSession(id);
    const msg = e.message === 'BAD_CREDENTIALS'
      ? "Login yoki parol noto'g'ri. /login orqali qayta kiriting."
      : `Xatolik: ${e.message}`;
    await ctx.reply(msg);
  }
});

// ---------- selectlar ----------
async function askNext(ctx, id) {
  const s = live.get(id);
  s.es.touch();

  const field = s.fields.shift();
  if (!field) return showPreview(ctx, id);

  const opts = await s.es.options(field.label);

  // variant bitta bo'lsa — so'ramaymiz
  if (opts.length === 1) {
    await s.es.pick(field.label, opts[0].value);
    s.picked[field.ask] = opts[0].label;
    return askNext(ctx, id);
  }

  s.current = field;
  s.opts = opts;

  const kb = new InlineKeyboard();
  opts.slice(0, 60).forEach((o, i) => {
    kb.text(o.label, `p:${i}`);
    if (i % 3 === 2) kb.row();
  });

  await ctx.reply(`${field.ask}ni tanlang:`, { reply_markup: kb });
}

bot.callbackQuery(/^p:(\d+)$/, async ctx => {
  const id = ctx.from.id;
  const s = live.get(id);
  if (!s?.current) return ctx.answerCallbackQuery('Sessiya tugagan. /import');

  const opt = s.opts[Number(ctx.match[1])];
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`${s.current.ask}: ${opt.label} ✅`);

  await s.es.pick(s.current.label, opt.value);
  s.picked[s.current.ask] = opt.label;
  s.current = null;

  await askNext(ctx, id);
});

// ---------- tekshiruv ----------
async function showPreview(ctx, id) {
  const s = live.get(id);
  await ctx.reply('Ustunlar moslanyapti...');

  await s.es.mapColumns();
  const { rows, ok, bad } = await s.es.preview();

  if (!rows.length) {
    await endSession(id);
    return ctx.reply("Jadval bo'sh chiqdi. Faylni tekshirib qayta urinib ko'ring.");
  }

  const list = rows.slice(0, 10)
    .map(r => `${r.lesson}. ${r.topic}${r.hw ? ` — ${r.hw}` : ''}`).join('\n');

  const head = Object.entries(s.picked).map(([k, v]) => `${k}: ${v}`).join('\n');
  const warn = bad.length ? `\n\n⚠️ ${bad.length} ta qator tayyor emas.` : '';
  const more = rows.length > 10 ? `\n... yana ${rows.length - 10} ta` : '';

  s.step = 'confirm';
  await ctx.reply(
    `${head}\n\nTopildi: ${rows.length} ta dars (${ok} tasi tayyor)${warn}\n\n${list}${more}\n\nYuklaymi?`,
    { reply_markup: new InlineKeyboard().text('✅ Import', 'go').text('❌ Bekor', 'no') }
  );
}

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
    await ctx.replyWithPhoto(new InputFile(shot, 'result.png'), {
      caption: '✅ Import tugadi. Jurnalni tekshirib ko\'ring.',
    });
  } catch (e) {
    await ctx.reply(`Import paytida xatolik: ${e.message}`);
  } finally {
    await endSession(id);
  }
});

bot.catch(err => console.error('bot error', err));

await ensureSchema();
console.log('DB tayyor. Bot ishga tushyapti...');
bot.start();
