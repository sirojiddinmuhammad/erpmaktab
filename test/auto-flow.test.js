import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoFlow } from '../auto/flow.js';
import { createRunner } from '../auto/runner.js';
import { t } from '../i18n.js';

const ADMIN = 1, TESTER = 7, OTHER = 9;
const tick = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

const CLASSES = {
  school: '100', periodId: 'p2',
  classes: [
    { groupId: 'g4', className: '4-A', subjects: [{ id: 's1', name: 'Математика' }, { id: 's2', name: 'Информатика' }] },
    { groupId: 'g7', className: '7-B', subjects: [{ id: 's2', name: 'Информатика' }] },
  ],
};
const PERIODS = [{ id: 'p1', name: '1 четверть', n: 1 }, { id: 'p2', name: '2 четверть', n: 2 }, { id: 'p3', name: '3 четверть', n: 3 }];
const rowsOf = (ok, bad = 0, existing = 0) => [
  ...Array.from({ length: ok }, (_, k) => ({ n: String(k + 1), lesson: String(k + 1), topic: `Mavzu ${k + 1}`, hw: '', ok: true, replaces: k < existing, status: 'Готов к импорту.' })),
  ...Array.from({ length: bad }, (_, k) => ({ n: String(ok + k + 1), lesson: String(ok + k + 1), topic: `Mavzu ${ok + k + 1}`, hw: '', ok: false, replaces: false, status: 'Номер урока превышает общее количество уроков по предмету.' })),
];
const checked = (ok, bad = 0, existing = 0) => ({ state: 'checked', rows: rowsOf(ok, bad, existing), total: ok + bad, ok, bad, existing });

function setup(over = {}) {
  const calls = { importOne: [], findPlan: [], logins: 0, admin: [], prefs: [], files: 0 };
  const prefs = { grading: 'normal', medium: 'uz', ...(over.prefs || {}) };
  const db = {
    getCreds: async () => (over.noCreds ? null : { username: 'u', password: 'p' }),
    getState: async () => null,
    getStateAny: async () => (over.noState ? null : { cookies: [{ name: 'a', value: '1', domain: '.emaktab.uz', path: '/' }] }),
    saveState: async () => {},
    getAutoPrefs: async () => ({ ...prefs }),
    setAutoGrading: async (id, v) => { prefs.grading = v; calls.prefs.push(['grading', v]); },
    setAutoMedium: async (id, v) => { prefs.medium = v; calls.prefs.push(['medium', v]); },
    findActivePlan: async k => { calls.findPlan.push(k); return over.noPlan?.(k) ? null : { id: 1, topics: 7, file_id: 'drive:x', file_name: 'r.xlsx' }; },
    chargeImport: async () => { throw new Error('chargeImport must not be called'); },
    checkQuota: async () => { throw new Error('checkQuota must not be called'); },
  };
  const check = over.check || (() => checked(7));
  const imp = over.importOne || (async job => (job.checkOnly ? check(job) : { state: 'done', imported: 7, rows: [] }));
  const http = {
    listClassSubjects: async () => (over.classes || CLASSES),
    subgroups: async () => [{ id: '', name: 'Весь класс' }, { id: 'sg1', name: '1 группа' }],
    periods: async () => PERIODS,
    importOne: async job => { calls.importOne.push(job); return imp(job); },
  };
  const deps = {
    db, t, L: async () => 'uz', adminId: ADMIN,
    config: { testers: new Set([TESTER]), concurrency: 2, maxItems: over.maxItems ?? 10 },
    runner: over.runner || createRunner({ concurrency: 2, log: () => {} }),
    editDelayMs: 0,
    createHttp: () => http,
    login: async () => { calls.logins++; if (over.loginError) throw over.loginError; return { cookies: [] }; },
    askTwoFactor: async (ctx, id, lang, es, link) => { ctx.replies.push({ text: `2FA ${link}` }); },
    fetchPlanFile: async () => { calls.files++; return Buffer.from('xlsx'); },
    keyOf: name => ({ 'Математика': 'math', 'Информатика': 'it' })[name] ?? null,
    allowed: () => null,
    notifyAdmin: async text => { calls.admin.push(text); },
    readRows: async () => [{ topic: 'a', hw: '' }, { topic: 'b', hw: '' }, { topic: 'c', hw: '' }],
    writeRows: async () => {},
    readFile: async () => Buffer.from('merged'),
    writeFile: async () => {},
    tmpDir: '/tmp/x',
    now: over.now || (() => new Date('2026-11-14T10:00:00Z')),
    log: () => {},
  };
  return { flow: createAutoFlow(deps), calls, prefs };
}

