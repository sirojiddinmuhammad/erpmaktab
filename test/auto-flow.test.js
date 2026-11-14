import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoFlow } from '../auto/flow.js';
import { createRunner } from '../auto/runner.js';
import { t } from '../i18n.js';

const ADMIN = 1, TESTER = 7, OTHER = 9;
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

const CLASSES = {
  school: '100', periodId: 'p2',
  classes: [
    { groupId: 'g4', className: '4-A', subjects: [{ id: 's1', name: 'Математика' }, { id: 's2', name: 'Информатика' }] },
    { groupId: 'g7', className: '7-B', subjects: [{ id: 's2', name: 'Информатика' }] },
  ],
};
const PERIODS = [{ id: 'p1', name: '1 четверть', n: 1 }, { id: 'p2', name: '2 четверть', n: 2 }, { id: 'p3', name: '3 четверть', n: 3 }];

function setup(over = {}) {
  const calls = { importOne: [], findPlan: [], logins: 0, admin: [], prefs: [] };
  const prefs = { grading: 'normal', medium: 'uz', ...(over.prefs || {}) };
  const db = {
    getCreds: async id => (over.noCreds ? null : { username: 'u', password: 'p' }),
    getState: async () => (over.noState ? null : { cookies: [{ name: 'a', value: '1', domain: '.emaktab.uz', path: '/' }] }),
    saveState: async () => {},
    getAutoPrefs: async () => ({ ...prefs }),
    setAutoGrading: async (id, v) => { prefs.grading = v; calls.prefs.push(['grading', v]); },
    setAutoMedium: async (id, v) => { prefs.medium = v; calls.prefs.push(['medium', v]); },
    findActivePlan: async k => { calls.findPlan.push(k); return over.noPlan?.(k) ? null : { id: 1, topics: 34, file_id: 'drive:x', file_name: 'r.xlsx' }; },
    chargeImport: async () => { throw new Error('chargeImport must not be called'); },
    checkQuota: async () => { throw new Error('checkQuota must not be called'); },
  };
  let importImpl = over.importOne || (async () => ({ state: 'done', imported: 34, rows: [] }));
  const http = {
    listClassSubjects: async () => (over.classes || CLASSES),
    subgroups: async () => [{ id: '', name: 'Весь класс' }, { id: 'sg1', name: '1 группа' }],
    periods: async () => PERIODS,
    importOne: async job => { calls.importOne.push(job); return importImpl(job); },
  };
  const deps = {
    db, t, L: async () => 'uz', adminId: ADMIN,
    config: { testers: new Set([TESTER]), concurrency: 2, maxItems: over.maxItems ?? 10 },
    runner: createRunner({ concurrency: 2, log: () => {} }),
    createHttp: () => http,
    login: async () => { calls.logins++; if (over.loginError) throw over.loginError; return { cookies: [] }; },
    askTwoFactor: async (ctx, id, lang, es, link) => { ctx.replies.push({ text: `2FA ${link}` }); },
    fetchPlanFile: async () => Buffer.from('xlsx'),
    keyOf: name => ({ 'Математика': 'math', 'Информатика': 'it' })[name] ?? null,
    allowed: () => null,
    notifyAdmin: async text => { calls.admin.push(text); },
    readRows: async () => [{ topic: 'a', hw: '' }, { topic: 'b', hw: '' }, { topic: 'c', hw: '' }],
    writeRows: async () => {},
    readFile: async () => Buffer.from('merged'),
    writeFile: async () => {},
    tmpDir: '/tmp/x',
    now: () => new Date('2026-11-14T10:00:00Z'),
    log: () => {},
  };
  const flow = createAutoFlow(deps);
  return { flow, calls, prefs, setImport: f => { importImpl = f; } };
}

function ctxFor(id, { data, text } = {}) {
  const replies = [];
  const ctx = {
    from: { id }, chat: { id }, replies,
    callbackQuery: data ? { data } : undefined,
    message: text ? { text } : undefined,
    reply: async (text, opts) => { replies.push({ text, opts }); return { message_id: replies.length }; },
    editMessageText: async (text, opts) => { replies.push({ text, opts, edit: true }); },
    editMessageReplyMarkup: async opts => { replies.push({ markup: opts, edit: true }); },
    answerCallbackQuery: async () => {},
    api: {
      sendMessage: async (chat, text, opts) => { replies.push({ text, opts }); return { message_id: replies.length }; },
      deleteMessage: async () => {},
    },
  };
  return ctx;
}
const buttons = r => (r?.opts?.reply_markup?.inline_keyboard || []).flat();
const lastWithButtons = ctx => [...ctx.replies].reverse().find(r => buttons(r).length);
const press = async (s, id, data, ctx = ctxFor(id, { data })) => { await s.flow.callback(ctx); return ctx; };

test('non-tester: /auto is silent and passes on', async () => {
  const s = setup();
  const ctx = ctxFor(OTHER);
  assert.equal(await s.flow.command(ctx), false);
  assert.equal(ctx.replies.length, 0);
});

