# Avtomatik import (sinov bosqichi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sinovchilar uchun yashirin `/auto`: o'qituvchining eMaktab sinf × fanlariga bazadan rejalarni topib, tasdiqdan keyin brauzersiz (HTTP) import qilish, bepul.

**Architecture:** Login Playwright'da qoladi (`EmaktabSession`), cookie'lar `storage_state` dan olinib `emaktab-http.js` dagi HTTP mijozga beriladi. HTML o'qish sof funksiyalarda (`emaktab-parse.js`), moslash `auto/match.js` da, fon navbati `auto/runner.js` da, Telegram oqimi `auto/flow.js` da (bot.js faqat ulaydi).

**Tech Stack:** Node 22 ESM, grammY, Playwright (faqat login), `fetch`/`FormData`/`Blob` (Node o'zida), pg, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-14-auto-import-design.md`

## Global Constraints

- `BOT_TOKEN`, `ENC_KEY` ga tegilmaydi.
- Migratsiya faqat `alter table ... add column if not exists`; `delete/drop/truncate` yozilmaydi; mavjud ustun o'zgarmaydi.
- `chargeImport`, `checkQuota`, `go` callback, `ledger`, `balance`, `free_used`, `imports_ok` — avtomatik import ularni chaqirmaydi va o'zgartirmaydi.
- `emaktab.js` dagi `W` va `COLUMN_RULES` qiymatlari o'zgarmaydi (faqat `export` qo'shiladi).
- Yangi npm paket yo'q.
- Ruxsat: `ADMIN_ID` yoki `AUTO_TESTERS` (vergul bilan Telegram ID'lar). Boshqalarga `/auto` hech narsa demaydi (bot.js'dagi noma'lum matn bilan bir xil yo'l).
- `AUTO_CONCURRENCY` standart 2; `AUTO_MAX_ITEMS` standart 1.
- Parol, cookie, token, `__RequestVerificationToken` logga yozilmaydi; loglar `[auto]` prefiksi bilan.
- Uzoq ish grammY handlerida `await` qilinmaydi (fonda).
- Matnlar `i18n.js` da uz/ru.
- Testlar: `npm test` (`node --test "test/*.test.js"`), hozir 67 ta yashil.

## Review Focus

1. Sinf nomi kutilmagan ko'rinishda ("5А" chiziqsiz, "5-A (1-guruh)", lotin/kirill harf) — sinf raqami baribir to'g'ri o'qiladi, o'qilmasa qator ❌ bo'ladi, yiqilmaydi. → Task 4 testlari.
2. Ish o'rtasida eMaktab sessiyasi tugaydi (login sahifasiga redirect) — bitta qayta kirish, keyin davom; qayta kirishda 2FA kerak bo'lsa — qolgan elementlar "qayta /auto bosing" xatosi bilan tugaydi, osilib qolmaydi. → Task 3, Task 6 testlari.
3. Reja faylida sarlavha qatori yo'q yoki ustun nomlari notanish — tartib bo'yicha (raqam, mavzu, vazifa) moslanadi. → Task 2 testi.
4. Deploy/qayta ishga tushishdan keyin eski tugma bosiladi — "sessiya tugadi" javobi, xato yo'q. → Task 7 testi.
5. O'qituvchida 30+ sinf × fan — ko'rib chiqish xabari Telegram chegarasidan oshmaydi (bo'laklanadi), `AUTO_MAX_ITEMS` faqat birinchi N tasini belgilaydi. → Task 7 testlari.

---

### Task 1: eMaktab sahifalarini o'qish va fixture'lar (qo'lda, admin bilan)

Kod emas — keyingi parserlar shu haqiqiy sahifalarga yoziladi. Import yuborilmaydi.

**Files:**
- Create: `test/fixtures/emaktab/import-step1.html`, `import-step2.html`, `import-step3.html`, `getsubjects.json`, `getsubgroups.json`, `getperiods.json`, `login-redirect.txt`, `README.md`

- [ ] **Step 1:** Admin Chrome'da sinovchi akkauntiga o'zi kiradi (parolni Claude terish yo'q). Claude in Chrome bilan `https://schools.emaktab.uz/v2/journals/planning/import` ochiladi.
- [ ] **Step 2:** 1-qadam HTML (`document.documentElement.outerHTML`) saqlanadi. Admin bitta reja faylini (bazadan yuklab olingan) tanlaydi, "Далее" → 2-qadam HTML saqlanadi. Aniqlanadi: `group`/`year`/`period` selectlari 1-qadamdami yoki faqat 2-qadamdami; `file=storage:///…` yashirin maydon nomi; moslash selectlari `select_0..N` nomlari va option qiymatlari.
- [ ] **Step 3:** 2-qadam ro'yxatlari: `getsubjects-cmd`, `getsubgroups-cmd`, `getperiods-cmd` javoblari (`fetch` bilan sahifa ichidan) saqlanadi.
- [ ] **Step 4:** 2-qadam to'ldirilib "Далее" → 3-qadam (ko'rib chiqish) HTML saqlanadi; qator `select` nomlari (`select=<rowId>=1|0` shakli) va submit tugmasi nomi/qiymati yoziladi. **"Импортировать" bosilmaydi.** "Отменить импорт этого файла" bilan bekor qilinadi.
- [ ] **Step 5:** Sessiyasiz `fetch(import URL, {credentials:'omit', redirect:'manual'})` natijasi (status, `location`) `login-redirect.txt` ga.
- [ ] **Step 6:** Barcha fixture'lardan F.I.Sh., login, maktab nomi, token qiymatlari `XXX` bilan almashtiriladi; `README.md` ga topilgan maydon nomlari ro'yxati. Agar sahifa tuzilishi spec 6-bo'limidan farq qilsa — Task 2–3 interfeyslari shu yerda yangilanadi va admin'ga aytiladi.
- [ ] **Step 7: Commit** — `test(fixtures): sanitized eMaktab import pages`

### Task 2: HTML parserlar — `emaktab-parse.js`

**Files:**
- Modify: `emaktab.js` — `W` va `COLUMN_RULES` ga `export` qo'shish (qiymatlar o'zgarmaydi)
- Create: `emaktab-parse.js`
- Test: `test/emaktab-parse.test.js`