function ctxFor(id, { data, text } = {}) {
  const replies = [];
  return {
    from: { id }, chat: { id }, replies,
    callbackQuery: data ? { data } : undefined,
    message: text ? { text } : undefined,
    reply: async (txt, opts) => { replies.push({ text: txt, opts }); return { message_id: replies.length }; },
    editMessageReplyMarkup: async opts => { replies.push({ markup: opts, edit: true }); },
    answerCallbackQuery: async () => {},
    api: {
      editMessageText: async (chat, mid, txt, opts) => { replies.push({ text: txt, opts, edit: true, id: mid }); },
    },
  };
}
const buttons = r => (r?.opts?.reply_markup?.inline_keyboard || []).flat();
const lastWithButtons = ctx => [...ctx.replies].reverse().find(r => buttons(r).length);
const data = ctx => buttons(lastWithButtons(ctx)).map(b => b.callback_data);
const allText = ctx => ctx.replies.map(r => r.text || '').join('\n');
async function press(s, id, d) { const c = ctxFor(id, { data: d }); await s.flow.callback(c); await tick(); return c; }
async function start(s, id = TESTER) { const c = ctxFor(id); await s.flow.command(c); await tick(); return c; }
const imports = s => s.calls.importOne.filter(j => !j.checkOnly);
const checks = s => s.calls.importOne.filter(j => j.checkOnly);

// ---- kirish ----
test('non-tester: /auto is silent and passes on', async () => {
  const s = setup();
  const c = ctxFor(OTHER);
  assert.equal(await s.flow.command(c), false);
  assert.equal(c.replies.length, 0);
});

test('no linked account → need_login', async () => {
  const s = setup({ noCreds: true });
  const c = await start(s);
  assert.equal(c.replies.at(-1).text, t('uz', 'need_login'));
});

test('saved eMaktab cookies are reused (no new login, no 2FA)', async () => {
  const s = setup();
  await start(s);
  assert.equal(s.calls.logins, 0);
});

test('2FA during first connect hands over to askTwoFactor', async () => {
  const s = setup({ noState: true, loginError: Object.assign(new Error('TWO_FA'), { es: {}, link: 'https://t.me/x' }) });
  const c = await start(s);
  assert.match(c.replies.at(-1).text, /2FA https:\/\/t\.me\/x/);
});

test('language is asked once and saved, then checks run', async () => {
  const s = setup({ prefs: { medium: null } });
  const c = await start(s);
  assert.deepEqual(data(c), ['au:lang:uz', 'au:lang:ru', 'au:lang:both']);
  await press(s, TESTER, 'au:lang:ru');
  assert.deepEqual(s.calls.prefs, [['medium', 'ru']]);
  assert.ok(s.calls.findPlan.every(k => k.medium === 'ru'));
  assert.equal(checks(s).length, 3);
});

test('BSB is asked for grades 5–11 when unknown', async () => {
  const s = setup({ prefs: { grading: null } });
  const c = await start(s);
  assert.deepEqual(data(c), ['au:bsb:1', 'au:bsb:0']);
  await press(s, TESTER, 'au:bsb:1');
  assert.equal(s.calls.findPlan.find(k => k.grade === 7).grading, 'bsb');
});