test('no linked account → need_login', async () => {
  const s = setup({ noCreds: true });
  const ctx = ctxFor(TESTER);
  assert.equal(await s.flow.command(ctx), true);
  assert.equal(ctx.replies.at(-1).text, t('uz', 'need_login'));
});

test('language is asked once and saved', async () => {
  const s = setup({ prefs: { medium: null } });
  const ctx = ctxFor(TESTER);
  await s.flow.command(ctx);
  const b = buttons(lastWithButtons(ctx)).map(x => x.callback_data);
  assert.deepEqual(b, ['au:lang:uz', 'au:lang:ru', 'au:lang:both']);
  const c2 = await press(s, TESTER, 'au:lang:ru');
  assert.deepEqual(s.calls.prefs, [['medium', 'ru']]);
  assert.ok(s.calls.findPlan.every(k => k.medium === 'ru'));
  assert.match(c2.replies.at(-1).text, /Avtomatik import/);
});

test('BSB is asked for grades 5–11 when unknown', async () => {
  const s = setup({ prefs: { grading: null } });
  const ctx = ctxFor(TESTER);
  await s.flow.command(ctx);
  assert.deepEqual(buttons(lastWithButtons(ctx)).map(x => x.callback_data), ['au:bsb:1', 'au:bsb:0']);
  await press(s, TESTER, 'au:bsb:1');
  assert.deepEqual(s.calls.prefs, [['grading', 'bsb']]);
  assert.equal(s.calls.findPlan.find(k => k.grade === 7).grading, 'bsb');
});

test('preview lists items with plan status, quarter and replacement warning', async () => {
  const s = setup({ noPlan: k => k.grade === 7 });
  const ctx = ctxFor(TESTER);
  await s.flow.command(ctx);
  const msg = ctx.replies.at(-1).text;
  assert.match(msg, /2-chorak · 2026\/2027/);
  assert.match(msg, /4-A · Математика — ✅/);
  assert.match(msg, /34/);
  assert.match(msg, /7-B · Информатика — ❌/);
  assert.match(msg, /almashtiriladi/);
  const b = buttons(ctx.replies.at(-1)).map(x => x.callback_data);
  for (const d of ['au:ok', 'au:q', 'au:g', 'au:sel', 'au:x']) assert.ok(b.includes(d), d);
});

test('changing the quarter rebuilds with that quarter', async () => {
  const s = setup();
  await s.flow.command(ctxFor(TESTER));
  await press(s, TESTER, 'au:q');
  await press(s, TESTER, 'au:q:3');
  assert.ok(s.calls.findPlan.at(-1).quarter === 3);
});

test('maxItems selects only the first items; toggling changes the selection', async () => {
  const s = setup({ maxItems: 1 });
  const ctx = ctxFor(TESTER);
  await s.flow.command(ctx);
  await press(s, TESTER, 'au:sel');
  await press(s, TESTER, 'au:t:0');   // birinchisini o'chiramiz
  await press(s, TESTER, 'au:t:1');   // ikkinchisini yoqamiz
  await press(s, TESTER, 'au:seld');
  await press(s, TESTER, 'au:ok');
  await tick();
  assert.deepEqual(s.calls.importOne.map(j => j.subjectId), ['s2']);
  assert.equal(s.calls.importOne[0].groupId, 'g4');
});

test('Tasdiqlash runs in background with the right job and reports', async () => {
  const s = setup();
  await s.flow.command(ctxFor(TESTER));
  const c = await press(s, TESTER, 'au:ok');
  assert.equal(c.replies[0].text, t('uz', 'auto_started', { n: 3 }));
  await tick();
  const j = s.calls.importOne[0];
  assert.deepEqual({ year: j.year, school: j.school, periodId: j.periodId, subgroupId: j.subgroupId },
    { year: '2026', school: '100', periodId: 'p2', subgroupId: '' });
  assert.ok(Buffer.isBuffer(j.file));
  assert.match(c.replies.at(-1).text, /✅ 4-A · Математика — 34/);
  assert.equal(s.calls.admin.length, 1);
});

test('no selected items → auto_none', async () => {
  const s = setup({ noPlan: () => true });
  await s.flow.command(ctxFor(TESTER));
  const c = await press(s, TESTER, 'au:ok');
  assert.equal(c.replies.at(-1).text, t('uz', 'auto_none'));
});

test('subgroup change applies to the import job', async () => {
  const s = setup();
  await s.flow.command(ctxFor(TESTER));
  await press(s, TESTER, 'au:g');
  const c = ctxFor(TESTER, { text: '1' });
  assert.equal(await s.flow.text(c), true);
  assert.ok(buttons(c.replies.at(-1)).some(b => b.callback_data === 'au:gs:0:1'));
  await press(s, TESTER, 'au:gs:0:1');
  await press(s, TESTER, 'au:ok');
  await tick();
  assert.equal(s.calls.importOne[0].subgroupId, 'sg1');
});

