# Drive'dan rejalar va ommaviy yuklash tezligi — amalga oshirish rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reja fayllarini Google Drive papkasidan olish (`drive:<id>` sifatida saqlash) va 600 qatorli ommaviy yuklashni qotmaydigan qilish.

**Architecture:** `dashboard/drive.js` — Drive v3 REST, xizmat akkaunti JWT (node:crypto). Drive fayllari mavjud `plan_inbox` oqimiga tushadi. Fayl yuklab olish bitta `fetchPlanFile` orqali (`drive:` → Drive, aks holda Telegram). UI: chizishni kadrga yig'ish, 100 qatorli sahifa, `exists-many`, 200 talik saqlash bo'laklari.

**Tech Stack:** Node 22 ESM, grammy, pg, `node:crypto`, `node:test`. Yangi npm paket yo'q.

**Spec:** `docs/superpowers/specs/2026-11-14-drive-plans-design.md`

## Global Constraints

- `BOT_TOKEN`/`ENC_KEY` ga tegilmaydi; mavjud ustun o'zgarmaydi; `DROP`/`TRUNCATE`/`DELETE` yo'q; yangi sxema kerak emas (`meta` jadvali bor).
- Yangi npm paket yo'q.
- `GOOGLE_SA_KEY` — JSON matn yoki uning base64'i; yo'q/buzuq → Drive "ulanmagan", qolgan hammasi ishlaydi. Kalit matni logga yozilmaydi.
- Scope `https://www.googleapis.com/auth/drive.readonly`; token 60 s oldin yangilanadi.
- Scan: ≤ 2000 fayl, ≤ 50 papka; > 5 000 000 bayt → `tooBig`.
- Drive rejasi: `file_id = 'drive:' + id`; inbox: `file_id = file_unique_id = 'drive:' + id`, `caption = path`, `source = 'Google Drive'`, `posted_at = modifiedTime`.
- `exists-many` ≤ 500 kalit; UI saqlash bo'lagi 200; sahifa 100 qator; `take` parallelligi 4.
- Meta kalitlari: `drive_folder_id`, `drive_folder_name`.

## Review Focus

1. Drive papkasi ulashilmagan / kalit noto'g'ri — tushunarli xabar, 500 emas. → Task 3.
2. Bir xil papkani ikki marta scan — ikkinchisida `added: 0`; "kerak emas" qilingan fayl qaytmaydi. → Task 2 (PGlite), Task 3.
3. Drive'dan o'chirilgan fayl — ko'rish/yuklab olish `404 drive`, botda xabar; process yiqilmaydi. → Task 3, Task 4.
4. 600 qatorda filtr/sahifa — saqlash hisoblari sahifaga emas, filtrga mos hammasiga. → Task 5 brauzer tekshiruvi.
5. Bo'lakli saqlash o'rtasida xato — saqlanganlar ro'yxatdan chiqadi, qolganlari xato bilan qoladi. → Task 5.

## Fayllar

| Fayl | Vazifa |
|---|---|
| `dashboard/drive.js` (yangi) | `createDrive`, `parseFolderId`, `parseKey` |
| `db.js` | `addInboxMany`, `knownDriveIds`, `existsMany`, `getMeta`, `setMeta` |
| `dashboard/server.js` | `/api/drive*`, `/api/plans/exists-many`, `take` parallel, drive xatolari |
| `bot.js` | Drive yaratish, `fetchPlanFile`, `a:pf:` |
| `dashboard/index.html` | tezlik o'zgarishlari, Drive tugmasi/modal |

---

### Task 1: Drive moduli

**Files:** Create `dashboard/drive.js`; Test `test/drive.test.js`.

**Interfaces — Produces:**
- `parseKey(raw: string|undefined): { client_email, private_key } | null` (JSON yoki base64-JSON).
- `parseFolderId(s: string): string|null` — `/folders/<id>`, `?id=<id>`, xom `^[A-Za-z0-9_-]{10,}$`.
- `createDrive({ key, fetch = globalThis.fetch, now = Date.now }) → { email, folderInfo(id), listXlsx(folderId), download(fileId) }`; xatolar `Error` bilan `code`: `DRIVE_NO_ACCESS` (403/404 papka), `DRIVE_NOT_FOUND` (404 fayl), `DRIVE_FAIL` (boshqa).
- `listXlsx` → `{ files: [{ id, name, size:number, modifiedTime, path }], truncated:boolean }`.