// ---- tekshiruv va ro'yxat ----
test('/auto checks every planned item first, without importing, then lists statuses', async () => {
  const s = setup({ noPlan: k => k.grade === 7 });
  const c = await start(s);
  assert.equal(checks(s).length, 2);
  assert.equal(imports(s).length, 0);
  assert.match(allText(c), /Tekshirilmoqda/);
  const list = lastWithButtons(c).text;
  assert.match(list, /4-A · Математика · Весь класс — ✅ tayyor \(7 mavzu, 7 dars\)/);
  assert.match(list, /7-B · Информатика · Весь класс — ❌ bazada reja yo'q/);
  for (const d of ['au:ok', 'au:q', 'au:g', 'au:sel', 'au:x']) assert.ok(data(c).includes(d), d);
});

test('items whose topics already exist are listed with the reason and not selected', async () => {
  const s = setup({ check: job => (job.subjectId === 's2' && job.groupId === 'g4' ? checked(7, 0, 7) : job.groupId === 'g7' ? checked(6, 0, 3) : checked(7)) });
  const c = await start(s);
  const list = lastWithButtons(c).text;
  assert.match(list, /▫️ 2\. 4-A · Информатика · Весь класс — 📝 eMaktab'da mavzular bor \(7\/7\)/);
  assert.match(list, /▫️ 3\. 7-B · Информатика · Весь класс — 📝 eMaktab'da mavzular bor \(3\/6\)/);
  assert.match(list, /☑️ 1\. 4-A · Математика/);
  // o'zi belgilay oladi
  await press(s, TESTER, 'au:sel');
  await press(s, TESTER, 'au:t:1');
  await press(s, TESTER, 'au:seld');
  const c2 = await press(s, TESTER, 'au:ok');
  assert.match(allText(c2), /mavjud mavzular almashtiriladi/);
});

test('a failed check is shown with its reason and not selected', async () => {
  const s = setup({ check: job => (job.groupId === 'g7' ? { state: 'failed', why: 'period' } : checked(7)) });
  const c = await start(s);
  assert.match(lastWithButtons(c).text, /▫️ 3\. 7-B · Информатика · Весь класс — ❌ tekshirib bo'lmadi: eMaktab'da bu chorak topilmadi/);
});

test('maxItems selects only the first items', async () => {
  const s = setup({ maxItems: 1 });
  const c = await start(s);
  const list = lastWithButtons(c).text;
  assert.equal((list.match(/☑️/g) || []).length, 1);
});

test('changing the quarter re-checks with that quarter', async () => {
  const s = setup();
  await start(s);
  await press(s, TESTER, 'au:q');
  await press(s, TESTER, 'au:q:3');
  assert.equal(s.calls.findPlan.at(-1).quarter, 3);
  assert.equal(checks(s).at(-1).periodId, 'p3');
});

test('nothing can be changed while the check is running', async () => {
  const releases = [];
  const s = setup({ importOne: () => new Promise(r => releases.push(() => r(checked(7)))) });
  await start(s);
  const c = await press(s, TESTER, 'au:q:3');
  assert.equal(c.replies.at(-1).text, t('uz', 'auto_busy'));
  for (let k = 0; k < 5; k++) { releases.shift()?.(); await tick(); }
});

// ---- xulosa va import ----
test('all ready: Davom etish goes straight to the summary; Tasdiqlash imports once with the checked files', async () => {
  const s = setup();
  await start(s);
  const c = await press(s, TESTER, 'au:ok');
  assert.match(allText(c), /Xulosa/);
  assert.match(allText(c), /3 ta import qilinadi, 0 tasi o'tkazib yuboriladi/);
  assert.deepEqual(data(c), ['au:go', 'au:x']);
  assert.equal(imports(s).length, 0);
  const c2 = await press(s, TESTER, 'au:go');
  await tick(20);
  assert.equal(imports(s).length, 3);
  assert.equal(s.calls.files, 3, 'plan files fetched once, reused for import');
  const j = imports(s)[0];
  assert.deepEqual({ year: j.year, school: j.school, periodId: j.periodId, okOnly: j.okOnly }, { year: '2026', school: '100', periodId: 'p2', okOnly: false });
  const last = c2.replies.filter(r => r.edit).at(-1).text;
  assert.match(last, /Avtomatik import tugadi/);
  assert.equal((last.match(/✅/g) || []).length, 3);
  assert.equal(s.calls.admin.length, 1);
});

test('error items are shown one at a time with their topic list; decisions, then summary, then one import', async () => {
  const s = setup({ check: job => (job.groupId === 'g4' ? checked(6, 1) : checked(7)) });
  await start(s);
  const c = await press(s, TESTER, 'au:ok');
  const first = allText(c);
  assert.match(first, /1\/2/);
  assert.match(first, /4-A · Математика/);
  assert.match(first, /Rejada 7 mavzu, eMaktab'da 6 dars/);
  assert.match(first, /1\. Mavzu 1/);
  assert.match(first, /⚠️ <b>7\. Mavzu 7<\/b>.*превышает/);
  assert.doesNotMatch(first, /2\/2/);
  assert.deepEqual(data(c), ['au:m:0', 'au:k:0', 'au:s:0']);
  const c2 = await press(s, TESTER, 'au:k:0');
  assert.match(allText(c2), /2\/2<\/b> · 4-A · Информатика/);
  const c3 = await press(s, TESTER, 'au:s:1');
  assert.match(allText(c3), /Xulosa/);
  assert.match(allText(c3), /4-A · Математика · Весь класс \(ortiqchasiz\)/);
  assert.match(allText(c3), /2 ta import qilinadi, 1 tasi o'tkazib yuboriladi/);
  assert.equal(imports(s).length, 0);
  await press(s, TESTER, 'au:go');
  await tick(20);
  assert.deepEqual(imports(s).map(j => [j.groupId, j.subjectId, j.okOnly]), [['g4', 's1', true], ['g7', 's2', false]]);
});

test('merge: pairs are applied, the merged file is re-checked, and used for the final import', async () => {
  const s = setup({ maxItems: 1, check: job => (String(job.file) === 'merged' ? checked(6) : checked(6, 1)) });
  await start(s);
  await press(s, TESTER, 'au:ok');
  await press(s, TESTER, 'au:m:0');
  const c = ctxFor(TESTER, { text: '1-2' });
  assert.equal(await s.flow.text(c), true);
  await tick(20);
  assert.equal(String(checks(s).at(-1).file), 'merged');
  assert.match(allText(c), /tayyor/);
  assert.match(allText(c), /Xulosa/);
  assert.match(allText(c), /\(birlashtirildi\)/);
  await press(s, TESTER, 'au:go');
  await tick(20);
  assert.equal(String(imports(s)[0].file), 'merged');
  assert.equal(imports(s)[0].okOnly, false);
});

test('merge that still has errors shows the same item again', async () => {
  const s = setup({ maxItems: 1, check: () => checked(6, 1) });
  await start(s);
  await press(s, TESTER, 'au:ok');
  await press(s, TESTER, 'au:m:0');
  const c = ctxFor(TESTER, { text: '1-2' });
  await s.flow.text(c);
  await tick(20);
  assert.match(allText(c), /Hali 1 ta qator xato/);
  assert.match(allText(c), /1\/1<\/b> · 4-A · Математика/);
  assert.doesNotMatch(allText(c), /Xulosa/);
});

test('out-of-order buttons are refused', async () => {
  const s = setup({ check: () => checked(6, 1) });
  await start(s);
  assert.equal((await press(s, TESTER, 'au:go')).replies.at(-1).text, t('uz', 'session_end'));
  await press(s, TESTER, 'au:ok');
  assert.equal((await press(s, TESTER, 'au:k:5')).replies.at(-1).text, t('uz', 'session_end'));
  await press(s, TESTER, 'au:k:0');
  assert.equal((await press(s, TESTER, 'au:k:0')).replies.at(-1).text, t('uz', 'session_end'));
});

test('import that hits errors again (eMaktab changed) reports it with a retry hint', async () => {
  const s = setup({ maxItems: 1, importOne: async job => (job.checkOnly ? checked(7) : { state: 'needs_choice', rows: rowsOf(6, 1), imported: 0 }) });
  await start(s);
  await press(s, TESTER, 'au:ok');
  const c = await press(s, TESTER, 'au:go');
  await tick(20);
  assert.match(allText(c), /o'zgargan.*\/auto/);
});

test('no selected items → auto_none', async () => {
  const s = setup({ noPlan: () => true });
  await start(s);
  const c = await press(s, TESTER, 'au:ok');
  assert.equal(c.replies.at(-1).text, t('uz', 'auto_none'));
});

// ---- guruh, til ----
test('subgroup change re-checks that item and the import uses it', async () => {
  const s = setup({ maxItems: 1 });
  await start(s);
  await press(s, TESTER, 'au:g');
  const c = ctxFor(TESTER, { text: '1' });
  assert.equal(await s.flow.text(c), true);
  assert.ok(buttons(c.replies.at(-1)).some(b => b.callback_data === 'au:gs:0:1'));
  await press(s, TESTER, 'au:gs:0:1');
  await tick();
  assert.equal(checks(s).at(-1).subgroupId, 'sg1');
  await press(s, TESTER, 'au:ok');
  await press(s, TESTER, 'au:go');
  await tick(20);
  assert.equal(imports(s)[0].subgroupId, 'sg1');
});

test('language "both" shows per-class toggles that switch medium and re-check', async () => {
  const s = setup({ prefs: { medium: 'both' } });
  const c = await start(s);
  assert.ok(data(c).includes('au:md:1'));
  await press(s, TESTER, 'au:md:1');
  const last = s.calls.findPlan.slice(-3);
  assert.equal(last.find(k => k.grade === 7).medium, 'ru');
  assert.equal(last.find(k => k.grade === 4).medium, 'uz');
});

// ---- sessiya ----
test('session expired during the check: one re-login then continue', async () => {
  let n = 0;
  const s = setup({ importOne: async job => { if (++n === 1) throw Object.assign(new Error('x'), { code: 'SESSION_EXPIRED' }); return job.checkOnly ? checked(7) : { state: 'done', imported: 7, rows: [] }; } });
  const c = await start(s);
  assert.equal(s.calls.logins, 1);
  assert.match(lastWithButtons(c).text, /✅ tayyor/);
});

test('a re-login needing 2FA is tried once; items show the retry hint', async () => {
  const twofa = Object.assign(new Error('TWO_FA'), { es: { close: async () => {} } });
  const s = setup({ loginError: twofa, importOne: async () => { throw Object.assign(new Error('x'), { code: 'SESSION_EXPIRED' }); } });
  const c = await start(s);
  assert.equal(s.calls.logins, 1);
  const list = lastWithButtons(c).text;
  assert.equal((list.match(/\/auto/g) || []).length, 3);
});

// ---- holat ----
test('stale button without state → session_end; cancel clears state', async () => {
  const s = setup();
  assert.equal((await press(s, TESTER, 'au:ok')).replies.at(-1).text, t('uz', 'session_end'));
  await start(s);
  await press(s, TESTER, 'au:x');
  assert.equal((await press(s, TESTER, 'au:ok')).replies.at(-1).text, t('uz', 'session_end'));
});

test('allowed/wants are synchronous; a pending prompt expires and can be cleared', async () => {
  let clock = new Date('2026-11-14T10:00:00Z');
  const s = setup({ now: () => clock });
  assert.equal(s.flow.allowed(TESTER), true);
  assert.equal(s.flow.allowed(OTHER), false);
  await start(s);
  await press(s, TESTER, 'au:g');
  assert.equal(s.flow.wants(TESTER), true);
  s.flow.clearWait(TESTER);
  assert.equal(s.flow.wants(TESTER), false);
  await press(s, TESTER, 'au:g');
  clock = new Date('2026-11-14T10:11:00Z');
  assert.equal(s.flow.wants(TESTER), false);
});

test('a queued check says it is waiting', async () => {
  const releases = [];
  const runner = createRunner({ concurrency: 1, log: () => {} });
  const s = setup({ runner, maxItems: 1, importOne: () => new Promise(r => releases.push(() => r(checked(7)))) });
  await start(s, ADMIN);
  const c = await start(s, TESTER);
  assert.ok(allText(c).includes(t('uz', 'auto_prog_queue')));
  for (let k = 0; k < 8; k++) { releases.shift()?.(); await tick(); }
});

test('long lists are split under the Telegram limit', async () => {
  const classes = Array.from({ length: 60 }, (_, k) => ({ groupId: `g${k}`, className: `4-${k} ${'y'.repeat(70)}`, subjects: [{ id: `s${k}`, name: 'Математика' }] }));
  const s = setup({ maxItems: 60, classes: { school: '1', periodId: 'p2', classes } });
  const c0 = await start(s);
  await tick(80);
  const c1 = await press(s, TESTER, 'au:ok');
  const c2 = await press(s, TESTER, 'au:go');
  await tick(120);
  assert.equal(imports(s).length, 60);
  for (const r of [...c0.replies, ...c1.replies, ...c2.replies]) assert.ok((r.text || '').length <= 4096, `len ${r.text?.length}`);
  assert.ok(s.calls.admin[0].length <= 4000);
});

test('an unclear eMaktab answer is reported to the admin with snippets', async () => {
  const s = setup({ maxItems: 1, importOne: async job => (job.checkOnly ? checked(7) : { state: 'done', imported: 7, rows: [], result: { ok: null, text: 'x', snippets: ['Данные сохранены'], backAtStep1: true, url: '/v2/journals/planning/import' } }) });
  await start(s);
  await press(s, TESTER, 'au:ok');
  await press(s, TESTER, 'au:go');
  await tick(20);
  assert.match(s.calls.admin.at(-1), /Данные сохранены/);
  assert.match(s.calls.admin.at(-1), /planning\/import/);
});
