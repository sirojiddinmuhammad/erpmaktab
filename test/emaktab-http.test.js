import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { createEmaktabHttp, cookiesFromState } from '../emaktab-http.js';
import { readHeaderRow } from '../xlsx.js';

const fx = n => fs.readFileSync(new URL(`./fixtures/emaktab/${n}`, import.meta.url), 'utf8');
const IMPORT = 'https://schools.emaktab.uz/v2/journals/planning/import';

async function xlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach(r => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const plan = () => xlsx([['№', 'Тема урока', 'Домашнее задание'], [1, 'Mavzu 1', 'Vazifa 1']]);

// Soxta eMaktab: so'rovlarni yozib boradi, bosqichga qarab fixture qaytaradi
function fakeEmaktab({ step3 = 'import-step3-ready.html', final = '<html><body>Импорт завершён</body></html>', first = null } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const body = opts.body;
    const form = body instanceof URLSearchParams ? body : body instanceof FormData ? body : null;
    calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: form, signal: opts.signal });
    if (first && calls.length === 1) return first();
    const u = String(url);
    if (u.includes('/v2/myclasses')) return new Response(fx('myclasses.html'));
    if (u.includes('getsubgroups-cmd')) return new Response(fx('getsubgroups.json'));
    if (u.includes('getperiods-cmd')) return new Response(fx('getperiods.json'));
    if (u.startsWith(IMPORT) && (opts.method || 'GET') === 'GET')
      return new Response(fx('import-step1.html'), { headers: { 'set-cookie': 'fresh=1; Path=/; Domain=.emaktab.uz' } });
    if (form?.has('step1')) return new Response(fx('import-step2.html'));
    // haqiqiy eMaktab tanlangan guruhni 3-qadamga qaytaradi
    if (form?.has('step2')) return new Response(fx(step3).replace('name="subgroup" value="0"', `name="subgroup" value="${form.get('subgroup') || '0'}"`));
    if (form?.has('step3')) return new Response(final);
    return new Response('?', { status: 404 });
  };
  return { fetch, calls };
}
const cookies = [{ name: 'auth', value: 'a1', domain: '.emaktab.uz', path: '/' }];
const job = async (over = {}) => ({
  file: await plan(), fileName: 'reja.xlsx', year: '2026', school: '1000000000001',
  groupId: '2514332234414922860', subjectId: '1984492252597963094', periodId: '2530691816384972571', ...over,
});

test('cookiesFromState keeps only eMaktab cookies', () => {
  const c = cookiesFromState({ cookies: [
    { name: 'a', value: '1', domain: 'login.emaktab.uz', path: '/' },
    { name: 'b', value: '2', domain: '.schools.emaktab.uz', path: '/' },
    { name: 'g', value: '3', domain: '.google.com', path: '/' }] });
  assert.deepEqual(c.map(x => x.name), ['a', 'b']);
  assert.deepEqual(cookiesFromState(null), []);
});

test('readHeaderRow returns the first row texts', async () => {
  assert.deepEqual(await readHeaderRow(await plan()), ['№', 'Тема урока', 'Домашнее задание']);
});

test('every request carries cookies, a timeout signal, and keeps set-cookie', async () => {
  const fe = fakeEmaktab();
  const em = createEmaktabHttp({ cookies, fetch: fe.fetch });
  await em.importOne(await job());
  for (const c of fe.calls) {
    assert.match(c.headers.cookie, /auth=a1/);
    assert.ok(c.signal, 'signal');
  }
  assert.match(fe.calls.at(-1).headers.cookie, /fresh=1/);
});