test('language "both" shows per-class toggles that switch medium', async () => {
  const s = setup({ prefs: { medium: 'both' } });
  const ctx = ctxFor(TESTER);
  await s.flow.command(ctx);
  assert.ok(buttons(ctx.replies.at(-1)).some(b => b.callback_data === 'au:md:1'));
  await press(s, TESTER, 'au:md:1');
  const last = s.calls.findPlan.slice(-3);
  assert.equal(last.find(k => k.grade === 7).medium, 'ru');
  assert.equal(last.find(k => k.grade === 4).medium, 'uz');
});

test('error rows → needs choice with merge / ok-only / skip buttons; ok-only imports', async () => {
  const rows = [{ ok: true }, { ok: false }];
  const s = setup({ maxItems: 1, importOne: async job => (job.okOnly ? { state: 'done', imported: 1, rows } : { state: 'needs_choice', rows, imported: 0 }) });
  await s.flow.command(ctxFor(TESTER));
  const c = await press(s, TESTER, 'au:ok');
  await tick();
  const choice = c.replies.find(r => buttons(r).some(b => b.callback_data === 'au:k:0'));
  assert.ok(choice, 'choice buttons');
  assert.deepEqual(buttons(choice).map(b => b.callback_data), ['au:m:0', 'au:k:0', 'au:s:0']);
  const c2 = await press(s, TESTER, 'au:k:0');
  await tick();
  assert.equal(s.calls.importOne.at(-1).okOnly, true);
  assert.match(c2.replies.at(-1).text, /✅/);
});

test('merge: pairs are applied and the item is imported again', async () => {
  let n = 0;
  const s = setup({ maxItems: 1, importOne: async () => (++n === 1 ? { state: 'needs_choice', rows: [{ ok: false }], imported: 0 } : { state: 'done', imported: 2, rows: [] }) });
  await s.flow.command(ctxFor(TESTER));
  await press(s, TESTER, 'au:ok');
  await tick();
  await press(s, TESTER, 'au:m:0');
  const c = ctxFor(TESTER, { text: '1-2' });
  assert.equal(await s.flow.text(c), true);
  await tick();
  assert.equal(s.calls.importOne.length, 2);
  assert.equal(String(s.calls.importOne[1].file), 'merged');
});

test('session expired mid-run: one re-login then retry', async () => {
  let n = 0;
  const s = setup({ maxItems: 1, importOne: async () => { if (++n === 1) throw Object.assign(new Error('x'), { code: 'SESSION_EXPIRED' }); return { state: 'done', imported: 5, rows: [] }; } });
  await s.flow.command(ctxFor(TESTER));
  const c = await press(s, TESTER, 'au:ok');
  await tick();
  assert.equal(s.calls.logins, 1);
  assert.equal(s.calls.importOne.length, 2);
  assert.match(c.replies.at(-1).text, /✅/);
});

test('re-login needing 2FA in background fails the item with a retry hint', async () => {
  const twofa = Object.assign(new Error('TWO_FA'), { es: { close: async () => {} } });
  const s = setup({ maxItems: 1, loginError: twofa, importOne: async () => { throw Object.assign(new Error('x'), { code: 'SESSION_EXPIRED' }); } });
  await s.flow.command(ctxFor(TESTER));
  const c = await press(s, TESTER, 'au:ok');
  await tick();
  assert.match(c.replies.at(-1).text, /❌/);
  assert.match(c.replies.at(-1).text, /\/auto/);
});

test('stale button without state → session_end', async () => {
  const s = setup();
  const c = await press(s, TESTER, 'au:ok');
  assert.equal(c.replies.at(-1).text, t('uz', 'session_end'));
});

test('cancel clears state', async () => {
  const s = setup();
  await s.flow.command(ctxFor(TESTER));
  await press(s, TESTER, 'au:x');
  const c = await press(s, TESTER, 'au:ok');
  assert.equal(c.replies.at(-1).text, t('uz', 'session_end'));
});

test('2FA during first connect hands over to askTwoFactor', async () => {
  const twofa = Object.assign(new Error('TWO_FA'), { es: {}, link: 'https://t.me/x' });
  const s = setup({ noState: true, loginError: twofa });
  const ctx = ctxFor(TESTER);
  await s.flow.command(ctx);
  assert.match(ctx.replies.at(-1).text, /2FA https:\/\/t\.me\/x/);
});

test('allowed and wants answer synchronously for bot routing', async () => {
  const s = setup();
  assert.equal(s.flow.allowed(TESTER), true);
  assert.equal(s.flow.allowed(OTHER), false);
  assert.equal(s.flow.wants(TESTER), false);
  await s.flow.command(ctxFor(TESTER));
  await press(s, TESTER, 'au:g');
  assert.equal(s.flow.wants(TESTER), true);
});