- [ ] **Step 1: Failing testlar** — test RSA kaliti `crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })`, soxta `fetch` so'rovlarni yozib boradi:
  - `parseKey` JSON, base64, buzuq → `null`; `parseFolderId` uch shakl + `'salom'` → `null`.
  - Token so'rovi: `POST https://oauth2.googleapis.com/token`, body `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>`; JWT header `{alg:'RS256',typ:'JWT'}`, payload `iss=email, scope=drive.readonly, aud=token URL, exp-iat=3600`; imzo public kalit bilan `crypto.verify` → true.
  - Ikki API chaqiruv → token bir marta olinadi; `now` 3600 s oldinga → qayta olinadi.
  - `listXlsx`: ildizda `a.xlsx`, `b.pdf`, `Sub` papka; `Sub` da `c.xls` → `[a.xlsx (path ''), c.xls (path 'Sub')]`; `nextPageToken` bo'lsa keyingi sahifa so'raladi.
  - `download` 404 → `code === 'DRIVE_NOT_FOUND'`; `folderInfo` 403 → `DRIVE_NO_ACCESS`; papka bo'lmagan mimeType → `DRIVE_NO_ACCESS`.
- [ ] **Step 2:** FAIL. **Step 3:** yozing (`files.list` q: `'<id>' in parents and trashed = false`, fields `nextPageToken, files(id,name,mimeType,size,modifiedTime)`, `pageSize=1000`, `supportsAllDrives=true&includeItemsFromAllDrives=true`). **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(drive): read-only Google Drive client with service account JWT`

### Task 2: Baza

**Files:** Modify `db.js`; PGlite `smoke.mjs`.

**Interfaces — Produces:**
- `addInboxMany(recs: InboxRec[]): Promise<number>` — bitta `insert ... select from unnest(...)`, `where not exists (select 1 from plan_inbox where file_unique_id = x.u)` (barcha holatlar), qo'shilganlar soni.
- `knownDriveIds(ids: string[]): Promise<Set<string>>` — `'drive:'+id` sifatida `plans.file_id` yoki `plan_inbox.file_unique_id` da borlari (prefikssiz id qaytadi).
- `existsMany(keys: {grade,subjectKey,quarter,year,medium,grading}[]): Promise<number[]>` — mavjud (arxivlanmagan) indekslar.
- `getMeta(key): Promise<string|null>`, `setMeta(key, value): Promise<void>`.

- [ ] **Step 1:** PGlite smoke'ga: addInboxMany 3 ta → 3; qayta → 0; dismiss qilingan → qayta 0; knownDriveIds plan va inbox bo'yicha; existsMany aralash ro'yxat; set/getMeta upsert. **Step 2:** FAIL. **Step 3:** yozing. **Step 4:** `ALL OK`; `npm test` PASS.
- [ ] **Step 5: Commit** — `feat(db): bulk inbox insert, drive id lookup, existsMany, meta`

### Task 3: Server

**Files:** Modify `dashboard/server.js`; Test `test/server-drive.test.js`; `test/helpers.js`.

**Interfaces:**
- `deps.drive` — `createDrive` natijasi yoki `null`. `deps.downloadFile` endi `fetchPlanFile` (bot.js da) — server `DRIVE_NOT_FOUND` ni `404 {"error":"drive"}` ga, `DRIVE_FAIL` ni `502 {"error":"drive"}` ga aylantiradi (topics, file).
- Yo'llar spec 6-bo'limdagidek. `scan` spec 4-bo'lim qoidalari bilan `knownDriveIds` + `addInboxMany`.
- `take`: `getInbox` natijasi 4 tadan parallel ishlanadi, javob tartibi saqlanadi.

- [ ] **Step 1: Failing testlar** (soxta drive obyekti):
  - `GET /api/drive` drive `null` → `{ configured:false, email:null, folder:null }`; bor → email va meta'dagi papka.
  - `POST /api/drive/folder { url: '.../folders/ABCDEFGHIJK' }` → `folderInfo('ABCDEFGHIJK')`, `setMeta` 2 marta, `{ id, name }`; `DRIVE_NO_ACCESS` → 400, `error` matnida email bor; noto'g'ri havola → 400; drive `null` → 400.
  - `scan`: 4 fayl (biri ma'lum, biri 6 MB) → `{ found:4, added:2, known:1, tooBig:1, truncated:false, folder }`, `addInboxMany` yozuvlari spec bo'yicha (`caption` = path); papka yo'q → 400.
  - `exists-many` 2 kalit → `{ existing:[...] }`; 501 → 400.
  - `/api/plans/7/file` downloadFile `DRIVE_NOT_FOUND` tashlasa → 404 `{"error":"drive"}`.
  - Origin'siz POST → 403.
- [ ] **Step 2:** FAIL. **Step 3:** yozing. **Step 4:** PASS (mavjud testlar ham).
- [ ] **Step 5: Commit** — `feat(panel): Drive folder, scan into inbox, exists-many`

### Task 4: Botga ulash

**Files:** Modify `bot.js`.

- [ ] **Step 1:** `const drive = (() => { const k = parseKey(process.env.GOOGLE_SA_KEY); return k ? createDrive({ key: k }) : null; })()` — xato bo'lsa `null` va `console.error('[drive] kalit o'qilmadi')` (kalit matnisiz).
- [ ] **Step 2:** `fetchPlanFile(fileId)`: `drive:` → `drive.download(id)` (drive `null` bo'lsa `DRIVE_FAIL` xatosi), aks holda mavjud Telegram usuli. Dashboard deps: `downloadFile: fetchPlanFile`, `drive`.
- [ ] **Step 3:** `a:pf:` — `p.file_id.startsWith('drive:')` bo'lsa `replyWithDocument(new InputFile(await fetchPlanFile(p.file_id), p.file_name || 'reja.xlsx'))`, xato → `"Fayl Drive'da topilmadi (o'chirilgan yoki ulashish bekor qilingan)."`.
- [ ] **Step 4:** `node --check bot.js`; `npm test`.
- [ ] **Step 5: Commit** — `feat(bot): fetch plan files from Drive or Telegram`

### Task 5: Interfeys

**Files:** Modify `dashboard/index.html`; dev server `.superpowers/sdd/2026-11-14-drive-plans/devserver.mjs` (oldingisi + soxta drive: 600 fayl, ichki papkalar).

- [ ] **Step 1: Chizishni yig'ish** — `renderBulk()` → `requestAnimationFrame` bilan bitta; ichki `drawBulk()`.
- [ ] **Step 2: Sahifalash** — 100 qator, `‹ n/m ›`; filtr/tartib o'zgarsa 1-sahifa; saqlash hisoblari `readyRows` (sahifasiz).
- [ ] **Step 3: exists-many** — `checkExists(r)` navbatga qo'shadi; 300 ms taymer navbatni 500 tadan `POST /api/plans/exists-many` bilan yuboradi; javob kelganda qator imzosi o'zgarmagan bo'lsa `existing` yoziladi.
- [ ] **Step 4: Bo'lakli saqlash** — 200 tadan ketma-ket `/api/plans/batch`; holat `⏳ Saqlanmoqda… k/N`; bo'lak xatosida to'xtaydi, saqlanganlari chiqariladi, qolganlariga `saveError`.
- [ ] **Step 5: Yuklash holati** — kompyuterdan yuklashda `⏳ k/N yuklandi · ~M daq qoldi`.
- [ ] **Step 6: Drive** — spec 4-bo'lim UI: holat (`GET /api/drive`), papka modali (email nusxalash), scan natija xabari, keyin `loadInbox()`.
- [ ] **Step 7: Brauzer tekshiruvi** — 600 fayl kompyuterdan: kadr < 100 ms (`performance.now` bilan `drawBulk` o'lchanadi), sahifalash, filtr bilan saqlash hisoblari, 600/600 saqlash; soxta Drive: papka tanlash, scan 600, ikkinchi scan 0, jadvalga olish; konsolda xato yo'q.
- [ ] **Step 8: Commit** — `feat(panel): fast bulk table, chunked save, Drive import UI`
