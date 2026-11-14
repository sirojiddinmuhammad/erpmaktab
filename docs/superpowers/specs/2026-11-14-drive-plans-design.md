# Rejalar fayllari Google Drive'dan; ommaviy yuklash tezligi — dizayn

Sana: 2026-11-14 · Branch: `feature/drive-plans`
Asos: `2026-11-10-plans-dashboard-design.md`, `2026-11-12-panel-inbox-subjects-theme-design.md`

## 1. Maqsad

Admin kanaldagi ~600 ta reja faylini kompyuterga ko'chirdi va dashboard'ga
tashladi — sahifa qotib qoldi. Sabablari (soxta serverda qayta yaratildi):

1. Ommaviy yuklash jadvali har fayl va har tekshiruvdan keyin **butunlay**
   qayta chiziladi; 600 qatorda (33 fan) bitta chizish 50–80 ms, har fayl
   uchun 2–3 marta — brauzer daqiqalab javob bermaydi.
2. Server bir saqlashda 300 dan ortiq qatorni rad etadi (`MAX_BATCH`).
3. Kompyuterdan yuklangan har fayl Telegram'ga yuboriladi (~1 fayl/soniya),
   600 ta fayl ≥ 10 daqiqa.

Admin fayllarni Google Drive papkasiga bir marta qo'yib, dashboard'dan olishni
xohlaydi.

### Muvaffaqiyat mezoni

- Drive papkasidagi 600 ta faylni dashboard'ga olish va saqlash sahifa
  qotmasdan, Telegram'ga yuklamasdan amalga oshadi.
- Papka bir marta belgilanadi; keyingi safar faqat yangi fayllar chiqadi.
- Kompyuterdan 600 ta fayl tashlanganda ham sahifa javob berib turadi va
  hammasi bitta "Saqlash" bilan saqlanadi.
- O'qituvchilarning import oqimi o'zgarmaydi (u rejalar bazasidan foydalanmaydi;
  mavzularni birlashtirish yuklab olingan faylda ishlaydi).
- `BOT_TOKEN`, `ENC_KEY` ga tegilmaydi; bazada mavjud ustun o'zgarmaydi.

### Doiradan tashqari (YAGNI)