**Interfaces:**
- Consumes: `W`, `COLUMN_RULES` (`emaktab.js`), Task 1 fixture'lari.
- Produces:
  - `parseToken(html) -> string|null` — `__RequestVerificationToken` qiymati
  - `parseHidden(html, name) -> string|null` — `file` kabi yashirin maydonlar
  - `parseSelect(html, name) -> [{ value, label, selected }]`
  - `mapColumnsFromHeaders(headers: string[]) -> { values: number[], done: number, report: string }` — `values[i]` = `select_i` qiymati (0 raqam, 1 mavzu, 2 vazifa, −1 o'tkazish); `COLUMN_RULES` bo'yicha, kamida 3 tasi topilmasa tartib bo'yicha
  - `countColumnSelects(html) -> number` — 2-qadamdagi `select_N` soni
  - `parseMyClasses(html) -> { school, periodId, classes: [{ groupId, className, subjects: [{ id, name }] }] }`
  - `previewFromHtml(html) -> { rows: [{ rowId, lesson, topic, hw, ok, status }], selectName }` — `preview()` qoidalari: holat faqat o'z ustunidan, `^(xato|хато|ошибка)!?$` belgisi, `W.ready`/`W.error`
  - `isLoginPage(status, location, html) -> boolean`
  - `isMaintenance(html) -> boolean` — hozirgi `assertAlive` matni bilan bir xil qoida
  - `parseImportResult(html) -> { ok: boolean|null, text: string }` — aniqlanmasa `ok: null`
  - `periodNumber(label) -> 1..4|null` — "2 четверть", "2-chorak", "II chorak"

- [ ] **Step 1: Failing testlar** (`test/emaktab-parse.test.js`):
  - `parseToken(step1)` fixture'dagi `XXX` tokenni qaytaradi; tokensiz HTML → `null`.
  - `parseHidden(step2, 'file')` `storage:///` bilan boshlanadi.
  - `mapColumnsFromHeaders(['№', 'Тема урока', 'Домашнее задание']).values` → `[0, 1, 2]`; `['Mavzu', 'T/r', 'Uy vazifasi']` → `[1, 0, 2]`.
  - `mapColumnsFromHeaders(['A', 'B', 'C'])` → tartib bo'yicha `[0, 1, 2]` (Review Focus 3); `['A','B','C','D']` → `[0,1,2,-1]`.
  - `countColumnSelects(step2) === 3`.
  - `parseMyClasses(myclasses)` → 3 sinf; `4-A` da 4 fan, `subjects[1]` = `{ id: '1984492252597963094', name: 'Информатика' }`; `school === '1000000000001'`, `periodId === '2530691816384972571'`.
  - `previewFromHtml(step3).rows.length > 0`, har qatorda `rowId`; "Работа над ошибками" mavzuli sintetik qator `ok: true`; holati "Ошибка!" qator `ok: false`; "Импортируемая тема урока заменит текущую…" holatli qator `ok: true`.
  - `periodNumber('2 четверть') === 2`, `periodNumber('3-chorak') === 3`, `periodNumber('II chorak') === 2`, `periodNumber('Год') === null`.
  - `isLoginPage(302, 'https://login.emaktab.uz/...', '') === true`.
- [ ] **Step 2:** `node --test test/emaktab-parse.test.js` → FAIL (modul yo'q).
- [ ] **Step 3:** `emaktab-parse.js` ni yozish — regex bilan (`<select name="…">…</select>`, `<option value="…" selected>`), `<table>` qatorlari `<tr>`/`<td>` bo'yicha, teglarni olib tashlab `norm`.
- [ ] **Step 4:** Test PASS; `npm test` — hammasi yashil.
- [ ] **Step 5: Commit** — `feat(auto): pure HTML parsers for eMaktab import pages`

### Task 3: HTTP mijoz — `emaktab-http.js`

**Files:**
- Create: `emaktab-http.js`
- Test: `test/emaktab-http.test.js`

**Interfaces:**
- Consumes: Task 2 parserlari.
- Produces:
  - `cookiesFromState(storageState) -> [{ name, value, domain, path }]` — faqat `emaktab.uz` domenlari
  - `createEmaktabHttp({ cookies, fetch = globalThis.fetch, timeoutMs = 30_000 })` →
    - `listClassSubjects() -> Promise<{ school, periodId, classes }>` (`parseMyClasses` natijasi)
    - `subgroups(groupId) -> Promise<[{ id, name }]>` (birinchisi `{ id: '', name: 'Весь класс' }`)
    - `periods(groupId) -> Promise<[{ id, name, n }]>` (`n = periodNumber(name)`)
    - `importOne({ file: Buffer, fileName, year, groupId, subjectId, subgroupId = '', periodId, okOnly = false }) -> Promise<{ state: 'done'|'needs_choice'|'failed', rows, imported, result }>`
  - Xatolar (`err.code`): `SESSION_EXPIRED`, `MAINTENANCE`, `EMAKTAB_UNEXPECTED` (`err.message` — sahifa matnining 300 belgisi)

- [ ] **Step 1: Failing testlar** — soxta `fetch` (URL + metod bo'yicha fixture qaytaradi, so'rovlarni yozib boradi):
  - `cookiesFromState` `login.emaktab.uz` va `schools.emaktab.uz` cookie'larini oladi, `google.com` ni tashlaydi.
  - Har so'rovda `cookie` sarlavhasi bor; javobdagi `set-cookie` keyingi so'rovga qo'shiladi.
  - `importOne` tayyor qatorlar bilan: so'rovlar tartibi GET import → POST step1 (multipart, `multifile1`, `firstRow=0`, `step1`) → POST step2 (`year, group, subject, subgroup, period, file`, `select_i` Task 2 xaritasidan, `step2`) → POST step3 (har qator `select=<rowId>=1`, submit maydoni Task 1 README'dagi nom/qiymat) → `state: 'done'`.
  - Xato qatorli step3 fixture → step3 POST **yuborilmaydi**, `state: 'needs_choice'`, `rows` da `ok:false` qatorlar.
  - Xuddi shu, `okOnly: true` → step3 yuboriladi, xato qatorlar `=0`, tayyorlar `=1`, `imported` = tayyorlar soni.
  - Birinchi GET 302 → login → `SESSION_EXPIRED` (Review Focus 2).
  - Har `fetch` chaqiruvida `signal` bor.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Yozish. `redirect: 'manual'`; multipart — `FormData` + `new Blob([file])`; urlencoded — `URLSearchParams`. `listClassSubjects` — `GET /v2/myclasses` + `parseMyClasses`. `importOne` ustun xaritasi uchun faylni `readRows` (`xlsx.js`) bilan o'qib birinchi qatorni `mapColumnsFromHeaders` ga beradi; `firstRow=0`. 1-qadam formasi yashirin maydonlari sahifadan olinadi, `group/subject/subgroup/period/year/school` o'rnatiladi.
- [ ] **Step 4:** PASS; `npm test` yashil.
- [ ] **Step 5: Commit** — `feat(auto): browserless eMaktab import client`

### Task 4: Moslash va sozlamalar — `auto/match.js`

**Files:**
- Create: `auto/match.js`
- Test: `test/auto-match.test.js`

**Interfaces:**
- Consumes: `guessSubject` (`hints.js`), `quarterOfDate`, `schoolYearOfDate` (`dashboard/inbox.js`).
- Produces:
  - `readAutoConfig(env) -> { testers: Set<number>, concurrency: number, maxItems: number }` (standartlar 2 va 1; noto'g'ri son → standart)
  - `canAuto(tgId, { adminId, testers }) -> boolean`
  - `gradeOfClass(name) -> number|null` — 1..11, aks holda `null`
  - `needsGradingAnswer(classes, accountGrading) -> boolean` — 5–11 sinf bor va `accountGrading` `null`
  - `buildItems({ classes, quarter, year, accountGrading, accountMedium, mediumOverride = {}, keyOf, allowed, findPlan, maxItems }) -> Promise<Item[]>`
    - `medium`: `accountMedium` `'uz'|'ru'` → shu; `'both'` → `mediumOverride[groupId] || 'uz'`
    - `Item = { i, groupId, className, subjectId, subjectName, grade, subjectKey, medium, grading, plan|null, reason|null, selected, subgroupId: '' , subgroupName: 'Весь класс' }`
    - `reason`: `'grade'` | `'subject'` | `'noplan'`; `selected = !!plan` faqat birinchi `maxItems` ta rejali elementlar uchun

- [ ] **Step 1: Failing testlar:**
  - `readAutoConfig({ AUTO_TESTERS: ' 111, 222 ,x' })` → `testers` = {111, 222}, `concurrency 2`, `maxItems 1`; `AUTO_MAX_ITEMS: '50'` → 50; `'-3'` → 1.
  - `canAuto(5, { adminId: 5, testers: new Set() })` true; `canAuto(7, …)` false.
  - `gradeOfClass`: `'5-A'`→5, `'11-В'`→11, `'5А'`→5, `'5-A (1-guruh)'`→5, `'12-A'`→null, `'A'`→null (Review Focus 1).
  - `buildItems`: grade 3 → `grading 'normal'` (accountGrading `'bsb'` bo'lsa ham); grade 7 + `'bsb'` → `'bsb'`; topilmagan reja → `plan null, reason 'noplan', selected false`; 3 ta rejali, `maxItems 1` → faqat birinchisi `selected` (Review Focus 5); fan aniqlanmasa → `reason 'subject'`.
  - `findPlan` ga `{ grade, subjectKey, quarter, year, medium, grading }` aynan shu maydonlar bilan chaqiriladi.
  - `accountMedium 'ru'` → hamma elementda `medium 'ru'`; `'both'` + `mediumOverride { [g]: 'ru' }` → faqat o'sha sinf `ru`, qolganlari `uz`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Yozish.
- [ ] **Step 4:** PASS; `npm test` yashil.
- [ ] **Step 5: Commit** — `feat(auto): match eMaktab class-subjects to plans`

### Task 5: Baza — BSB javobi

**Files:**
- Modify: `db.js` (sxema bloki va yangi funksiyalar)
- Test: `test/db-sql.test.js` (mavjud uslubda) + PGlite smoke (scratchpad `pg/smoke.mjs`)

**Interfaces:**
- Produces: `getAutoPrefs(tgId) -> { grading: 'bsb'|'normal'|null, medium: 'uz'|'ru'|'both'|null }`, `setAutoGrading(tgId, value)` (`'bsb'|'normal'`), `setAutoMedium(tgId, value)` (`'uz'|'ru'|'both'`); boshqa qiymat → xato

- [ ] **Step 1:** Failing test: sxema matnida `alter table accounts add column if not exists auto_grading text` va `... auto_medium text`; `setAutoGrading(1, 'x')`, `setAutoMedium(1, 'en')` rad etiladi; SQL `users → accounts` orqali yangilaydi.
- [ ] **Step 2:** FAIL. **Step 3:** Yozish. **Step 4:** PASS + PGlite: ustun qo'shiladi, ikki marta `ensureSchema` xatosiz, yozish/o'qish ishlaydi.
- [ ] **Step 5: Commit** — `feat(db): store auto-import grading answer per account`

### Task 6: Fon navbati — `auto/runner.js`

**Files:**
- Create: `auto/runner.js`
- Test: `test/auto-runner.test.js`

**Interfaces:**
- Consumes: Task 3 `importOne` (in'ektsiya orqali).
- Produces:
  - `createRunner({ concurrency, log = console.log })` →
    - `busy(tgId) -> boolean`
    - `start(tgId, { items, work, onDone }) -> boolean` — `busy` bo'lsa `false`; `work(item) -> Promise<Result>` ketma-ket; bitta xato (`throw`) → o'sha element `{ state: 'failed', error }`, qolganlari davom; hammasi tugagach `onDone(results)`
    - global: bir vaqtda ko'pi bilan `concurrency` ta o'qituvchi ishi, qolganlari navbatda
  - `work` ichida `SESSION_EXPIRED` → chaqiruvchi bitta qayta kirish qiladi (Task 7); runner faqat xatoni natijaga yozadi

- [ ] **Step 1: Failing testlar:** ikkinchi `start` o'sha o'qituvchiga `false`; `concurrency 2` da uchinchi o'qituvchi ikkinchisi tugaguncha boshlanmaydi; 2-element xatosi 3-elementni to'xtatmaydi; `onDone` bir marta, natijalar tartibi elementlar tartibida; tugagach `busy` `false`.
- [ ] **Step 2:** FAIL. **Step 3:** Yozish. **Step 4:** PASS; `npm test` yashil.
- [ ] **Step 5: Commit** — `feat(auto): per-teacher background queue`

### Task 7: Telegram oqimi — `auto/flow.js`, `i18n.js`, `bot.js`

**Files:**
- Create: `auto/flow.js`
- Modify: `i18n.js` (`auto_*` kalitlari uz/ru), `bot.js` (ulash: `/auto`, callbacklar, merge matni)
- Test: `test/auto-flow.test.js`

**Interfaces:**
- Consumes: Task 2–6; bot.js'dan in'ektsiya: `db`, `t`, `EmaktabSession`, `askTwoFactor`, `fetchPlanFile`, `admin.allSubjects`, `admin.keyOfName`, `liveSubjectKeys`, `sendChunks`, `parsePairs`, `applyMerges`, `readRows`, `writeRows`, `notifyAdmin`, `now = () => new Date()`.
- Produces: `createAutoFlow(deps) -> { command(ctx), callback(ctx, data), text(ctx) -> boolean }`
  - Callback ma'lumotlari (`au:` prefiksi, ≤64 bayt): `au:ok`, `au:x`, `au:q`, `au:q:<1-4>`, `au:sel`, `au:t:<i>`, `au:seld`, `au:g`, `au:gs:<i>:<k>`, `au:md:<groupIndex>`, `au:lang:<uz|ru|both>`, `au:bsb:<1|0>`, `au:m:<i>`, `au:k:<i>`, `au:s:<i>`
  - Holat: xotirada `Map(tgId → { items, quarter, year, cookies, choice: Map(i → { rows, file, fileName }) , at })`, 2 soat; topilmasa → `t(lang,'session_end')` (Review Focus 4)

- [ ] **Step 1: Failing testlar** (soxta `ctx`, soxta deps):
  - Sinovchi emas → `command` hech narsa yubormaydi va `false` qaytaradi (bot.js keyingi handlerga o'tadi).
  - Akkaunt yo'q (`db.getCreds` → null) → `need_login`.
  - `getAutoPrefs` `medium null` → til savoli (O'zbekcha / Ruscha / Ikkalasi), `au:lang:ru` → `setAutoMedium(id,'ru')`; keyin (kerak bo'lsa) BSB savoli.
  - 5–11 sinf va `grading null` → BSB savoli, `au:bsb:1` → `setAutoGrading(id,'bsb')` va ko'rib chiqish chiqadi.
  - Ko'rib chiqish matnida chorak, yil, har qator "✅ reja bor (N mavzu)" / "❌ …", "Mavjud mavzular almashtiriladi"; 40 elementda `sendChunks` ishlatiladi (Review Focus 5).
  - `au:q:3` → `buildItems` `quarter 3` bilan qayta.
  - `medium 'both'` bo'lsa ko'rib chiqishda har sinf uchun "🇺🇿/🇷🇺 <sinf>" tugmasi; `au:md:<groupIndex>` → `mediumOverride` almashadi va ro'yxat qayta moslanadi. `uz`/`ru` bo'lsa bu tugmalar yo'q.
  - `au:g` → qator raqami so'raladi; `text(ctx)` "2" → `subgroups(groupId)` tugmalari; `au:gs:2:1` → element `subgroupId`/`subgroupName` yangilanadi, `importOne` shu `subgroupId` bilan chaqiriladi.
  - `au:t:<i>` belgini almashtiradi; `au:ok` → `runner.start` faqat `selected` elementlar bilan; hech biri tanlanmagan → `auto_none`.
  - `au:ok` handler `runner.start` dan keyin darhol qaytadi (fon) va `auto_started` yuboradi.
  - `work`: `SESSION_EXPIRED` → bitta Playwright qayta kirish, cookie'lar yangilanadi, element qayta urinadi; qayta kirishda `TWO_FA` → `failed` + "`/auto` ni qayta bosing" (Review Focus 2).
  - Natija xabari: `done` → "✅ … N/N", `needs_choice` → "⚠️ …" + `au:m/k/s` tugmalari, `failed` → "❌ … sabab"; admin'ga hisobot.
  - `au:k:<i>` → `importOne({ …, okOnly: true })`; `au:s:<i>` → elementni yopadi; `au:m:<i>` → merge matnini kutadi, `text(ctx)` juftliklarni `parsePairs` bilan o'qib, `applyMerges` + `writeRows` → qayta `importOne`.
  - Hech bir yo'lda `db.chargeImport`, `db.checkQuota` chaqirilmaydi (soxta db ular chaqirilsa `throw` qiladi).
  - Eski tugma (holat yo'q) → `session_end`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `auto/flow.js` va `i18n.js` kalitlari. Kirish: `db.getState(id)` → `cookiesFromState`; yo'q bo'lsa `EmaktabSession.launch/login` → `db.saveState`; `TWO_FA` → `askTwoFactor(ctx,id,lang,es,e.link,{kind:'session'})` (hozirgi "tasdiqlandi, qayta urining" javobi bilan qaytadi).
- [ ] **Step 4:** `bot.js` ulash: `/auto` buyrug'i (`createAutoFlow` bitta nusxa), `bot.callbackQuery(/^au:/, …)`, matn handlerida `flow` tekshiruvlaridan oldin `auto.text(ctx)` (true bo'lsa to'xtaydi). `/auto` `setMyCommands` ro'yxatiga qo'shilmaydi.
- [ ] **Step 5:** PASS; `npm test` yashil; `node --check bot.js`.
- [ ] **Step 6: Commit** — `feat(auto): hidden /auto flow for testers`

### Task 8: Yakuniy tekshiruv va production sinovi (admin bilan)

- [ ] **Step 1:** `npm test` hammasi yashil; `grep -n "chargeImport\|checkQuota" auto/ emaktab-http.js emaktab-parse.js` — bo'sh.
- [ ] **Step 2:** Butun branch bo'yicha yakuniy kod tekshiruvi (opus reviewer, `code-reviewer.md` shabloni); topilganlar tuzatiladi.
- [ ] **Step 3:** Admin roziligi bilan `main` ga merge va push (deploy). Railway: `AUTO_TESTERS=<sinovchi ID>`, `AUTO_MAX_ITEMS=1`. Loglar: `railway logs` da xato yo'q, `/health` 200.
- [ ] **Step 4:** Sinovchi `/auto` → ko'rib chiqish → bitta sinf × fan → Tasdiqlash. Admin bilan eMaktab rejalashtirishda mavzu, uy vazifasi, dars raqami tekshiriladi. Natija sahifasi HTML'i (admin'ga log) `parseImportResult` fixture'iga qo'shiladi (alohida commit).
- [ ] **Step 5:** To'g'ri bo'lsa — admin `AUTO_MAX_ITEMS` ni oshiradi; qolganlari import qilinadi.
