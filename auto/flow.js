// Avtomatik import (sinov bosqichi): yashirin /auto, ko'rib chiqish, fonda import.
// Pul kodiga (chargeImport, checkQuota) tegmaydi — bepul sinov.

import path from 'node:path';
import { InlineKeyboard } from 'grammy';
import { canAuto, needsGradingAnswer, buildItems } from './match.js';
import { cookiesFromState } from '../emaktab-http.js';
import { quarterOfDate, schoolYearOfDate } from '../dashboard/inbox.js';
import { parsePairs, applyMerges } from '../xlsx.js';

const TTL = 2 * 3600 * 1000;
const WAIT_TTL = 10 * 60 * 1000;   // matn javobi (guruh qatori, juftliklar) kutish muddati
const CHUNK = 3500;
const esc = x => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rowName = it => `${it.className} · ${it.subjectName} · ${it.subgroupName || 'Весь класс'}`;

export function createAutoFlow(deps) {
  const { db, t, L, adminId, config, runner, createHttp, login, askTwoFactor, fetchPlanFile,
    keyOf, allowed, notifyAdmin, readRows, writeRows, readFile, writeFile, tmpDir, now = () => new Date(),
    log = console.log } = deps;
  const states = new Map();   // tgId -> holat

  const get = id => {
    const st = states.get(id);
    if (!st || now() - st.at > TTL) { states.delete(id); return null; }
    return st;
  };

  // eMaktab'ga ulanish: saqlangan cookie'lar, bo'lmasa yoki eskirgan bo'lsa Playwright login
  async function connect(ctx, id, lang, creds) {
    const tryList = async cookies => {
      const http = createHttp({ cookies });
      return { http, list: await http.listClassSubjects(), cookies };
    };
    const saved = cookiesFromState(await db.getState(id));
    if (saved.length) {
      try { return await tryList(saved); }
      catch (e) { if (e.code !== 'SESSION_EXPIRED') throw e; }
    }
    let state;
    try { state = await login(creds); }
    catch (e) {
      if (e.message === 'TWO_FA') { await askTwoFactor(ctx, id, lang, e.es, e.link, { kind: 'session' }); return null; }
      throw e;
    }
    await db.saveState(id, state);
    return tryList(cookiesFromState(state));
  }

  async function rebuild(st) {
    st.items = await buildItems({
      classes: st.classes, quarter: st.quarter, year: st.year,
      accountGrading: st.prefs.grading, accountMedium: st.prefs.medium, mediumOverride: st.mediumOverride,
      keyOf, allowed: allowed(), findPlan: k => db.findActivePlan(k), maxItems: config.maxItems,
    });
  }

  function previewKb(st, lang) {
    const kb = new InlineKeyboard()
      .text(t(lang, 'auto_btn_ok'), 'au:ok').text(t(lang, 'auto_btn_q'), 'au:q').row()
      .text(t(lang, 'auto_btn_g'), 'au:g').text(t(lang, 'auto_btn_sel'), 'au:sel').row();
    if (st.prefs.medium === 'both') {
      st.classes.forEach((c, gi) => {
        const m = st.mediumOverride[c.groupId] || 'uz';
        kb.text(`${m === 'ru' ? '🇷🇺' : '🇺🇿'} ${c.className}`, `au:md:${gi}`);
        if (gi % 3 === 2) kb.row();
      });
      kb.row();
    }
    return kb.text(t(lang, 'auto_btn_x'), 'au:x');
  }

  function previewText(st, lang) {
    const lines = [t(lang, 'auto_title', { q: st.quarter, year: st.year }), ''];
    for (const it of st.items) {
      const mark = it.plan ? t(lang, 'auto_has_plan', { n: it.plan.topics ?? '?' }) : t(lang, `auto_r_${it.reason}`);
      lines.push(`${it.selected ? '☑️' : '▫️'} ${it.i + 1}. ${esc(rowName(it))} — ${mark}`);
    }
    const n = st.items.filter(i => i.selected).length;
    lines.push('', t(lang, 'auto_summary', { n }));
    if (config.maxItems < st.items.filter(i => i.plan).length) lines.push(t(lang, 'auto_limit', { n: config.maxItems }));
    return lines.join('\n');
  }

  async function showPreview(ctx, st, lang) {
    const text = previewText(st, lang);
    const kb = previewKb(st, lang);
    if (text.length <= 3800) return ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    // Uzun ro'yxat: bo'laklab, tugmalar oxirgisida
    const parts = [];
    let buf = '';
    for (const l of text.split('\n')) {
      if ((buf + l + '\n').length > 3500) { parts.push(buf); buf = ''; }
      buf += `${l}\n`;
    }
    parts.push(buf);
    for (let k = 0; k < parts.length; k++)
      await ctx.reply(parts[k].trimEnd(), { parse_mode: 'HTML', ...(k === parts.length - 1 ? { reply_markup: kb } : {}) });
  }

  // Savollar (til, BSB) javob berilmagan bo'lsa — so'raymiz, aks holda ko'rib chiqish
  async function proceed(ctx, id, lang) {
    const st = get(id);
    if (!st) return ctx.reply(t(lang, 'session_end'));
    st.prefs = await db.getAutoPrefs(id);
    if (!st.prefs.medium) {
      return ctx.reply(t(lang, 'auto_ask_lang'), { reply_markup: new InlineKeyboard()
        .text(t(lang, 'auto_lang_uz'), 'au:lang:uz').text(t(lang, 'auto_lang_ru'), 'au:lang:ru')
        .text(t(lang, 'auto_lang_both'), 'au:lang:both') });
    }
    if (needsGradingAnswer(st.classes, st.prefs.grading)) {
      return ctx.reply(t(lang, 'auto_ask_bsb'), { reply_markup: new InlineKeyboard()
        .text(t(lang, 'auto_yes'), 'au:bsb:1').text(t(lang, 'auto_no'), 'au:bsb:0') });
    }
    await rebuild(st);
    return showPreview(ctx, st, lang);
  }

  // ---- fon ishi ----
  async function relogin(id, st) {
    const creds = await db.getCreds(id);
    let state;
    try { state = await login(creds); }
    catch (e) {
      if (e.message === 'TWO_FA') { await e.es?.close?.().catch(() => {}); throw Object.assign(new Error('relogin'), { code: 'RELOGIN' }); }
      throw e;
    }
    await db.saveState(id, state);
    st.http = createHttp({ cookies: cookiesFromState(state) });
  }

  async function periodFor(st, groupId, quarter) {
    st.periods ??= new Map();
    if (!st.periods.has(groupId)) st.periods.set(groupId, await st.http.periods(groupId));
    return st.periods.get(groupId).find(p => p.n === quarter)?.id || null;
  }

  // Uzun matnni Telegram chegarasidan oshirmay bo'laklab yuboradi; tugmalar oxirgisida
  async function sendLong(ctx, lines, extra = {}) {
    const parts = [];
    let buf = '';
    for (const l of lines) {
      if (buf && (buf + l + '\n').length > CHUNK) { parts.push(buf); buf = ''; }
      buf += `${l.slice(0, CHUNK)}\n`;
    }
    if (buf.trim()) parts.push(buf);
    for (let k = 0; k < parts.length; k++)
      await ctx.reply(parts[k].trimEnd(), { parse_mode: 'HTML', ...(k === parts.length - 1 ? extra : {}) });
  }

  function makeWork(id, st, { okOnly = false, file = null } = {}) {
    let reloginFailed = false;   // bitta ishda qayta kirish faqat bir marta
    return async item => {
      let buf = file;
      if (!buf) {
        try { buf = await fetchPlanFile(item.plan.file_id); }
        catch (e) { log('[auto] file', e?.code || e?.message); return { item, state: 'failed', why: 'file' }; }
      }
      const run = async () => {
        // chorak, yil, maktab tasdiqlash paytida elementga muzlatilgan
        const periodId = await periodFor(st, item.groupId, item.quarter);
        if (!periodId) return { state: 'failed', why: 'period' };
        return st.http.importOne({
          file: buf, fileName: item.plan.file_name || 'reja.xlsx', year: item.year.slice(0, 4), school: item.school,
          groupId: item.groupId, subjectId: item.subjectId, subgroupId: item.subgroupId, periodId, okOnly,
        });
      };
      try {
        let r;
        try { r = await run(); }
        catch (e) {
          if (e.code !== 'SESSION_EXPIRED') throw e;
          if (reloginFailed) throw Object.assign(new Error('relogin'), { code: 'RELOGIN' });
          st.periods = null;
          try { await relogin(id, st); }
          catch (e2) { if (e2.code === 'RELOGIN') reloginFailed = true; throw e2; }
          r = await run();
        }
        return { item, buf, ...r };
      } catch (e) {
        log('[auto] import', item.className, item.subjectName, e?.code || '', e?.message || e);
        const why = e.code === 'RELOGIN' ? 'relogin' : e.code === 'MAINTENANCE' ? 'maint' : null;
        return { item, state: 'failed', why, error: why ? null : String(e?.message || e).slice(0, 200) };
      }
    };
  }

  function makeDone(ctx, id, lang) {
    return async results => {
      const st = get(id);
      const lines = [t(lang, 'auto_title_done'), ''];
      const choices = [];
      for (const r of results) {
        const row = esc(rowName(r.item));
        if (r.state === 'done') lines.push(t(lang, r.result?.ok === null ? 'auto_res_check' : 'auto_res_done', { row, n: r.imported }));
        else if (r.state === 'needs_choice') {
          if (st) st.choices.set(r.item.i, { item: r.item, rows: r.rows, buf: r.buf });
          choices.push(r);
        } else lines.push(t(lang, 'auto_res_fail', { row, why: r.why ? t(lang, `auto_why_${r.why}`) : esc(r.error || '?') }));
      }
      if (lines.length > 2) await sendLong(ctx, lines);
      for (const r of choices) {
        const bad = r.rows.filter(x => !x.ok).length;
        await ctx.reply(t(lang, 'auto_res_choice', { row: esc(rowName(r.item)), bad }), {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard()
            .text(t(lang, 'auto_btn_merge'), `au:m:${r.item.i}`)
            .text(t(lang, 'auto_btn_okonly'), `au:k:${r.item.i}`)
            .text(t(lang, 'auto_btn_skip'), `au:s:${r.item.i}`),
        });
      }
      const count = s => results.filter(r => r.state === s).length;
      const report = `🤖 auto · ${id}: ✅ ${count('done')} · ⚠️ ${count('needs_choice')} · ❌ ${count('failed')}` +
        results.filter(r => r.state === 'failed').map(r => `\n❌ ${esc(rowName(r.item))}: ${esc(r.why || r.error || '')}`).join('') +
        // eMaktab javobi noaniq: sahifa manzili va kalit so'zli parchalar (natija sahifasini o'rganish uchun)
        results.filter(r => r.state === 'done' && r.result?.ok === null).map(r =>
          `\n❔ ${esc(rowName(r.item))}: ${esc(r.result.url || '')} · step1=${r.result.backAtStep1 ? 'ha' : "yo'q"} · ${esc((r.result.snippets || []).join(' | ') || r.result.text || '')}`).join('');
      await notifyAdmin(report.length > 3500 ? `${report.slice(0, 3500)}\n…` : report);
    };
  }

  function startJobs(ctx, id, lang, st, items, opts) {
    return runner.start(id, { items, work: makeWork(id, st, opts), onDone: makeDone(ctx, id, lang) });
  }

  async function mergeAndImport(ctx, id, lang, st, ch, text) {
    const file = path.join(tmpDir, `${id}_${Date.now()}_auto.xlsx`);
    await writeFile(file, ch.buf);
    const rows = await readRows(file);
    const { pairs, error } = parsePairs(text, rows.length);
    if (error) return ctx.reply(t(lang, 'merge_err', { err: error }));
    st.wait = null;
    const out = `${file}.merged.xlsx`;
    await writeRows(applyMerges(rows, pairs), out);
    const buf = await readFile(out);
    st.choices.delete(ch.item.i);
    if (!startJobs(ctx, id, lang, st, [ch.item], { file: buf })) return ctx.reply(t(lang, 'auto_busy'));
    return ctx.reply(t(lang, 'auto_started', { n: 1 }));
  }

  const waiting = st => !!st?.wait && now() - st.waitAt < WAIT_TTL;
  const setWait = (st, w) => { st.wait = w; st.waitAt = now(); };

  return {
    // bot.js uchun sinxron yo'naltirish (uzoq ish handlerni ushlab turmasin)
    allowed: id => canAuto(id, { adminId, testers: config.testers }),
    wants: id => waiting(get(id)),
    clearWait: id => { const st = states.get(id); if (st) st.wait = null; },

    async command(ctx) {
      const id = ctx.from.id;
      if (!canAuto(id, { adminId, testers: config.testers })) return false;
      const lang = await L(id);
      if (runner.busy(id)) { await ctx.reply(t(lang, 'auto_busy')); return true; }
      const creds = await db.getCreds(id);
      if (!creds) { await ctx.reply(t(lang, 'need_login')); return true; }
      await ctx.reply(t(lang, 'auto_reading'));
      try {
        const c = await connect(ctx, id, lang, creds);
        if (!c) return true;
        if (!c.list.classes.length) { await ctx.reply(t(lang, 'auto_no_classes')); return true; }
        const d = now();
        states.set(id, {
          at: now(), http: c.http, school: c.list.school, classes: c.list.classes,
          quarter: quarterOfDate(d), year: schoolYearOfDate(d), mediumOverride: {}, items: [],
          choices: new Map(), wait: null, prefs: {},
        });
        await proceed(ctx, id, lang);
      } catch (e) {
        log('[auto] start', e?.code || '', e?.message || e);
        await ctx.reply(e.code === 'MAINTENANCE' || e.message === 'MAINTENANCE'
          ? t(lang, 'maintenance') : t(lang, 'error', { msg: esc(e.message) }));
      }
      return true;
    },

    async callback(ctx) {
      const id = ctx.from.id;
      const data = ctx.callbackQuery.data;
      const lang = await L(id);
      await ctx.answerCallbackQuery().catch(() => {});
      if (!canAuto(id, { adminId, testers: config.testers })) return;
      const st = get(id);
      if (!st) return ctx.reply(t(lang, 'session_end'));
      st.at = now();
      const [, cmd, a, b] = data.split(':');
      // ish ketayotganda chorak/til/BSB o'zgarmaydi
      if (['q', 'md', 'lang', 'bsb'].includes(cmd) && runner.busy(id)) return ctx.reply(t(lang, 'auto_busy'));

      if (cmd === 'lang' && ['uz', 'ru', 'both'].includes(a)) { await db.setAutoMedium(id, a); return proceed(ctx, id, lang); }
      if (cmd === 'bsb') { await db.setAutoGrading(id, a === '1' ? 'bsb' : 'normal'); return proceed(ctx, id, lang); }
      if (cmd === 'q' && !a) {
        const kb = new InlineKeyboard();
        [1, 2, 3, 4].forEach(n => kb.text(`${n}`, `au:q:${n}`));
        return ctx.reply(t(lang, 'auto_pick_q'), { reply_markup: kb });
      }
      if (cmd === 'q') { st.quarter = Number(a); st.periods = null; await rebuild(st); return showPreview(ctx, st, lang); }
      if (cmd === 'md') {
        const c = st.classes[Number(a)];
        if (c) st.mediumOverride[c.groupId] = (st.mediumOverride[c.groupId] || 'uz') === 'uz' ? 'ru' : 'uz';
        await rebuild(st);
        return showPreview(ctx, st, lang);
      }
      if (cmd === 'sel' || cmd === 't') {
        if (cmd === 't') { const it = st.items[Number(a)]; if (it?.plan) it.selected = !it.selected; }
        const kb = new InlineKeyboard();
        for (const it of st.items.filter(x => x.plan))
          kb.text(`${it.selected ? '✅' : '⬜'} ${it.i + 1}. ${rowName(it)}`.slice(0, 60), `au:t:${it.i}`).row();
        kb.text(t(lang, 'auto_btn_done'), 'au:seld');
        return cmd === 't' ? ctx.editMessageReplyMarkup({ reply_markup: kb }).catch(() => {})
          : ctx.reply(t(lang, 'auto_pick_sel'), { reply_markup: kb });
      }
      if (cmd === 'seld') return showPreview(ctx, st, lang);
      if (cmd === 'g' && !a) { setWait(st, 'group'); return ctx.reply(t(lang, 'auto_pick_row')); }
      if (cmd === 'gs') {
        const it = st.items[Number(a)];
        const sg = st.sg?.[Number(a)]?.[Number(b)];
        if (it && sg) { it.subgroupId = sg.id; it.subgroupName = sg.name; }
        return showPreview(ctx, st, lang);
      }
      if (cmd === 'x') { states.delete(id); return ctx.reply(t(lang, 'cancelled')); }
      if (cmd === 'ok') {
        const picked = st.items.filter(i => i.selected && i.plan).slice(0, config.maxItems)
          .map(i => ({ ...i, quarter: st.quarter, year: st.year, school: st.school }));
        if (!picked.length) return ctx.reply(t(lang, 'auto_none'));
        if (!startJobs(ctx, id, lang, st, picked)) return ctx.reply(t(lang, 'auto_busy'));
        return ctx.reply(t(lang, 'auto_started', { n: picked.length }));
      }
      if (['m', 'k', 's'].includes(cmd)) {
        const ch = st.choices.get(Number(a));
        if (!ch) return ctx.reply(t(lang, 'session_end'));
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});
        if (cmd === 's') { st.choices.delete(ch.item.i); return ctx.reply(t(lang, 'auto_skipped', { row: esc(rowName(ch.item)) }), { parse_mode: 'HTML' }); }
        if (cmd === 'm') { setWait(st, 'merge'); st.mergeIdx = ch.item.i; return ctx.reply(t(lang, 'merge_prompt'), { parse_mode: 'HTML' }); }
        st.choices.delete(ch.item.i);
        if (!startJobs(ctx, id, lang, st, [ch.item], { okOnly: true, file: ch.buf })) return ctx.reply(t(lang, 'auto_busy'));
        return ctx.reply(t(lang, 'auto_started', { n: 1 }));
      }
    },

    // Matn javoblari (guruh qatori, birlashtirish juftliklari). true — matn shu yerda ishlandi.
    async text(ctx) {
      const id = ctx.from.id;
      const st = get(id);
      if (!waiting(st)) return false;
      const lang = await L(id);
      const text = ctx.message.text.trim();
      if (st.wait === 'group') {
        const it = st.items[Number(text) - 1];
        if (!it) { await ctx.reply(t(lang, 'auto_bad_row')); return true; }
        st.wait = null;
        const list = await st.http.subgroups(it.groupId);
        st.sg = { ...(st.sg || {}), [it.i]: list };
        const kb = new InlineKeyboard();
        list.forEach((g, k) => kb.text(g.name, `au:gs:${it.i}:${k}`).row());
        await ctx.reply(t(lang, 'auto_pick_sg', { row: esc(rowName(it)) }), { parse_mode: 'HTML', reply_markup: kb });
        return true;
      }
      if (st.wait === 'merge') {
        const ch = st.choices.get(st.mergeIdx);
        if (!ch) { st.wait = null; await ctx.reply(t(lang, 'session_end')); return true; }
        await mergeAndImport(ctx, id, lang, st, ch, text);
        return true;
      }
      return false;
    },
  };
}