- Botning Drive'ga **yozishi** (xizmat akkauntining oddiy Gmail Drive'ida joyi yo'q).
- Google Sheets (native) fayllar — faqat `.xls`/`.xlsx` olinadi.
- Eski (Telegram'dagi) rejalarni Drive'ga ko'chirish.
- Drive'dagi fayllarning mavjudligini fonda muntazam tekshirish.

## 2. Drive ulanishi

- Google Cloud xizmat akkaunti (service account). Admin bir marta: loyiha
  ochadi, Drive API yoqadi, xizmat akkaunti va JSON kalit yaratadi.
- Railway o'zgaruvchisi `GOOGLE_SA_KEY` — JSON kalitning to'liq matni
  (yoki uning base64 ko'rinishi; server ikkalasini qabul qiladi).
- Papka xizmat akkaunti email'iga **Ko'ruvchi (Viewer)** sifatida ulashiladi.
- Yangi npm paket yo'q: kirish tokeni `node:crypto` bilan RS256 JWT imzolab
  `https://oauth2.googleapis.com/token` dan olinadi
  (scope `https://www.googleapis.com/auth/drive.readonly`), xotirada muddati
  tugashidan 60 soniya oldingacha saqlanadi. Drive v3 REST — `fetch` orqali.
- `GOOGLE_SA_KEY` yo'q yoki buzuq bo'lsa: Drive tugmalari "Drive ulanmagan"
  holatini ko'rsatadi, boshqa hamma narsa ishlayveradi.

Modul `dashboard/drive.js`:

- `createDrive({ key, fetch = globalThis.fetch, now = Date.now })` →
  `{ email, folderInfo(id), listXlsx(folderId), download(fileId) }`
  - `folderInfo(id)` → `{ id, name }`; papka bo'lmasa yoki ruxsat yo'q — xato `DRIVE_NO_ACCESS`.
  - `listXlsx(folderId)` → ichki papkalar bilan (BFS, ko'pi bilan 2000 fayl,
    50 papka), `trashed = false`, nomi `.xls`/`.xlsx`:
    `[{ id, name, size, modifiedTime, path }]` (`path` — ichki papka nomi, masalan "2-chorak").
  - `download(fileId)` → `Buffer`; topilmasa `DRIVE_NOT_FOUND`.
- `parseFolderId(urlOrId)` — `drive.google.com/drive/folders/<id>`,
  `...?id=<id>` yoki xom id → id; aks holda `null`.

## 3. Saqlash

- Reja Drive fayliga bog'lanadi: `plans.file_id = 'drive:' + <driveFileId>`.
  Mavjud ustun ishlatiladi, sxema o'zgarmaydi.
- Barcha fayl yuklab olish joylari `fetchPlanFile(fileId)` orqali o'tadi:
  `drive:` bilan boshlansa — `drive.download`, aks holda — Telegram (hozirgidek).
  - Dashboard: `deps.downloadFile` (ko'rish, yuklab olish, `take`).
  - Bot: admin "📥 Faylni olish" (`a:pf:`) — `drive:` bo'lsa fayl yuklab olinib
    `InputFile(buf, file_name)` bilan yuboriladi.
- Drive'da fayl topilmasa: dashboard'da `404 {"error":"drive"}` →
  "Fayl Drive'da topilmadi (o'chirilgan yoki ulashish bekor qilingan)";
  botda o'sha matn.
- Tanlangan papka `meta` jadvalida: `drive_folder_id`, `drive_folder_name`
  (`insert ... on conflict (key) do update`).

## 4. "Drive'dan olish" oqimi

Kiruvchi fayllar (inbox) oqimi qayta ishlatiladi — Drive fayllari ham
`plan_inbox` ga tushadi va mavjud "Jadvalga olish" / "Kerak emas" bilan ishlanadi.

1. Ommaviy yuklash tabida **☁️ Drive'dan olish** tugmasi (inbox bloki yonida).
   - Drive ulanmagan bo'lsa — tugma o'rnida "Drive ulanmagan" va qisqa yo'riqnoma havolasi.
   - Papka tanlanmagan bo'lsa — modal: papka havolasi maydoni, xizmat akkaunti
     email'i (nusxalash tugmasi bilan) va "papkani shu email'ga Ko'ruvchi qilib
     ulashing" eslatmasi. Saqlashda `folderInfo` bilan tekshiriladi.
   - Papka bor bo'lsa — tugma yonida `📁 <papka nomi>` va **Papkani o'zgartirish**.
2. Tugma bosilganda `POST /api/drive/scan`: papka ro'yxati olinadi va har bir
   fayl uchun, agar quyidagilarning hech biri bo'lmasa, inbox'ga qo'shiladi:
   - `plans` da `file_id = 'drive:<id>'` (arxivlangan ham) bor;
   - `plan_inbox` da `file_unique_id = 'drive:<id>'` (istalgan holatda — kutilayotgan,
     olingan yoki "kerak emas") bor;
   - hajmi 5 000 000 baytdan katta (bu `tooBig` ga sanaladi).
   Inbox yozuvi: `file_id = file_unique_id = 'drive:<id>'`, `file_name`, `file_size`,
   `caption = path` (ichki papka nomi — taxmin uchun, masalan "2-chorak"),
   `source = 'Google Drive'`, `posted_at = modifiedTime`.
   Javob: `{ found, added, known, tooBig, folder: { id, name } }`.
3. Natija xabari: `☁️ Drive: 612 ta fayl, 598 tasi yangi kiruvchiga qo'shildi
   (14 tasi avval olingan)`. Keyin admin **Jadvalga olish** ni bosadi.

`addInbox` ga `{ unique: 'any' }` imkoniyati qo'shiladi: takror tekshiruvi
kutilayotganlar emas, barcha inbox yozuvlari bo'yicha (Drive uchun). Forward
qilingan Telegram fayllari uchun hozirgi qoida (faqat kutilayotganlar) qoladi.
Bir martada qo'shish — bitta `insert ... select ... from unnest(...)` so'rovi.

## 5. Ommaviy yuklash tezligi

Brauzer:

- **Chizishni yig'ish:** `renderBulk()` to'g'ridan-to'g'ri chizmaydi —
  `requestAnimationFrame` bilan bitta kadrga yig'iladi (bir kadrda ko'pi bilan bir chizish).
- **Sahifalash:** jadval 100 qatordan ko'rsatiladi (filtr va tartiblashdan keyin),
  pastda `‹ 1/7 ›`. Saqlash tugmasi hisobi va "ko'rinayotganlar" qoidasi
  **filtrga mos barcha qatorlar** bo'yicha (sahifa emas).
- **Mavjudlik tekshiruvi to'plami:** har qator uchun alohida `GET /api/plans/exists`
  o'rniga navbat 300 ms da bir `POST /api/plans/exists-many { keys }` bilan
  yuboriladi (bitta so'rovda ko'pi bilan 500 kalit).
- **Saqlash bo'laklari:** "Saqlash" qatorlarni 200 tadan bo'lib ketma-ket yuboradi,
  holat `⏳ Saqlanmoqda… 400/612`; natija hammasi bo'yicha jamlanadi.
- **Kompyuterdan yuklash:** hozirgidek ketma-ket (Telegram cheklovi); holatda
  `⏳ 37/600 yuklandi` va taxminiy qolgan vaqt.

Server:

- `POST /api/plans/exists-many { keys: [{ grade, subject, quarter, year, medium, grading }] }`
  → `{ existing: number[] }` (mavjud kalitlar indekslari). Bitta so'rov:
  `select ... from plans join unnest(...)`. Ko'pi bilan 500 ta, aks holda 400.
- `take`: fayllar 4 tadan parallel yuklab olinadi (Drive va Telegram uchun).

## 6. API (yangi)

| Usul | Yo'l | Vazifa |
|---|---|---|
| GET | `/api/drive` | `{ configured, email, folder: {id,name}\|null }` |
| POST | `/api/drive/folder` | `{ url }` → `{ id, name }`; ruxsat yo'q → `400 {"error":"Papka ochilmadi: ..."}` |
| POST | `/api/drive/scan` | 4-bo'lim |
| POST | `/api/plans/exists-many` | 5-bo'lim |

Hammasi mavjud sessiya va `Origin` tekshiruvidan o'tadi.

## 7. Xatolar

- Google token olinmadi / Drive 5xx → `502 {"error":"drive"}`, UI: "Google Drive javob bermadi, qayta urining".
- Scan paytida 2000 dan ortiq fayl — birinchi 2000 tasi olinadi, javobda `truncated: true`, UI ogohlantiradi.
- Drive xatolari logga `[drive]` bilan; kalit matni hech qachon logga yozilmaydi.

## 8. Sinov

- `node:test`:
  - `parseFolderId` (havola turlari, noto'g'ri qiymat);
  - `createDrive` soxta `fetch` bilan: JWT so'rovi to'g'ri tuzilgan (`aud`, `scope`,
    RS256 imzosi test kaliti bilan tekshiriladi), token keshlanadi, ichki papkalar
    bo'yicha ro'yxat, `.xlsx` filtri, `download` 404 → `DRIVE_NOT_FOUND`;
  - `fetchPlanFile` yo'naltirishi (`drive:` / Telegram);
  - `/api/drive*`: sozlanmagan holat, papka saqlash, scan (yangi / avval olingan /
    katta fayl), Origin;
  - `/api/plans/exists-many` (500 dan ortiq → 400);
  - `take` 4 tadan parallel, bitta xato qolganlarini to'xtatmaydi (mavjud test).
- PGlite: `addInbox({ unique: 'any' })` va ommaviy qo'shish, `existsMany`, `meta` yozuvi.
- Soxta serverda brauzer: 600 ta fayl (kompyuterdan va soxta Drive'dan) — sahifa
  javob beradi (bitta kadr < 100 ms), sahifalash, bo'lakli saqlash 600/600.
- Production: admin kalitni Railway'ga qo'ygandan keyin haqiqiy papka bilan
  admin o'zi sinaydi; `main` ga merge admin roziligi bilan.