test('importOne with all rows ready runs steps 1→2→3 and imports', async () => {
  const fe = fakeEmaktab();
  const em = createEmaktabHttp({ cookies, fetch: fe.fetch });
  const r = await em.importOne(await job());
  assert.equal(r.state, 'done');
  assert.equal(r.imported, 6);
  const [g, s1, s2, s3] = fe.calls;
  assert.equal(g.method, 'GET');
  assert.ok(s1.body instanceof FormData);
  assert.equal(s1.body.get('__RequestVerificationToken'), 'XXX');
  assert.equal(s1.body.get('group'), '2514332234414922860');
  assert.equal(s1.body.get('subject'), '1984492252597963094');
  assert.equal(s1.body.get('period'), '2530691816384972571');
  assert.equal(s1.body.get('firstRow'), '0');
  assert.equal(s1.body.get('sourceType'), 'File');
  assert.ok(s1.body.get('multifile1') instanceof Blob);
  assert.ok(s2.body instanceof URLSearchParams);
  assert.match(s2.body.get('file'), /^storage:\/\/\//);
  assert.equal(s2.body.get('subgroup'), '');
  assert.deepEqual(['select_0', 'select_1', 'select_2'].map(k => s2.body.get(k)), ['0', '1', '2']);
  assert.equal(s2.body.has('step2'), true);
  assert.equal(s3.body.get('step3'), 'Импортировать >');
  assert.equal(s3.body.getAll('select').length, 6);
  assert.ok(s3.body.getAll('select').every(v => /^\d+=1$/.test(v)));
  assert.equal(s3.body.get('lessonTopic'), '1');
});

test('importOne with error rows stops before step 3', async () => {
  const fe = fakeEmaktab({ step3: 'import-step3-errors.html' });
  const r = await createEmaktabHttp({ cookies, fetch: fe.fetch }).importOne(await job());
  assert.equal(r.state, 'needs_choice');
  assert.equal(r.rows.filter(x => !x.ok).length, 4);
  assert.equal(fe.calls.some(c => c.body?.has?.('step3')), false);
});

test('importOne okOnly imports ready rows and skips error rows', async () => {
  const fe = fakeEmaktab({ step3: 'import-step3-errors.html' });
  const r = await createEmaktabHttp({ cookies, fetch: fe.fetch }).importOne(await job({ okOnly: true }));
  assert.equal(r.state, 'done');
  assert.equal(r.imported, 6);
  const sel = fe.calls.at(-1).body.getAll('select');
  assert.equal(sel.filter(v => v.endsWith('=1')).length, 6);
  assert.equal(sel.filter(v => v === '0=0').length, 4);
});

test('importOne passes the chosen subgroup', async () => {
  const fe = fakeEmaktab();
  await createEmaktabHttp({ cookies, fetch: fe.fetch }).importOne(await job({ subgroupId: '2514332234414922861' }));
  assert.equal(fe.calls[1].body.get('subgroup'), '2514332234414922861');
  assert.equal(fe.calls[2].body.get('subgroup'), '2514332234414922861');
});

test('a redirect to login raises SESSION_EXPIRED', async () => {
  const fe = fakeEmaktab({ first: () => new Response('', { status: 302, headers: { location: 'https://login.emaktab.uz/?ReturnUrl=%2Fv2' } }) });
  await assert.rejects(createEmaktabHttp({ cookies, fetch: fe.fetch }).importOne(await job()), e => e.code === 'SESSION_EXPIRED');
});

test('a maintenance page raises MAINTENANCE', async () => {
  const fe = fakeEmaktab({ first: () => new Response('<h1>Ведутся технические работы</h1>', { status: 503 }) });
  await assert.rejects(createEmaktabHttp({ cookies, fetch: fe.fetch }).importOne(await job()), e => e.code === 'MAINTENANCE');
});

test('an unexpected step 2 page raises EMAKTAB_UNEXPECTED with a short reason', async () => {
  const fetch = async (url, opts = {}) => (opts.method === 'POST'
    ? new Response('<html><body><p>Файл не поддерживается</p></body></html>')
    : new Response(fx('import-step1.html')));
  await assert.rejects(createEmaktabHttp({ cookies, fetch }).importOne(await job()),
    e => e.code === 'EMAKTAB_UNEXPECTED' && /не поддерживается/.test(e.message));
});

test('a final page that is still the review page counts as failed', async () => {
  const fe = fakeEmaktab({ final: fx('import-step3-ready.html') });
  const r = await createEmaktabHttp({ cookies, fetch: fe.fetch }).importOne(await job());
  assert.equal(r.state, 'failed');
});

test('listClassSubjects, subgroups and periods', async () => {
  const fe = fakeEmaktab();
  const em = createEmaktabHttp({ cookies, fetch: fe.fetch });
  const l = await em.listClassSubjects();
  assert.equal(l.classes.length, 3);
  const sg = await em.subgroups('2514332234414922860');
  assert.deepEqual(sg[0], { id: '', name: 'Весь класс' });
  assert.equal(sg.length, 3);
  const p = await em.periods('2514332234414922860');
  assert.deepEqual(p.find(x => x.n === 2), { id: '2530691816384972571', name: '2 четверть', n: 2 });
});

// ---- yakuniy tekshiruv tuzatishlari ----
test('FIX3: step 3 is not sent when eMaktab changed the class, subject or quarter', async () => {
  const changed = fx('import-step3-ready.html').replace('name="period" value="2530691816384972571"', 'name="period" value="2530691816384972572"');
  const fetch = async (url, opts = {}) => {
    const b = opts.body;
    if (b instanceof FormData) return new Response(fx('import-step2.html'));
    if (b instanceof URLSearchParams && b.has('step2')) return new Response(changed);
    if (b instanceof URLSearchParams && b.has('step3')) throw new Error('step3 must not be sent');
    return new Response(fx('import-step1.html'));
  };
  await assert.rejects(createEmaktabHttp({ cookies, fetch }).importOne(await job()),
    e => e.code === 'EMAKTAB_UNEXPECTED' && /period/.test(e.message));
});

test('FIX6: a plan without a header row is sent with firstRow=1 (first row is data)', async () => {
  const fe = fakeEmaktab();
  const file = await xlsx([[1, 'Mavzu 1', 'Vazifa 1'], [2, 'Mavzu 2', 'Vazifa 2']]);
  await createEmaktabHttp({ cookies, fetch: fe.fetch }).importOne(await job({ file }));
  assert.equal(fe.calls[1].body.get('firstRow'), '1');
});

test('FIX7: fewer review rows than plan rows (paging) is not reported as imported', async () => {
  const fe = fakeEmaktab();
  const file = await xlsx([['№', 'Тема урока', 'Домашнее задание'], ...Array.from({ length: 10 }, (_, k) => [k + 1, `M${k}`, ''])]);
  const r = await createEmaktabHttp({ cookies, fetch: fe.fetch }).importOne(await job({ file }));
  assert.equal(r.state, 'failed');
  assert.match(r.error, /6\/10/);
  assert.equal(fe.calls.some(c => c.body?.has?.('step3')), false);
});

test('FIX8: cookies with the same name on different hosts are both kept', async () => {
  const seen = [];
  const fetch = async (url, opts = {}) => { seen.push([new URL(url).hostname, opts.headers.cookie]); return new Response(fx('myclasses.html')); };
  const em = createEmaktabHttp({ fetch, cookies: [
    { name: 'sid', value: 'school', domain: 'schools.emaktab.uz', path: '/' },
    { name: 'sid', value: 'login', domain: 'login.emaktab.uz', path: '/' }] });
  await em.listClassSubjects();
  assert.equal(seen[0][1], 'sid=school');
});

test('FIX8: a set-cookie with Max-Age=0 removes the cookie', async () => {
  let n = 0;
  const fetch = async (url, opts = {}) => {
    n++;
    if (n === 1) return new Response(fx('myclasses.html'), { headers: { 'set-cookie': 'auth=; Max-Age=0; Path=/; Domain=.emaktab.uz' } });
    assert.equal(opts.headers.cookie, '');
    return new Response(fx('myclasses.html'));
  };
  const em = createEmaktabHttp({ fetch, cookies });
  await em.listClassSubjects();
  await em.listClassSubjects();
});
