# Rejalar bazasi dashboardi — amalga oshirish rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin uchun brauzerda ishlaydigan rejalar bazasi dashboardi (ro'yxat, qamrov, ommaviy yuklash), botdagi `/panel` orqali kirish bilan.

**Architecture:** Mavjud Node HTTP server (`bot.js`, `PORT`) avval `dashboard.handle(req, res)` ni chaqiradi. Dashboard mantiqi `dashboard/` papkasida, sof (DB'siz) modullarga bo'lingan; DB, Telegram va Excel bog'liqliklari `createDashboard(deps)` ga tashqaridan beriladi — shuning uchun testlar soxta bog'liqliklar bilan ishlaydi. Interfeys — bitta `dashboard/index.html` (vanilla JS).

**Tech Stack:** Node 22 (ESM), grammy, pg, exceljs, `node:test`, `node:http`. Yangi npm paket yo'q.

**Spec:** `docs/superpowers/specs/2026-11-10-plans-dashboard-design.md`

## Global Constraints

- CLAUDE.md: `BOT_TOKEN` va `ENC_KEY` ga tegilmaydi; `DROP TABLE`, `TRUNCATE`, `DELETE` yozilmaydi; migratsiya faqat `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; mavjud ustun o'chirilmaydi/nomi o'zgarmaydi; production bazaga test ma'lumot yozilmaydi.
- Yangi npm paket qo'shilmaydi (`dependencies` ham, `devDependencies` ham).
- Kirish: token 32 bayt hex, 10 daqiqa, bir martalik; sessiya cookie `sid`, 32 bayt hex, `HttpOnly; Secure; SameSite=Lax; Path=/`, 7 kun.
- `/panel` faqat `ctx.from.id === ADMIN_ID` uchun; boshqalarga javob yo'q.
- Qiymatlar: sinf 1–11, chorak 1–4, til `uz|ru`, baholash `normal|bsb`, yil `YYYY/YYYY` (ikkinchi yil = birinchi + 1), fan — mavjud fan kalitlaridan biri.
- Fayl: faqat `.xls`/`.xlsx`, ≤ 5 000 000 bayt.
- Fayllar `PLANS_CHAT_ID || ADMIN_ID` chatiga `disable_notification: true` bilan yuboriladi.
- Ro'yxat sahifasi: 50 ta.
- POST so'rovlarda `Origin` = `https://${RAILWAY_PUBLIC_DOMAIN}` bo'lishi shart, aks holda `403`.
- Server xatolari logga `[panel]` prefiksi bilan; foydalanuvchiga xom xato matni berilmaydi.
- Barcha ishlar `feature/plans-dashboard` branchida; `main` ga push qilinmaydi.

## Review Focus

1. Kirill/o'zbekcha fayl nomi (`6 кл Русский язык 2 четв.xlsx`, `o‘zbek`) — `X-File-Name` URL-kodlangan keladi, serverda to'g'ri dekodlanadi va Telegram'ga asl nomi bilan boradi. → Task 7 testi.
2. 5 MB dan katta fayl — server tanani oxirigacha xotiraga yig'maydi, `413` qaytaradi. → Task 7 testi.
3. Bir partiyada bir xil kalitli ikki qator — server ham (faqat UI emas) ikkalasini rad etadi. → Task 2 va Task 7 testlari.
4. Arxivdagi kalitga qayta yuklash — reja qaytadi (`archived_at = null`), takror qator yaratilmaydi. → Task 4 (SQL matni testi) va staging ro'yxati.
5. Sessiya partiya o'rtasida tugaydi — API `401` JSON qaytaradi (HTML emas), UI kiritilgan qatorlarni yo'qotmaydi. → Task 6 testi va Task 9 qadami.

---

## Fayllar tuzilishi

| Fayl | Vazifa |
|---|---|
| `dashboard/auth.js` (yangi) | token va sessiyalar, cookie o'qish/yozish |
| `dashboard/validate.js` (yangi) | kiruvchi qiymatlarni tekshirish, kalit, takrorlarni topish |
| `dashboard/coverage.js` (yangi) | qamrov jadvalini DB qatorlaridan yasash |
| `dashboard/telegram.js` (yangi) | `429` da qayta urinish |
| `dashboard/server.js` (yangi) | `createDashboard(deps)` — yo'llar |
| `dashboard/index.html` (yangi) | interfeys |
| `hints.js` | `guessSubject` shu yerga ko'chadi |
| `db.js` | `archived_at`, filtrlar, arxiv, qamrov, statistika |
| `bot.js` | `/panel`, HTTP ulanish, 🗑 → arxiv |
| `test/*.test.js` (yangi) | `node --test` |
| `package.json` | `"test": "node --test test/"` |

---

### Task 1: Test muhiti va `guessSubject` ni `hints.js` ga ko'chirish

**Files:**
- Modify: `package.json` (scripts)
- Modify: `hints.js` (oxiriga)
- Modify: `bot.js:1475-1484` (`guessSubject` o'chiriladi, import qilinadi)
- Test: `test/hints.test.js`

**Interfaces:**
- Produces: `guessSubject(fileName: string, keyOf?: (name: string) => string|null): string|null` — `hints.js` dan eksport.

- [ ] **Step 1: Failing test yozish** — `test/hints.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessSubject, parseFileName } from '../hints.js';

test('guessSubject: keyOf birinchi o\'rinda', () => {
  assert.equal(guessSubject('5_sinf_xyz.xlsx', () => 'custom'), 'custom');
});
test('guessSubject: keyOf null bo\'lsa lug\'atga tushadi', () => {
  assert.equal(guessSubject('@kanal 5 sinf Matematika 2 chorak.xlsx', () => null), 'math');
});
test('guessSubject: hech narsa topilmasa null', () => {
  assert.equal(guessSubject('qwerty.xlsx', () => null), null);
});
test('parseFileName: kirillcha sinf va chorak', () => {
  const h = parseFileName('6 кл Русский язык 2 четв.xlsx');
  assert.equal(h.grade, 6);
});
```

`'math'` — `subjects.js` dagi matematika kaliti (tekshirilgan).

- [ ] **Step 2: Ishga tushirish** — `npm test` → FAIL (`guessSubject` eksport qilinmagan; `test` skripti yo'q bo'lsa avval `package.json` ga `"test": "node --test test/"` qo'shing).

- [ ] **Step 3: Amalga oshirish** — `bot.js` dagi `guessSubject` tanasini `hints.js` ga ko'chiring; `admin.keyOfName` o'rniga `keyOf` parametri (standart `() => null`); ishlatilmaydigan `medium` parametri olib tashlanadi. `bot.js` da `import { ..., guessSubject } from './hints.js'` va chaqiruvlar `guessSubject(name, admin.keyOfName)` bo'ladi (`grep -n guessSubject bot.js` bilan hammasini toping).

- [ ] **Step 4: Tekshirish** — `npm test` → PASS; `node --check bot.js` → xatosiz.

- [ ] **Step 5: Commit**

```bash
git add package.json hints.js bot.js test/hints.test.js
git commit -m "refactor: move guessSubject to hints.js, add node:test"
```

---

### Task 2: Kiruvchi qiymatlarni tekshirish

**Files:**
- Create: `dashboard/validate.js`
- Test: `test/validate.test.js`

**Interfaces:**
- Produces:
  - `validatePlan(input: object, subjectKeys: Set<string>): { ok: true, value: Plan } | { ok: false, error: string }`
    — `Plan = { grade:number, subjectKey:string, quarter:number, year:string, medium:'uz'|'ru', grading:'normal'|'bsb', fileId:string, fileName:string, topics:number|null }`. Kirishda `subject` yoki `subjectKey` qabul qilinadi; `grade`/`quarter`/`topics` satr bo'lsa songa aylantiriladi; `grading` bo'sh bo'lsa `'normal'`.
  - `planKey(p: Plan): string` — `${grade}|${subjectKey}|${quarter}|${year}|${medium}|${grading}`.
  - `findDuplicates(rows: Plan[]): Set<number>` — kaliti takrorlangan barcha qatorlar indekslari.
  - `validateFilter(query: URLSearchParams, subjectKeys): { ok, value|error }` — filtrlar uchun (hammasi ixtiyoriy, bor bo'lsa xuddi shu qoidalar; `page` ≥ 1, standart 1; `archived` `'1'` → `true`).

- [ ] **Step 1: Failing test** — asosiy tasdiqlar:

```js
const S = new Set(['math', 'history']);
const good = { grade: '5', subject: 'math', quarter: 2, year: '2026/2027', medium: 'uz', fileId: 'F', fileName: 'a.xlsx', topics: '34' };
assert.deepEqual(validatePlan(good, S), { ok: true, value: { grade: 5, subjectKey: 'math', quarter: 2, year: '2026/2027', medium: 'uz', grading: 'normal', fileId: 'F', fileName: 'a.xlsx', topics: 34 } });
for (const bad of [{ grade: 0 }, { grade: 12 }, { quarter: 5 }, { medium: 'en' }, { grading: 'x' }, { year: '2026/2028' }, { year: '2026' }, { subject: 'nope' }, { fileId: '' }])
  assert.equal(validatePlan({ ...good, ...bad }, S).ok, false);
const v = validatePlan(good, S).value;
assert.deepEqual([...findDuplicates([v, { ...v, grade: 6 }, v])], [0, 2]);
```

- [ ] **Step 2:** `npm test` → FAIL (modul yo'q).
- [ ] **Step 3:** `dashboard/validate.js` ni yozing. Xato matnlari o'zbekcha va qisqa (masalan `"Sinf 1–11 oralig'ida bo'lishi kerak"`).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add dashboard/validate.js test/validate.test.js && git commit -m "feat(panel): input validation and duplicate detection"`

---

### Task 3: Token va sessiyalar

**Files:**
- Create: `dashboard/auth.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Produces:
  - `createAuth({ now = Date.now, tokenTtl = 600_000, sessionTtl = 604_800_000 } = {})` →
    `{ issueToken(): string, redeem(token: string): string|null /* sid */, check(sid: string|undefined): boolean, logout(sid): void }`
  - `parseCookies(header: string|undefined): Record<string,string>`
  - `sessionCookie(sid: string, maxAgeSec: number): string` — `sid=<sid>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<n>`; `maxAgeSec=0` logout uchun.
- Tasodifiylik: `crypto.randomBytes(32).toString('hex')`. Eskirgan yozuvlar `issueToken`/`redeem` chaqirilganda tozalanadi.

- [ ] **Step 1: Failing test** — soxta soat bilan:

```js
let t = 0; const a = createAuth({ now: () => t });
const tok = a.issueToken(); assert.match(tok, /^[0-9a-f]{64}$/);
const sid = a.redeem(tok); assert.match(sid, /^[0-9a-f]{64}$/);
assert.equal(a.redeem(tok), null);                 // bir martalik
t = 0; const tok2 = a.issueToken(); t = 600_001; assert.equal(a.redeem(tok2), null); // 10 daqiqa
assert.equal(a.check(sid), true); t = 604_800_001; assert.equal(a.check(sid), false); // 7 kun
t = 0; const s2 = a.redeem(a.issueToken()); a.logout(s2); assert.equal(a.check(s2), false);
assert.equal(a.check(undefined), false);
assert.deepEqual(parseCookies('a=1; sid=abc'), { a: '1', sid: 'abc' });
assert.match(sessionCookie('x', 60), /HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=60/);
```

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** `dashboard/auth.js` ni yozing (ikki `Map`: token → muddat, sid → muddat).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(panel): one-time login tokens and sessions"`

---

### Task 4: Baza — arxiv, filtrlar, qamrov, statistika; botdagi 🗑 → arxiv

**Files:**
- Modify: `db.js` (`SCHEMA`, `savePlan`, `gradingVariants`, `planYears`, `planExists`, `listPlans`, `countPlans`, `planStats`, `deletePlan`)
- Modify: `bot.js:1368-1380` (`pd`/`pdy`)
- Modify: `admin.js:422` (tugma matni)
- Test: `test/db-sql.test.js`

**Interfaces:**
- Produces (hammasi `db.js` dan):
  - `buildPlanFilter(f: { medium?, quarter?, year?, grade?, grading?, subjectKey?, q?, archived?: boolean }): { where: string, args: any[] }` — sof funksiya. `archived` true bo'lsa `archived_at is not null`, aks holda `archived_at is null` (har doim qo'shiladi). `q` — `(file_name ilike $n or subject_key ilike $n)`, qiymat `%q%`.
  - `listPlans(offset, limit, filter)` — `buildPlanFilter` dan foydalanadi; qaytish shakli o'zgarmaydi `{ rows, total }`.
  - `archivePlan(id: number): Promise<boolean>`, `restorePlan(id: number): Promise<boolean>` — o'zgargan qator bo'lsa `true`.
  - `planForPanel(id: number): Promise<Plan row|null>` — arxivlangan bo'lsa ham qaytaradi.
  - `findPlanByKey(p: Plan): Promise<{ id:number, archived:boolean }|null>`
  - `coverageRows({ medium, grading }): Promise<{ id, grade, subject_key, quarter, year, topics }[]>` — arxivlanmaganlar.
  - `panelCounts({ year, quarter, medium }): Promise<{ total:number, inQuarter:number, archived:number }>`
  - `savePlan` imzosi va qaytishi o'zgarmaydi; `on conflict ... do update set` ga `archived_at = null` qo'shiladi.
- `deletePlan` olib tashlanadi; `bot.js` `pdy` → `db.archivePlan`, matn `🗄 Arxivlandi.`; `pd` savoli `🗄 Rejani arxivlaymizmi?`; `admin.js:422` tugmasi `🗄 Arxivlash`.

- [ ] **Step 1: Failing test** — `buildPlanFilter` (DB kerak emas):

```js
assert.deepEqual(buildPlanFilter({}), { where: 'where archived_at is null', args: [] });
const r = buildPlanFilter({ medium: 'uz', grade: 5, q: 'mat', archived: true });
assert.equal(r.where, 'where medium = $1 and grade = $2 and (file_name ilike $3 or subject_key ilike $3) and archived_at is not null');
assert.deepEqual(r.args, ['uz', 5, '%mat%']);
assert.match(SCHEMA, /alter table plans add column if not exists archived_at timestamptz;/);
assert.doesNotMatch(SCHEMA.split('archived_at')[1] ?? '', /\b(drop table|truncate|delete from)\b/i);
```

Filtrlar tartibi: `medium, quarter, year, grade, grading, subjectKey, q`, keyin `archived`.
Test faylida `db.js` ni import qilishdan oldin `process.env.DATABASE_URL ||= 'postgres://x@localhost/none'` qo'ying (Pool ulanmaydi, so'rov yuborilmaydi).

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** `db.js` o'zgarishlarini kiriting. `gradingVariants`, `planYears`, `planExists`, `countPlans`, `planStats` so'rovlariga `archived_at is null` qo'shing. `bot.js` va `admin.js` dagi matnlarni o'zgartiring. Keyin `grep -n "deletePlan\|delete from plans" *.js` → natija bo'sh.
- [ ] **Step 4:** `npm test` → PASS; `node --check db.js bot.js admin.js` → xatosiz.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): archive plans instead of deleting, panel queries"`

---

### Task 5: Qamrov jadvali

**Files:**
- Create: `dashboard/coverage.js`
- Test: `test/coverage.test.js`

**Interfaces:**
- Consumes: `coverageRows` qatorlari (Task 4).
- Produces: `buildCoverage(rows, { year: string, quarter: number }): { grades: number[] /* 1..11 */, subjects: string[] /* kalitlar, tartiblangan */, cells: Record<string, { state:'ok', id:number, topics:number|null } | { state:'missing' }>, missing: number }` — kalit `${grade}|${subjectKey}`. Juftlik `rows` da (istalgan yil/chorak) bo'lsa — kutiladi; tanlangan yil+chorakda bo'lsa `ok`, aks holda `missing`. `rows` da yo'q juftlik `cells` da umuman bo'lmaydi (o'qitilmaydi).

- [ ] **Step 1: Failing test:**

```js
const rows = [
  { id: 1, grade: 5, subject_key: 'math', quarter: 2, year: '2026/2027', topics: 34 },
  { id: 2, grade: 5, subject_key: 'history', quarter: 1, year: '2026/2027', topics: 10 },
  { id: 3, grade: 7, subject_key: 'math', quarter: 2, year: '2025/2026', topics: 30 },
];
const c = buildCoverage(rows, { year: '2026/2027', quarter: 2 });
assert.deepEqual(c.cells['5|math'], { state: 'ok', id: 1, topics: 34 });
assert.deepEqual(c.cells['5|history'], { state: 'missing' });
assert.deepEqual(c.cells['7|math'], { state: 'missing' });
assert.equal(c.cells['6|math'], undefined);
assert.equal(c.missing, 2);
assert.deepEqual(c.grades, [1,2,3,4,5,6,7,8,9,10,11]);
```

- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** yozing. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(panel): coverage grid builder"`

---

### Task 6: Dashboard serveri — kirish va o'qish yo'llari

**Files:**
- Create: `dashboard/server.js`
- Test: `test/server-read.test.js`

**Interfaces:**
- Consumes: `createAuth`, `parseCookies`, `sessionCookie` (Task 3); `validateFilter`, `validatePlan`, `planKey` (Task 2); `buildCoverage` (Task 5).
- Produces: `createDashboard(deps) → { handle(req, res): Promise<boolean>, issueLoginLink(): string }`.
  `deps`:
  ```
  { db: { listPlans, panelCounts, coverageRows, findPlanByKey, planForPanel, planYears,
          savePlan, archivePlan, restorePlan },
    subjects(): {key, uz, ru}[],         // admin.allSubjects
    keyOf(name): string|null,            // admin.keyOfName
    currentYear(): string,               // admin.currentYear
    readRows(path): Promise<{rows:{topic,hw}[]}>,
    sendDocument(buf: Buffer, fileName: string): Promise<string /* file_id */>,
    downloadFile(fileId: string): Promise<Buffer>,
    publicOrigin: string,                // `https://${RAILWAY_PUBLIC_DOMAIN}`
    htmlPath: string,                    // dashboard/index.html
    tmpDir: string,                      // '/tmp/emaktab'
    auth?: ReturnType<typeof createAuth>,
    log?: (...a) => void }
  ```
  `handle` faqat `/panel`, `/panel/*`, `/api/*` uchun `true` qaytaradi; qolganida `false` (bot.js qo'llanmani beradi).
  `issueLoginLink()` → `${publicOrigin}/panel/login?t=<token>`.
- Yo'llar va javob shakllari (bu task — o'qish):
  - `GET /panel/login?t=` → token to'g'ri: `302 Location: /panel` + `Set-Cookie`; noto'g'ri: `401` HTML "Havola eskirgan. Botga /panel yozing."
  - `POST /panel/logout` → `302 /panel` + `Max-Age=0` cookie.
  - `GET /panel` → sessiya bor: `htmlPath` fayli; yo'q: `401` HTML (yuqoridagi matn).
  - `/api/*` sessiyasiz → `401 {"error":"session"}`.
  - `GET /api/meta` → `{ subjects:[{key,uz,ru}], years:string[], currentYear }`
  - `GET /api/plans?…&page=` → `{ rows, total, page, pageSize: 50 }`
  - `GET /api/stats?year&quarter&medium&grading` → `{ total, inQuarter, missing, archived }` (`missing` — `buildCoverage` dan).
  - `GET /api/coverage?year&quarter&medium&grading` → `buildCoverage` natijasi + `names: Record<key,{uz,ru}>`.
  - `GET /api/plans/exists?grade&subject&quarter&year&medium&grading` → `{ exists:boolean, id:number|null, archived:boolean }`
  - `GET /api/plans/:id/topics` → `.xlsx`: `{ rows:[{n,topic,hw}] }`; `.xls`: `415 {"error":"xls"}`; yo'q: `404`.
  - `GET /api/plans/:id/file` → fayl, `Content-Disposition: attachment; filename*=UTF-8''<encoded>`.
  - Noto'g'ri filtr → `400 {"error":"<matn>"}`. Kutilmagan xato → `500 {"error":"server"}` va `log('[panel]', err)`.

- [ ] **Step 1: Failing test** — real `http.createServer` + `handle`, port 0, soxta `deps` (xotiradagi massivlar), Node `fetch` bilan:
  - `issueLoginLink()` dagi token bilan `/panel/login` → 302, `set-cookie` da `sid=`; shu token qayta → 401.
  - Cookie'siz `GET /api/meta` → 401 va `{"error":"session"}` (Review Focus 5).
  - Cookie bilan `GET /api/plans?grade=5` → 200, `pageSize === 50`, soxta `listPlans` `offset=0, limit=50` bilan chaqirilgan.
  - `GET /api/plans?grade=12` → 400.
  - `GET /` → `handle` `false` qaytaradi.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** yozing. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(panel): auth routes and read API"`

---

### Task 7: Dashboard serveri — yuklash va yozish yo'llari, Telegram qayta urinish

**Files:**
- Create: `dashboard/telegram.js`
- Modify: `dashboard/server.js`
- Test: `test/server-write.test.js`, `test/telegram.test.js`

**Interfaces:**
- Produces: `withRetry(fn: () => Promise<T>, { sleep = ms => new Promise(r => setTimeout(r, ms)), tries = 3 } = {}): Promise<T>` — xato `error_code === 429` bo'lsa `parameters.retry_after` soniya kutib qayta urinadi; boshqa xatoda darhol tashlaydi.
- Yo'llar (hammasi sessiya + `Origin === publicOrigin` talab qiladi, aks holda `403 {"error":"origin"}`):
  - `POST /api/files` — tana xom, `X-File-Name` URL-kodlangan. Kengaytma `.xls/.xlsx` emas → `415`. Tana 5 000 000 baytdan oshsa — o'qishni to'xtatib `413` (Review Focus 2). Javob: `{ fileId, fileName, topics: number|null, guess: { grade|null, subject|null, grading: 'bsb'|null, year: string|null, quarter: number|null } }`. `guess.year` — `parseFileName().year` bo'lsa `"YYYY/YYYY"`. `grading` — `admin.guessGrading` natijasi (`deps` ga `guessGrading` qo'shing). Vaqtinchalik fayl `finally` da o'chiriladi. `readRows` xatosi → `topics: null`, so'rov baribir muvaffaqiyatli.
  - `POST /api/plans/batch` `{ rows }` → har qator `validatePlan`; `findDuplicates` dagilar `skipped` ga `"Takror"` bilan; qolganlari `db.savePlan`. Javob `{ created, replaced, skipped:[{ index, error }] }` (`savePlan` natijasidagi `is_new` bo'yicha).
  - `POST /api/plans/:id/replace` `{ fileId, fileName, topics }` → mavjud reja kaliti bilan `savePlan` → `{ ok:true }`; yo'q → 404.
  - `POST /api/plans/:id/archive`, `/restore` → `{ ok: boolean }`.

- [ ] **Step 1: Failing testlar:**
  - `withRetry`: birinchi chaqiruv `{ error_code: 429, parameters: { retry_after: 2 } }` tashlaydi, ikkinchisi `'ok'` → natija `'ok'`, `sleep` `2000` bilan chaqirilgan; `{ error_code: 400 }` → darhol tashlaydi.
  - `X-File-Name: encodeURIComponent('6 кл Русский язык 2 четв.xlsx')` → soxta `sendDocument` aynan shu nom bilan chaqirilgan, `guess.grade === 6` (Review Focus 1).
  - 5 000 001 baytli tana → 413, `sendDocument` chaqirilmagan.
  - `.pdf` → 415.
  - Batch'da bir xil ikki qator + bitta boshqa → `skipped` da indeks 0 va 1, `savePlan` bir marta chaqirilgan (Review Focus 3).
  - `Origin: https://evil.example` bilan POST → 403.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** yozing. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(panel): upload, batch save, replace, archive API"`

---

### Task 8: `bot.js` ga ulash va `/panel` buyrug'i

**Files:**
- Modify: `bot.js` (importlar; `/panel` buyrug'i `bot.command('admin', …)` yonida; HTTP server `bot.js:1513-1539`)

**Interfaces:**
- Consumes: `createDashboard` (Task 6–7), `withRetry` (Task 7), `db.*` (Task 4), `admin.allSubjects`, `admin.keyOfName`, `admin.currentYear`, `admin.guessGrading`, `readRows`.

- [ ] **Step 1:** `createDashboard` ni yarating:
  - `sendDocument` → `withRetry(() => bot.api.sendDocument(Number(process.env.PLANS_CHAT_ID) || ADMIN_ID, new InputFile(buf, fileName), { disable_notification: true }))` → `msg.document.file_id`.
  - `downloadFile` → `bot.api.getFile` + `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file_path}` (mavjud usul bilan bir xil).
  - `publicOrigin` → `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`.
- [ ] **Step 2:** HTTP handler boshida: `if (await dash.handle(req, res)) return;`. `PORT` yo'q bo'lsa dashboard ishlamaydi (hozirgidek).
- [ ] **Step 3:** `bot.command('panel', …)` — `isAdmin` emas bo'lsa `return` (javobsiz). `RAILWAY_PUBLIC_DOMAIN` yo'q bo'lsa: `"Dashboard faqat Railway'da ishlaydi"`. Aks holda: `🔐 Dashboard: <link>\n10 daqiqa amal qiladi, bir marta ishlaydi.` (`link_preview_options: { is_disabled: true }`).
- [ ] **Step 4: Tekshirish** — `node --check bot.js` → xatosiz; `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(panel): wire dashboard into bot and add /panel"`

---

### Task 9: Interfeys — `dashboard/index.html`

**Files:**
- Create: `dashboard/index.html`

**Interfaces:**
- Consumes: Task 6–7 API shakllari.
- Maket: brainstorming'dagi 3 tab (Rejalar, Qamrov, Ommaviy yuklash). Ranglar `:root` tokenlarida, `prefers-color-scheme: dark` bilan. Tashqi skript/kutubxona yo'q.

- [ ] **Step 1: Rejalar tabi** — 4 raqam (`/api/stats`), filtrlar (qiymatlar URL `?` da, `history.replaceState`), jadval, 50 talik sahifalash, amallar: Ko'rish (modal, `/topics`; `415` → "ko'rish mumkin emas, yuklab oling"), Yuklab olish (`/file`), Almashtirish (fayl tanlash → `/api/files` → `/replace`), Arxivlash (`confirm`). "Arxiv" belgisi → `archived=1`, Qaytarish tugmasi.
- [ ] **Step 2: Qamrov tabi** — `/api/coverage`; `ok` yashil (mavzular soni), `missing` sariq "yo'q", katak yo'q → "·". `missing` bosilsa Ommaviy yuklash tabi shu yil/chorak/til/baholash bilan ochiladi va keyingi fayl qatoriga sinf/fan oldindan qo'yiladi.
- [ ] **Step 3: Ommaviy yuklash tabi** — standart qiymatlar (yil — `meta.currentYear`); drag-and-drop + tanlash; kengaytma/hajm brauzerda ham tekshiriladi; fayllar **bittadan ketma-ket** `/api/files` ga (`X-File-Name: encodeURIComponent(name)`); `guess` qiymatlari qatorga, fayl nomidagi yil/chorak standartdan ustun; holatlar 🆕/🔄/⚠️/❌ (🔄 — `/exists` sinf/fan/BSB o'zgarganda qayta so'raladi); takror kalitlar ⚠️ "takror"; ❌ qatorda "Qayta urinish"; "N ta rejani saqlash" → `/batch`, natija xabari.
- [ ] **Step 4: Sessiya** — har qanday `401 {"error":"session"}` da sahifa yangilanmaydi, tepada banner: "Sessiya tugadi. Botga /panel yozing, so'ng shu sahifaga qayting." Kiritilgan jadval saqlanib qoladi (Review Focus 5).
- [ ] **Step 5: Tekshirish** — lokal: `PORT=8080 RAILWAY_PUBLIC_DOMAIN=localhost:8080` bilan ishlatib bo'lmaydi (bot token va DB kerak), shuning uchun haqiqiy tekshiruv Task 10 da. Bu yerda: HTML faylni brauzerda to'g'ridan-to'g'ri ochib, konsolda sintaksis xatosi yo'qligini tekshiring.
- [ ] **Step 6: Commit** — `git commit -m "feat(panel): dashboard UI"`

---

### Task 10: Staging muhiti va qo'lda tekshiruv

**Files:** yo'q (Railway sozlamasi). Bu task admin ishtirokini talab qiladi.

- [ ] **Step 1: Admin** BotFather'da yangi test bot yaratadi va tokenni beradi. Production `BOT_TOKEN` **ishlatilmaydi** — ikki jarayon bitta token bilan polling qilsa production bot buziladi.
- [ ] **Step 2:** Railway `stellar-surprise` loyihasida **bo'sh** `staging` muhiti yaratiladi — production'dan **nusxa olinmaydi** (nusxa `BOT_TOKEN` ni ham ko'chiradi). Unga yangi Postgres va `erpmaktab` servisi (repo `sirojiddinmuhammad/erpmaktab`, branch `feature/plans-dashboard`) qo'shiladi.
- [ ] **Step 3:** Staging o'zgaruvchilari: test `BOT_TOKEN`, staging Postgres `DATABASE_URL`, yangi `ENC_KEY` (`openssl rand -hex 32`), `ADMIN_ID` (adminning Telegram ID'si), staging domeni yaratiladi. `CARD_*`, narxlar — production qiymatlari shart emas.
- [ ] **Step 4:** Staging deploy `SUCCESS`, `GET /health` → `ok`.
- [ ] **Step 5: Qo'lda tekshiruv ro'yxati** (staging botida):
  - [ ] `/panel` boshqa akkauntdan — javob yo'q; admindan — havola keladi; havola ikkinchi marta — "eskirgan".
  - [ ] 30 ta fayl (kirillcha nomli ham) — hammasi yuklanadi, taxminlar to'g'ri, 5 daqiqadan kam.
  - [ ] Bir xil kalitli ikki fayl — ikkalasi "takror", saqlanmaydi.
  - [ ] Mavjud kalitga fayl — 🔄, saqlangandan keyin ro'yxatda yangi fayl.
  - [ ] Arxivlash → ro'yxatdan yo'qoladi, "Arxiv"da bor → Qaytarish ishlaydi.
  - [ ] Arxivdagi kalitga yangi fayl yuklash → reja qaytadi, takror qator yo'q.
  - [ ] Qamrov: yetishmaydigan katak bosilsa yuklash oldindan to'ldirilgan holda ochiladi.
  - [ ] Ko'rish (`.xlsx` mavzular), `.xls` uchun xabar; Yuklab olish asl nom bilan.
  - [ ] Botdagi "Rejalar bazasi" dashboard'da yuklangan rejani ko'radi; botdagi 🗄 Arxivlash ishlaydi.
  - [ ] Deploydan keyin sessiya tushadi, banner chiqadi, jadval yo'qolmaydi.
- [ ] **Step 6:** Natijalar adminga hisobot qilinadi. `main` ga merge faqat admin roziligi bilan.
