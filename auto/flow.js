// Avtomatik import (sinov bosqichi): yashirin /auto.
// Oqim: tekshiruv (import yo'q) → ro'yxat → xatolilarni bittadan hal qilish → xulosa → bitta import.
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
    log = console.log, editDelayMs = 2000 } = deps;
  const states = new Map();   // tgId -> holat

  const get = id => {
    const st = states.get(id);
    if (!st || now() - st.at > TTL) { states.delete(id); return null; }
    return st;
  };

  // eMaktab'ga ulanish: saqlangan cookie'lar, bo'lmasa Playwright login
  async function connect(ctx, id, lang, creds) {
    const tryList = async cookies => {
      const http = createHttp({ cookies });
      return { http, list: await http.listClassSubjects(), cookies };
    };
    const saved = cookiesFromState(await db.getStateAny(id));
    if (saved.length) {
      try { return await tryList(saved); }
      catch (e) {
        if (e.code !== 'SESSION_EXPIRED') throw e;
        log('[auto] saved session rejected', id, e.message);
      }
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

  const whyText = (lang, r) => (r.why ? t(lang, `auto_why_${r.why}`) : esc(r.error || '?'));

  // ---- elementlarni qurish va tekshiruv ----
  async function rebuild(st) {
    st.items = await buildItems({
      classes: st.classes, quarter: st.quarter, year: st.year,
      accountGrading: st.prefs.grading, accountMedium: st.prefs.medium, mediumOverride: st.mediumOverride,
      keyOf, allowed: allowed(), findPlan: k => db.findActivePlan(k), maxItems: config.maxItems,
    });
    // chorak, yil, maktab elementga muzlatiladi (keyin chorak o'zgarsa ham ish o'zgarmaydi)
    for (const it of st.items) Object.assign(it, { quarter: st.quarter, year: st.year, school: st.school, selected: false });
  }

  // Tekshiruvdan keyin: mavzusi bor, xatoli tekshiruv yoki rejasiz — belgilanmaydi
  function autoSelect(st) {
    let picked = 0;
    for (const it of st.items) {
      const c = it.check;
      it.selected = !!(it.plan && c && !it.checkFail && c.existing === 0 && picked < config.maxItems);
      if (it.selected) picked++;
    }
  }

  function statusText(it, lang) {
    if (!it.plan) return t(lang, `auto_r_${it.reason}`);
    if (it.checkFail) return t(lang, 'auto_st_fail', { why: whyText(lang, it.checkFail) });
    const c = it.check;
    if (!c) return t(lang, 'auto_has_plan', { n: it.plan.topics ?? '?' });
    const parts = [];
    if (c.existing > 0) parts.push(t(lang, 'auto_st_has', { e: c.existing, l: c.ok }));
    parts.push(c.bad > 0 ? t(lang, 'auto_st_bad', { t: c.total, l: c.ok }) : t(lang, 'auto_st_ready', { t: c.total, l: c.ok }));
    return parts.join(' · ');
  }

  function listKb(st, lang) {
    const kb = new InlineKeyboard()
      .text(t(lang, 'auto_btn_next'), 'au:ok').text(t(lang, 'auto_btn_q'), 'au:q').row()
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

  async function showList(ctx, st, lang) {
    const lines = [t(lang, 'auto_title', { q: st.quarter, year: st.year }), ''];
    for (const it of st.items) lines.push(`${it.selected ? '☑️' : '▫️'} ${it.i + 1}. ${esc(rowName(it))} — ${statusText(it, lang)}`);
    lines.push('', t(lang, 'auto_summary', { n: st.items.filter(i => i.selected).length }));
    if (config.maxItems < st.items.filter(i => i.plan).length) lines.push(t(lang, 'auto_limit', { n: config.maxItems }));
    st.phase = 'list';
    return sendLong(ctx, lines, { reply_markup: listKb(st, lang) });
  }

  // ---- fon ishi (tekshiruv ham, import ham) ----
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

  // mode: 'check' — faqat ko'rib chiqish; 'import' — haqiqiy import (elementning qarori bilan)
  function makeWork(id, st, mode) {
    let reloginFailed = false;   // bitta ishda qayta kirish faqat bir marta
    return async item => {
      if (!item.buf) {
        try { item.buf = await fetchPlanFile(item.plan.file_id); }
        catch (e) { log('[auto] file', e?.code || e?.message); return { item, state: 'failed', why: 'file' }; }
      }
      const run = async () => {
        const periodId = await periodFor(st, item.groupId, item.quarter);
        if (!periodId) return { state: 'failed', why: 'period' };
        return st.http.importOne({
          file: item.buf, fileName: item.plan.file_name || 'reja.xlsx', year: item.year.slice(0, 4), school: item.school,
          groupId: item.groupId, subjectId: item.subjectId, subgroupId: item.subgroupId, periodId,
          checkOnly: mode === 'check', okOnly: mode === 'import' && item.decision === 'okOnly',
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
        return { item, ...r };
      } catch (e) {
        log('[auto]', mode, item.className, item.subjectName, e?.code || '', e?.message || e);
        const why = e.code === 'RELOGIN' ? 'relogin' : e.code === 'MAINTENANCE' ? 'maint' : null;
        return { item, state: 'failed', why, error: why ? null : String(e?.message || e).slice(0, 200) };
      }
    };
  }

  // Bitta jarayon xabari: runner chaqiruvlari bilan tahrirlanadi (ko'pi bilan editDelayMs da bir)
  async function runWithProgress(ctx, id, items, work, render, onFinish) {
    if (runner.busy(id)) return false;
    const prog = { status: items.map(() => null), current: -1, queued: true };
    let msgId = null, timer = null, last = 0, final = false;
    const edit = async isFinal => {
      const { text } = render(prog, isFinal);
      await ctx.api.editMessageText(ctx.chat.id, msgId, text, { parse_mode: 'HTML' }).catch(() => {});
    };
    const schedule = () => {
      if (!msgId || final || timer) return;
      timer = setTimeout(() => { timer = null; last = Date.now(); if (!final) edit(false); },
        Math.max(0, last + editDelayMs - Date.now()));
    };
    const started = runner.start(id, {
      items, work,
      onRun: () => { prog.queued = false; schedule(); },
      onItemStart: i => { prog.current = i; schedule(); },
      onItemDone: (i, r) => { prog.status[i] = r; schedule(); },
      onDone: async results => {
        final = true;
        if (timer) { clearTimeout(timer); timer = null; }
        results.forEach((r, i) => { prog.status[i] = r; });
        if (msgId) await edit(true);
        await onFinish(results, { shownInFull: !!msgId && render(prog, true).complete });
      },
    });
    if (!started) return false;
    if (!final) {
      const m = await ctx.reply(render(prog, false).text, { parse_mode: 'HTML' });
      msgId = m?.message_id ?? null;
      if (final && msgId) await edit(true);   // ish xabar kelguncha tugagan bo'lsa
    }
    return true;
  }

  // ---- 1) tekshiruv ----
  function checkRender(lang, items) {
    return (prog, final) => {
      const done = prog.status.filter(Boolean).length;
      if (final) return { text: t(lang, 'auto_chk_done', { n: items.length }), complete: true };
      const cur = items[prog.current];
      const lines = [t(lang, 'auto_chk_title', { done, n: items.length })];
      if (prog.queued) lines.push(t(lang, 'auto_prog_queue'));
      else if (cur) lines.push(`⏳ ${esc(rowName(cur))}`);
      return { text: lines.join('\n'), complete: true };
    };
  }

  function applyCheck(item, r) {
    item.check = null;
    item.checkFail = null;
    if (r.state === 'checked') item.check = { total: r.total, ok: r.ok, bad: r.bad, existing: r.existing, rows: r.rows };
    else item.checkFail = { why: r.why, error: r.error };
  }

  async function checkAll(ctx, id, lang, st) {
    const items = st.items.filter(i => i.plan);
    if (!items.length) { st.phase = 'list'; return showList(ctx, st, lang); }
    st.phase = 'checking';
    const ok = await runWithProgress(ctx, id, items, makeWork(id, st, 'check'), checkRender(lang, items), async results => {
      results.forEach(r => applyCheck(r.item, r));
      autoSelect(st);
      await showList(ctx, st, lang);
    });
    if (!ok) await ctx.reply(t(lang, 'auto_busy'));
  }

  // Bitta elementni qayta tekshirish (guruh o'zgardi yoki birlashtirildi)
  async function recheckOne(ctx, id, lang, st, item, after) {
    await ctx.reply(t(lang, 'auto_checking_one'));
    const started = runner.start(id, {
      items: [item], work: makeWork(id, st, 'check'),
      onDone: async ([r]) => { applyCheck(item, r); await after(); },
    });
    if (!started) await ctx.reply(t(lang, 'auto_busy'));
  }

  // ---- 2) xatolilarni bittadan hal qilish ----
  function nextPending(st) {
    return st.queue.find(i => !st.items[i].decision);
  }

  async function showDecision(ctx, st, lang, item) {
    const pos = st.queue.indexOf(item.i) + 1;
    const c = item.check;
    const lines = [
      t(lang, 'auto_dec_title', { pos, total: st.queue.length, row: esc(rowName(item)) }),
      t(lang, 'auto_dec_info', { t: c.total, l: c.ok }), '',
      ...c.rows.map(r => {
        const hw = r.hw ? ` — <i>${esc(r.hw)}</i>` : '';
        return r.ok ? `${esc(r.n)}. ${esc(r.topic)}${hw}` : `⚠️ <b>${esc(r.n)}. ${esc(r.topic)}</b>${hw} (${esc(r.status)})`;
      }),
    ];
    st.phase = 'resolve';
    await sendLong(ctx, lines, { reply_markup: new InlineKeyboard()
      .text(t(lang, 'auto_btn_merge'), `au:m:${item.i}`)
      .text(t(lang, 'auto_btn_okonly'), `au:k:${item.i}`)
      .text(t(lang, 'auto_btn_skip'), `au:s:${item.i}`) });
  }

  async function advance(ctx, st, lang) {
    const i = nextPending(st);
    if (i === undefined) return showSummary(ctx, st, lang);
    return showDecision(ctx, st, lang, st.items[i]);
  }

  async function mergeItem(ctx, id, lang, st, item, text) {
    const prev = item.buf;
    try {
      const file = path.join(tmpDir, `${id}_${Date.now()}_auto.xlsx`);
      await writeFile(file, item.buf);
      const { rows, sheetName } = await readRows(file);   // xlsx.js: { rows, sheetName }
      const { pairs, error } = parsePairs(text, rows.length);
      if (error) return ctx.reply(t(lang, 'merge_err', { err: error }));
      st.wait = null;
      const out = `${file}.merged.xlsx`;
      await writeRows(applyMerges(rows, pairs), out, sheetName);
      item.buf = await readFile(out);
    } catch (e) {
      // jim qolmaymiz: sababini aytib, o'sha elementni qayta ko'rsatamiz
      log('[auto] merge', e?.message || e);
      st.wait = null;
      item.buf = prev;
      await ctx.reply(t(lang, 'error', { msg: e?.message || String(e) }));
      return showDecision(ctx, st, lang, item);
    }
    await recheckOne(ctx, id, lang, st, item, async () => {
      if (item.checkFail) { item.buf = prev; await ctx.reply(t(lang, 'auto_st_fail', { why: whyText(lang, item.checkFail) }), { parse_mode: 'HTML' }); return showDecision(ctx, st, lang, item); }
      if (item.check.bad === 0) {
        item.decision = 'merged';
        await ctx.reply(t(lang, 'auto_dec_ok', { row: esc(rowName(item)) }), { parse_mode: 'HTML' });
        return advance(ctx, st, lang);
      }
      await ctx.reply(t(lang, 'auto_dec_still', { bad: item.check.bad }));
      return showDecision(ctx, st, lang, item);
    });
  }

  // ---- 3) xulosa va import ----
  function toImport(st) {
    return st.picked.map(i => st.items[i]).filter(it => it.decision !== 'skip');
  }

  async function showSummary(ctx, st, lang) {
    const list = toImport(st);
    const skipped = st.picked.length - list.length;
    const replaced = list.filter(it => it.check?.existing > 0).length;
    const tag = it => (it.decision === 'okOnly' ? ` (${t(lang, 'auto_tag_okonly')})` : it.decision === 'merged' ? ` (${t(lang, 'auto_tag_merged')})` : '');
    const lines = [t(lang, 'auto_sum_title'), '', ...list.map(it => `• ${esc(rowName(it))}${tag(it)}`), '',
      t(lang, 'auto_sum', { n: list.length, k: skipped })];
    if (replaced) lines.push(t(lang, 'auto_sum_replace', { e: replaced }));
    st.phase = 'summary';
    if (!list.length) return sendLong(ctx, lines);
    return sendLong(ctx, lines, { reply_markup: new InlineKeyboard()
      .text(t(lang, 'auto_btn_ok'), 'au:go').text(t(lang, 'auto_btn_x'), 'au:x') });
  }

  function resultLine(r, lang) {
    const row = esc(rowName(r.item));
    if (r.state === 'done') return t(lang, r.result?.ok === null ? 'auto_res_check' : 'auto_res_done', { row, n: r.imported });
    if (r.state === 'needs_choice') return t(lang, 'auto_res_changed', { row, bad: r.rows.filter(x => !x.ok).length });
    return t(lang, 'auto_res_fail', { row, why: whyText(lang, r) });
  }

  function importRender(lang, items) {
    return (prog, final) => {
      const done = prog.status.filter(Boolean).length;
      const head = final ? t(lang, 'auto_title_done') : t(lang, 'auto_prog_title', { q: items[0].quarter, done, n: items.length });
      const lines = items.map((it, i) => (prog.status[i] ? resultLine(prog.status[i], lang)
        : i === prog.current && !prog.queued ? `⏳ ${esc(rowName(it))} — ${t(lang, 'auto_prog_running')}`
          : `▫️ ${esc(rowName(it))}`));
      const top = [head, ...(prog.queued && !final ? [t(lang, 'auto_prog_queue')] : []), ''];
      let body = lines;
      const fits = b => [...top, ...b].join('\n').length <= CHUNK;
      if (!fits(body)) {
        const pending = body.filter(l => l.startsWith('▫️')).length;
        body = body.filter(l => !l.startsWith('▫️'));
        if (pending) body.push(t(lang, 'auto_more', { n: pending }));
      }
      let cut = false;
      while (!fits(body) && body.length > 1) { body = body.slice(1); cut = true; }
      if (cut) body = ['…', ...body];
      return { text: [...top, ...body].join('\n'), complete: !cut && body.length === lines.length };
    };
  }

  async function adminReport(id, results) {
    const count = s => results.filter(r => r.state === s).length;
    const report = `🤖 auto · ${id}: ✅ ${count('done')} · ⚠️ ${count('needs_choice')} · ❌ ${count('failed')}` +
      results.filter(r => r.state === 'failed').map(r => `\n❌ ${esc(rowName(r.item))}: ${esc(r.why || r.error || '')}`).join('') +
      // eMaktab javobi noaniq: sahifa manzili va kalit so'zli parchalar (natija sahifasini o'rganish uchun)
      results.filter(r => r.state === 'done' && r.result?.ok === null).map(r =>
        `\n❔ ${esc(rowName(r.item))}: ${esc(r.result.url || '')} · step1=${r.result.backAtStep1 ? 'ha' : "yo'q"} · ${esc((r.result.snippets || []).join(' | ') || r.result.text || '')}`).join('');
    await notifyAdmin(report.length > 3500 ? `${report.slice(0, 3500)}\n…` : report);
  }

  async function importAll(ctx, id, lang, st) {
    const items = toImport(st);
    if (!items.length) return ctx.reply(t(lang, 'auto_none'));
    st.phase = 'importing';
    const ok = await runWithProgress(ctx, id, items, makeWork(id, st, 'import'), importRender(lang, items), async (results, { shownInFull }) => {
      if (!shownInFull) await sendLong(ctx, [t(lang, 'auto_title_done'), '', ...results.map(r => resultLine(r, lang))]);
      st.phase = 'done';
      await adminReport(id, results);
    });
    if (!ok) await ctx.reply(t(lang, 'auto_busy'));
  }

  // Savollar (til, BSB) javob berilmagan bo'lsa — so'raymiz, aks holda tekshiruv
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
    return checkAll(ctx, id, lang, st);
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
          queue: [], picked: [], wait: null, prefs: {}, phase: 'start',
        });
        await proceed(ctx, id, lang);
      } catch (e) {
        log('[auto] start', e?.code || '', e?.message || e);
        await ctx.reply(e.code === 'MAINTENANCE' || e.message === 'MAINTENANCE'
          ? t(lang, 'maintenance') : t(lang, 'error', { msg: e.message }));
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
      // tekshiruv yoki import ketayotganda hech narsa o'zgarmaydi
      if (runner.busy(id) && cmd !== 'x') return ctx.reply(t(lang, 'auto_busy'));

      if (cmd === 'lang' && ['uz', 'ru', 'both'].includes(a)) { await db.setAutoMedium(id, a); return proceed(ctx, id, lang); }
      if (cmd === 'bsb') { await db.setAutoGrading(id, a === '1' ? 'bsb' : 'normal'); return proceed(ctx, id, lang); }
      if (cmd === 'x') { states.delete(id); return ctx.reply(t(lang, 'cancelled')); }

      // ro'yxat bosqichi
      if (['q', 'md', 'sel', 't', 'seld', 'g', 'gs', 'ok'].includes(cmd) && st.phase !== 'list') return ctx.reply(t(lang, 'session_end'));
      if (cmd === 'q' && !a) {
        const kb = new InlineKeyboard();
        [1, 2, 3, 4].forEach(n => kb.text(`${n}`, `au:q:${n}`));
        return ctx.reply(t(lang, 'auto_pick_q'), { reply_markup: kb });
      }
      if (cmd === 'q') { st.quarter = Number(a); st.periods = null; await rebuild(st); return checkAll(ctx, id, lang, st); }
      if (cmd === 'md') {
        const c = st.classes[Number(a)];
        if (c) st.mediumOverride[c.groupId] = (st.mediumOverride[c.groupId] || 'uz') === 'uz' ? 'ru' : 'uz';
        await rebuild(st);
        return checkAll(ctx, id, lang, st);
      }
      if (cmd === 'sel' || cmd === 't') {
        if (cmd === 't') { const it = st.items[Number(a)]; if (it?.plan && it.check) it.selected = !it.selected; }
        const kb = new InlineKeyboard();
        for (const it of st.items.filter(x => x.plan && x.check))
          kb.text(`${it.selected ? '✅' : '⬜'} ${it.i + 1}. ${rowName(it)}`.slice(0, 60), `au:t:${it.i}`).row();
        kb.text(t(lang, 'auto_btn_done'), 'au:seld');
        return cmd === 't' ? ctx.editMessageReplyMarkup({ reply_markup: kb }).catch(() => {})
          : ctx.reply(t(lang, 'auto_pick_sel'), { reply_markup: kb });
      }
      if (cmd === 'seld') return showList(ctx, st, lang);
      if (cmd === 'g' && !a) { setWait(st, 'group'); return ctx.reply(t(lang, 'auto_pick_row')); }
      if (cmd === 'gs') {
        const it = st.items[Number(a)];
        const sg = st.sg?.[Number(a)]?.[Number(b)];
        if (!it || !sg) return showList(ctx, st, lang);
        it.subgroupId = sg.id; it.subgroupName = sg.name;
        if (!it.plan) return showList(ctx, st, lang);
        return recheckOne(ctx, id, lang, st, it, () => showList(ctx, st, lang));
      }
      if (cmd === 'ok') {
        const picked = st.items.filter(i => i.selected && i.plan && i.check).slice(0, config.maxItems);
        if (!picked.length) return ctx.reply(t(lang, 'auto_none'));
        for (const it of st.items) it.decision = null;
        st.picked = picked.map(i => i.i);
        st.queue = picked.filter(i => i.check.bad > 0).map(i => i.i);
        return advance(ctx, st, lang);
      }

      // bittadan hal qilish
      if (['m', 'k', 's'].includes(cmd)) {
        const item = st.items[Number(a)];
        if (st.phase !== 'resolve' || !item || !st.queue.includes(item.i) || item.decision) return ctx.reply(t(lang, 'session_end'));
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});
        if (cmd === 'm') { setWait(st, 'merge'); st.mergeIdx = item.i; return ctx.reply(t(lang, 'merge_prompt'), { parse_mode: 'HTML' }); }
        item.decision = cmd === 'k' ? 'okOnly' : 'skip';
        if (cmd === 's') await ctx.reply(t(lang, 'auto_skipped', { row: esc(rowName(item)) }), { parse_mode: 'HTML' });
        return advance(ctx, st, lang);
      }

      // yakuniy tasdiq
      if (cmd === 'go') {
        if (st.phase !== 'summary') return ctx.reply(t(lang, 'session_end'));
        return importAll(ctx, id, lang, st);
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
        const item = st.items[st.mergeIdx];
        if (!item || runner.busy(id)) { st.wait = null; await ctx.reply(t(lang, runner.busy(id) ? 'auto_busy' : 'session_end')); return true; }
        await mergeItem(ctx, id, lang, st, item, text);
        return true;
      }
      return false;
    },
  };
}
