# Dashboard: kiruvchi fayllar, fanlar, rejim — amalga oshirish rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin kanaldan forward qilgan reja fayllarini dashboard'da qabul qilish, fanlarni dashboard'da boshqarish va kunduzgi/kechki rejim tugmasi.

**Architecture:** Bot forward qilingan faylni `plan_inbox` jadvaliga yozadi (qaror sof funksiya `inboxDecision` da). Dashboard serveri (`dashboard/server.js`) yangi `/api/inbox*` va `/api/subjects*` yo'llarini oladi; taxmin mantiqi `/api/files` bilan umumiy `guessFrom()` ga ajratiladi. Fanlar `subject_extra.archived_at` bilan yumshoq o'chiriladi. UI — mavjud `dashboard/index.html`.

**Tech Stack:** Node 22 ESM, grammy, pg, exceljs, `node:test`. Yangi npm paket yo'q.

**Spec:** `docs/superpowers/specs/2026-11-12-panel-inbox-subjects-theme-design.md`

## Global Constraints

- CLAUDE.md: `BOT_TOKEN`/`ENC_KEY` ga tegilmaydi; `DROP TABLE`, `TRUNCATE`, `DELETE` yozilmaydi (shu ish oxirida `grep -n "delete from" *.js dashboard/*.js` bo'sh); migratsiya faqat `create table if not exists`, `create index if not exists`, `alter table ... add column if not exists`.
- Yangi npm paket yo'q.
- Inbox faqat `ctx.from.id === ADMIN_ID`, faqat forward (`forward_origin` bor), faqat `.xls`/`.xlsx`.
- Takror: kutilayotganlar (`taken_at is null and dismissed_at is null`) orasida bir xil `file_unique_id`.
- Bot xulosa xabari so'nggi fayldan 3000 ms keyin: `📥 N ta fayl qabul qilindi (M ta takror). Dashboard → Ommaviy yuklash.` (M = 0 bo'lsa qavssiz).
- `take` ko'pi bilan 50 ta id; caption 1000 belgigacha saqlanadi.
- Fan tekshiruvi: `uz` 1–80 belgi majburiy; `ru` 0–80 (bo'sh → `uz`); `alias` ≤ 30 ta, har biri 1–80; kalit `^[a-z0-9а-яё-]{1,40}$`.
- Fan kaliti: `'x-' + uz.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 30)`; band bo'lsa `-2`, `-3`…
- Rejim: `localStorage['panel-theme']` = `light|dark`; `<html data-theme>`; saqlanmagan bo'lsa atribut yo'q.
- Barcha POST'lar mavjud sessiya + Origin tekshiruvidan o'tadi.

## Review Focus

1. Admin o'zining importi uchun fayl kutilayotganda forward qiladi — fayl importga ketadi, inbox'ga emas. → Task 2 testi.
2. Fan nomi bo'sh joy/emoji/faqat belgi (`"!!!"`) — kalit bo'sh qolmaydi, 400 qaytadi. → Task 1 va Task 5 testlari.
3. Arxivlangan fan bot tugmalarida va fayl nomidan taxminda chiqmaydi. → Task 1 (PGlite) va Task 5 testi (`reloadSubjects` chaqirilgan).
4. Inbox'dagi fayl Telegram'dan yuklab olinmaydi (eskirgan file_id) — o'sha qator xato bilan qaytadi, qolganlari olinadi, xatolisi inbox'da qoladi. → Task 4 testi.
5. Izohda HTML/`<script>` — UI da matn sifatida ko'rinadi. → Task 6 brauzer tekshiruvi.

## Fayllar

| Fayl | Vazifa |
|---|---|
| `db.js` | `plan_inbox`, inbox funksiyalari; `subject_extra.archived_at`, fan funksiyalari |
| `dashboard/inbox.js` (yangi) | `inboxDecision`, `quarterOfDate`, `schoolYearOfDate`, `createInboxNotifier` |
| `dashboard/subjects.js` (yangi) | `makeSubjectKey`, `validateSubject` |
| `dashboard/server.js` | `guessFrom`, `/api/inbox*`, `/api/subjects*` |
| `bot.js` | inbox ulanishi, `sdy` → `archiveSubject`, deps |
| `dashboard/index.html` | inbox bloki, Fanlar tabi, rejim tugmasi |

---

### Task 1: Baza — inbox va fanlar arxivi

**Files:** Modify `db.js`, `bot.js` (`sdy` callback, ~1282), `admin.js` (fan kartochkasidagi 🗑 matni); Create `dashboard/subjects.js`; Test `test/db-sql.test.js`, `test/subjects.test.js`.

**Interfaces — Produces:**
- `db.SCHEMA` oxiriga spec 2.2 dagi `plan_inbox` jadvali va indeks, `alter table subject_extra add column if not exists archived_at timestamptz;`
- `db.addInbox({ fileId, fileUniqueId, fileName, fileSize, caption, source, postedAt: Date|null }): Promise<{ added: boolean }>` — bitta `insert ... select ... where not exists (kutilayotgan bir xil file_unique_id)`.
- `db.listInbox(limit = 200): Promise<{ id:number, file_id, file_name, caption, source, posted_at }[]>`, `db.getInbox(ids:number[])` (kutilayotganlar), `db.countInbox(): Promise<number>`, `db.markInbox(ids:number[], field:'taken_at'|'dismissed_at'): Promise<number>` (`field` oq ro'yxat bilan tekshiriladi).
- `db.extraSubjects()` — `where archived_at is null` qo'shiladi.
- `db.subjectsForPanel(): Promise<{ key, uz, ru, alias, plans:number, archived:boolean }[]>`
- `db.subjectKeyExists(key): Promise<boolean>` (arxivlangan ham hisoblanadi), `db.insertSubject({ key, uz, ru, alias }): Promise<void>` (to'qnashuvda xato — ustidan yozmaydi), `db.updateSubject` (mavjud), `db.archiveSubject(key, withPlans): Promise<boolean>`, `db.restoreSubject(key): Promise<boolean>`.
- `db.deleteSubject` olib tashlanadi; bot `sdy` → `db.archiveSubject(key, withPlans)`, javob `🗄 Arxivlandi.`; admin.js tugmasi `🗄 Arxivlash`.
- `dashboard/subjects.js`: `makeSubjectKey(uz: string, exists: (k) => Promise<boolean>): Promise<string|null>` (bo'sh slug → `null`); `validateSubject(body): { ok, value:{uz,ru,alias} } | { ok:false, error }`.

- [ ] **Step 1: Failing testlar.** `test/db-sql.test.js` ga: SCHEMA da `create table if not exists plan_inbox`, `subject_extra add column if not exists archived_at timestamptz`, va `SCHEMA.split('plan_inbox')[1]` da `drop table|truncate|delete from` yo'q. `test/subjects.test.js`:
  ```js
  const taken = new Set(['x-matematika', 'x-matematika-2']);
  assert.equal(await makeSubjectKey('Matematika', async k => taken.has(k)), 'x-matematika-3');
  assert.equal(await makeSubjectKey('Русский язык', async () => false), 'x-русский-язык');
  assert.equal(await makeSubjectKey('!!!', async () => false), null);
  assert.deepEqual(validateSubject({ uz: ' Fizika ', ru: '', alias: ['fiz', ' '] }), { ok: true, value: { uz: 'Fizika', ru: 'Fizika', alias: ['fiz'] } });
  for (const bad of [{ uz: '' }, { uz: 'a'.repeat(81) }, { uz: 'A', ru: 'b'.repeat(81) }, { uz: 'A', alias: Array(31).fill('x') }, { uz: 'A', alias: 'x' }])
    assert.equal(validateSubject(bad).ok, false);
  ```
- [ ] **Step 2:** `npm test` → yangi testlar FAIL.
- [ ] **Step 3:** Yuqoridagilarni yozing.
- [ ] **Step 4:** `npm test` → PASS; `node --check db.js bot.js admin.js`; `grep -n "delete from" *.js dashboard/*.js` → bo'sh.
- [ ] **Step 5: PGlite** — scratchpad'dagi `smoke.mjs` ga qo'shing va ishga tushiring: addInbox takror → `added:false`; markInbox taken → takror endi qo'shiladi; extraSubjects arxivlanganni ko'rsatmaydi; subjectsForPanel `plans` va `archived` to'g'ri; insertSubject to'qnashuvda tashlaydi. Kutilgan: `ALL OK`.
- [ ] **Step 6: Commit** — `feat(db): plan inbox table and soft-deleted subjects`

### Task 2: Inbox qarori, sana yordamchilari, xulosa xabari

**Files:** Create `dashboard/inbox.js`; Test `test/inbox.test.js`.

**Interfaces — Produces:**
- `inboxDecision(msg, { fromId, adminId, awaitingFile: boolean, bulkActive: boolean }): null | { fileId, fileUniqueId, fileName, fileSize, caption, source, postedAt: Date|null }`
- `quarterOfDate(d: Date): 1|2|3|4` (spec 2.3 qoidasi), `schoolYearOfDate(d: Date): string` (`'2026/2027'`, sentyabrdan yangi).
- `createInboxNotifier({ send: (text) => Promise, delayMs = 3000, setTimer = setTimeout, clearTimer = clearTimeout }) → { note(added: boolean): void }`

- [ ] **Step 1: Failing testlar** — `msg = { document: { file_id:'F', file_unique_id:'U', file_name:'5 sinf.xlsx', file_size: 10 }, caption: 'Matematika', forward_origin: { type:'channel', chat:{ title:'Rejalar' }, date: 1794200000 } }`:
  - admin, forward, `.xlsx` → obyekt, `source === 'Rejalar'`, `postedAt` = `new Date(1794200000 * 1000)`;
  - `fromId !== adminId` → `null`; `forward_origin` yo'q → `null`; `.pdf` → `null`; `awaitingFile: true` → `null`; `bulkActive: true` → `null`; caption 1500 belgi → 1000 ga qisqaradi; `forward_origin.type === 'hidden_user'` → `source === sender_user_name`.
  - `quarterOfDate`: 2026-09-15→1, 2026-11-07→1, 2026-11-09→2, 2026-12-20→2, 2027-02-01→3, 2027-04-10→4, 2027-07-01→1. `schoolYearOfDate(2026-11-09) === '2026/2027'`, `(2027-03-01) === '2026/2027'`, `(2027-09-01) === '2027/2028'`.
  - notifier soxta taymer bilan: `note(true)`×3, `note(false)` → taymer bitta qolgan; ishga tushganda `send('📥 3 ta fayl qabul qilindi (1 ta takror). Dashboard → Ommaviy yuklash.')`; keyingi `note(true)` → `'📥 1 ta fayl qabul qilindi. Dashboard → Ommaviy yuklash.'`
- [ ] **Step 2:** FAIL. **Step 3:** yozing. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(panel): inbox decision, date helpers, summary notifier`

### Task 3: Botga ulash

**Files:** Modify `bot.js` (`message:document` handler, ~708).

**Interfaces — Consumes:** Task 1 `db.addInbox`, Task 2 `inboxDecision`, `createInboxNotifier`.

- [ ] **Step 1:** Handler'da bulk shartidan keyin, `const s = live.get(id)` dan keyin va `if (!s || s.step !== 'await_file') return;` dan **oldin**: `const rec = inboxDecision(ctx.message, { fromId: id, adminId: ADMIN_ID, awaitingFile: s?.step === 'await_file', bulkActive: af?.kind === 'bulk' })`; bor bo'lsa `try { notifier.note((await db.addInbox(rec)).added) } catch (e) { console.error('[inbox]', e) } return;`. Notifier `send` → `bot.api.sendMessage(ADMIN_ID, text)`.
- [ ] **Step 2:** `node --check bot.js`; `npm test` → PASS.
- [ ] **Step 3: Commit** — `feat(bot): put admin-forwarded plan files into the inbox`

### Task 4: Inbox API va umumiy taxmin

**Files:** Modify `dashboard/server.js`; Test `test/server-inbox.test.js`; `test/helpers.js` (soxta `db` ga inbox funksiyalari).

**Interfaces:**
- Consumes: `db.listInbox`, `db.getInbox`, `db.countInbox`, `db.markInbox`; `quarterOfDate`, `schoolYearOfDate`.
- Produces: `guessFrom(text: string, fileName: string, { postedAt?: Date|null }) → { grade, subject, grading, year, quarter }` (server.js ichida; `/api/files` ham shuni ishlatadi, javobi o'zgarmaydi). Yo'llar spec 2.3 jadvalidagidek; `take` javobi `{ rows: [{ inboxId, fileId, fileName, topics, guess } | { inboxId, error }] }`, faqat muvaffaqiyatlilar `markInbox(..., 'taken_at')`.

- [ ] **Step 1: Failing testlar:**
  - `GET /api/inbox` → `{ count, rows:[{ id, fileName, caption, source, postedAt }] }`.
  - `take` bitta yozuv `file_name: 'reja.xlsx'`, `caption: '6-sinf Matematika'`, `posted_at: 2026-11-09` → `guess.grade === 6`, `guess.subject === 'math'`, `guess.quarter === 2`, `guess.year === '2026/2027'`, `fileId` inbox'dagi bilan bir xil, `sendDocument` chaqirilmagan.
  - `take` ikki yozuv, birinchisida `downloadFile` tashlaydi → birinchisi `{ inboxId, error: 'telegram' }`, ikkinchisi olingan; `markInbox` faqat ikkinchi id bilan.
  - `take` 51 id → 400; `dismiss` → `markInbox(ids,'dismissed_at')`; Origin'siz POST → 403.
  - Mavjud `/api/files` testlari o'zgarmasdan o'tadi.
- [ ] **Step 2:** FAIL. **Step 3:** yozing. **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — `feat(panel): inbox API with caption and date guesses`

### Task 5: Fanlar API

**Files:** Modify `dashboard/server.js`, `bot.js` (deps); Test `test/server-subjects.test.js`.

**Interfaces:**
- Consumes: Task 1 db funksiyalari, `makeSubjectKey`, `validateSubject`.
- `deps` ga: `reloadSubjects(): Promise` (bot.js da `admin.loadExtraSubjects`). `db` deps ga `subjectsForPanel, subjectKeyExists, insertSubject, updateSubject, archiveSubject, restoreSubject`.
- Yo'llar spec 3.2 jadvalidagidek; kalit yo'lda `decodeURIComponent` va regex bilan tekshiriladi.

- [ ] **Step 1: Failing testlar:** `GET /api/subjects` → `rows`; `POST /api/subjects {uz:'Fizika'}` → `{ key:'x-fizika' }`, `insertSubject` `{ key:'x-fizika', uz:'Fizika', ru:'Fizika', alias:[] }` bilan, `reloadSubjects` 1 marta; `{uz:'!!!'}` → 400; `{uz:''}` → 400; `POST /api/subjects/x-fizika {uz:'Fizika 2'}` → `{ ok:true }`; mavjud bo'lmagan kalit → 404; `/archive {withPlans:true}` → `archiveSubject('x-fizika', true)`; `/restore` → ok; kalit `../x` → 404; Origin'siz → 403.
- [ ] **Step 2:** FAIL. **Step 3:** yozing (bot.js deps qo'shiladi). **Step 4:** PASS; `node --check bot.js`.
- [ ] **Step 5: Commit** — `feat(panel): subjects API`

### Task 6: Interfeys

**Files:** Modify `dashboard/index.html`; dev server `.superpowers/sdd/2026-11-12-panel-inbox-subjects-theme/devserver.mjs` (oldingi devserver nusxasi + inbox va fanlar soxta funksiyalari).

- [ ] **Step 1: Rejim tugmasi** — spec 4.
- [ ] **Step 2: Inbox bloki** — spec 2.4; qator manbai "📥"; modal ro'yxat va "kerak emas".
- [ ] **Step 3: Fanlar tabi** — spec 3.3; o'zgarishdan keyin `meta` qayta yuklanadi (filtrlar yangilanadi).
- [ ] **Step 4: Brauzer tekshiruvi** (soxta server): inbox → jadvalga olish → saqlash; "kerak emas"; izohdagi `<b>x</b>` matn bo'lib ko'rinadi; fan qo'shish/tahrirlash/arxivlash (rejali fan uchun tanlov)/qaytarish; rejim tugmasi ikkala rejimda va qayta yuklashdan keyin; 375 px da gorizontal scroll yo'q; konsolda xato yo'q.
- [ ] **Step 5: Commit** — `feat(panel): inbox block, subjects tab, theme toggle`
