# Avtomatik import (sinov bosqichi, brauzersiz) — dizayn

Sana: 2026-11-14 · Branch: `feature/auto-import` · Holat: ko'rib chiqilmoqda
Asos: `2026-11-10-plans-dashboard-design.md` (rejalar bazasi), `2026-11-14-drive-plans-design.md` (`fetchPlanFile`)

## 1. Maqsad

Hozir o'qituvchi har sinf × fan uchun ish reja faylini o'zi topadi, botga yuboradi
va har birini alohida import qiladi. Admin barcha fanlar bo'yicha rejalar bazasini
to'ldirib bo'ldi. Endi bot o'qituvchining eMaktab'idagi sinf × fanlarini o'zi
aniqlab, bazadan mos rejalarni olib, hammasini bir tasdiq bilan import qilishi kerak.

Bu **1-bosqich — sinov**: faqat admin va sinovchilar (birinchisi — adminning
onasi) uchun, bepul. 2-bosqich (hammaga ochish va to'lov) — alohida spec.

### Muvaffaqiyat mezoni

- Sinovchi `/auto` yozadi → sinf × fanlar va topilgan rejalar ro'yxatini ko'radi →
  "Tasdiqlash" → bir necha daqiqada hammasi eMaktab'ga import qilinadi va
  natija xabari keladi.
- Har bir sinf × fan importi eMaktab'da qo'lda import bilan bir xil natija beradi
  (mavzu, uy vazifasi, dars raqami to'g'ri joyda).
- Pul kodiga (`chargeImport`, `go` callback, balans, obuna) umuman tegilmaydi.
- Oddiy o'qituvchilarning hozirgi qo'lda import oqimi o'zgarmaydi.

### Maqsad emas (YAGNI)

- To'lov, narx, obuna bilan bog'lash (2-bosqich).
- Hammaga ochish, menyu tugmasi.
- Qo'lda importni HTTP'ga ko'chirish (keyin, alohida).
- Login'ni HTTP'ga ko'chirish — login Playwright'da qoladi (captcha, FingerprintId, 2FA).
- Ish holatini bazada saqlash (deploy paytida yarim qolgan ish yo'qoladi — sinov uchun yetarli).

### Anti-maqsad (texnik ishlasa ham muvaffaqiyatsizlik)

- O'qituvchi tasdiqlamagan sinf × fanga import ketishi.
- Noto'g'ri sinf/fan/chorakka reja tushishi (masalan rus guruhiga o'zbekcha reja).
- Sinovchi bo'lmagan o'qituvchi `/auto` ni ishlata olishi.
- Avtomatik ish bot javobini boshqa o'qituvchilar uchun ushlab qolishi.

## 2. Cheklovlar

- CLAUDE.md: `BOT_TOKEN`, `ENC_KEY` ga tegilmaydi; migratsiya faqat
  `ADD COLUMN IF NOT EXISTS`; `DELETE/DROP/TRUNCATE` yo'q; `W` lug'ati o'zgarmaydi
  (faqat o'qiladi va qayta ishlatiladi).
- Pul faqat `go` callbackda yechiladi — avtomatik import umuman yechmaydi.
- grammY yangilanishlarni ketma-ket ishlaydi → uzoq ish fonda (`await` siz) bajariladi.
- Yangi npm paket yo'q (HTML regex va `fetch` bilan o'qiladi).
- Sinov haqiqiy akkaunt va haqiqiy jurnalda bo'ladi.

## 3. Yondashuvlar

| | Yondashuv | Yutuq | Kamchilik |
|---|---|---|---|
| A | Har sinf × fan uchun hozirgi Playwright qadamlarini qayta ishlatish | Hamma qadam, oxirgi "Импортировать" ham, production'da sinalgan | Sekin (30–60 s/ta), 2000 o'qituvchida server og'ir |
| **B** | **Login — Playwright; qolgani oddiy HTTP so'rovlar** | **Tez (bir necha soniya/ta), yengil, hammaga ochishga tayyor** | **Yangi kod; oxirgi import so'rovi hali hech yuborilmagan** |
| C | Aralash: ko'rish HTTP, import Playwright | — | Ikki tizim, ikki xil xato; tashlandi |

**Admin B ni tanladi.** B ning xavfi (oxirgi qadam sinalmagan) 8-bo'limdagi
bosqichma-bosqich ishga tushirish bilan kamaytiriladi.

## 4. Oqim (sinovchi ko'zi bilan)

1. `/auto` (yashirin; menyuda yo'q). Ruxsat: `ADMIN_ID` yoki `AUTO_TESTERS`
   (Telegram ID'lar, vergul bilan) ichida. Boshqalarga bot oddiy "noma'lum buyruq"
   javobini beradi (buyruq borligi bilinmaydi).
2. Akkaunt ulanmagan bo'lsa — hozirgi "Kirish" oqimiga yo'naltiriladi.
3. Bot eMaktab'ga kiradi (6-bo'lim) va xabar beradi: `⏳ Sinflaringiz o'qilmoqda…`
4. Birinchi marta 5–11-sinflar bo'lsa va maktab BSB bo'yicha ishlashi noma'lum bo'lsa,
   bir marta so'raladi: **"Maktabingizda 5–11-sinflar BSB (baholash) bo'yichami?"
   [Ha] [Yo'q]**. Javob akkauntda saqlanadi, keyin so'ralmaydi. 1–4-sinflar doim `normal`.
5. Ko'rib chiqish xabari:

   ```
   🤖 Avtomatik import · 2-chorak · 2026/2027
   1. 5-A · Ona tili — ✅ reja bor (34 mavzu)
   2. 5-A · Adabiyot — ✅ reja bor (17 mavzu)
   3. 7-Б · Русский язык — ✅ reja bor (34 mavzu)
   4. 9-A · Tarbiya — ❌ bazada reja yo'q
   Import qilinadi: 3 ta. Mavjud mavzular almashtiriladi.
   [✅ Tasdiqlash] [📅 Chorakni o'zgartirish]
   [👥 Guruhni o'zgartirish] [☑️ Tanlov] [✖️ Bekor]
   ```

   - **Chorakni o'zgartirish** → 1–4 tugmalar; ro'yxat qayta hisoblanadi.
   - **Guruhni o'zgartirish** → raqam so'raladi ("qaysi qator?"), keyin o'sha sinfning
     guruhlari (`Весь класс` + kichik guruhlar) tugma bo'lib chiqadi. Standart — `Весь класс`.
   - **Tanlov** → har qator uchun ✅/⬜ almashtiruvchi tugmalar, keyin "Tayyor".
6. Tasdiqlangach: `⏳ Import boshlandi: 3 ta. Tugagach xabar beraman.` — ish fonda.
   Bot bu orada boshqa so'rovlarga javob beradi.
7. Har sinf × fan uchun natija yig'iladi, oxirida bitta xabar:

   ```
   ✅ 5-A · Ona tili — 34/34 import qilindi
   ✅ 7-Б · Русский язык — 34/34
   ⚠️ 5-A · Adabiyot — 17 mavzudan 2 tasi xato (dars soni yetmaydi)
      [Birlashtirish] [Ortiqchasiz import] [O'tkazib yuborish]
   ```

   Xato qatorlari bo'lgan sinf × fan **import qilinmaydi** — o'qituvchi tanlaguncha kutadi:
   - **Birlashtirish** — hozirgi `parsePairs`/`applyMerges` matn oqimi
     ("12+13, 20+21"), keyin o'sha sinf × fan qaytadan ko'rib chiqiladi;
   - **Ortiqchasiz import** — faqat "tayyor" qatorlar import qilinadi (xato qatorlar `=0`);
   - **O'tkazib yuborish** — import qilinmaydi.
8. Admin'ga qisqa hisobot: kim, nechta ✅/⚠️/❌, xatolar matni.

## 5. Moslash (sinf × fan → reja)

Har eMaktab sinf × fan uchun reja kaliti
`(grade, subject_key, quarter, year, medium, grading)`:

- **grade** — sinf nomidagi raqam (`"5-A"` → 5, `"11-В"` → 11). Raqam o'qilmasa — ❌ qator.
- **subject_key** — eMaktab fan nomidan `guessSubject(name, keyOf, liveSubjectKeys())`
  (bot va dashboard ishlatayotgan o'sha funksiya, arxivlanganlar chiqarilgan).
- **medium** — o'qituvchidan **bir marta** so'raladi: "Qaysi tilda dars berasiz?
  [O'zbekcha] [Ruscha] [Ikkalasi]" (`accounts.auto_medium`: `'uz'|'ru'|'both'`).
  `uz`/`ru` — barcha sinflarga shu til. `both` — har sinf standart `uz`, ko'rib
  chiqishda har sinf qatorida "🇺🇿/🇷🇺" almashtirish tugmasi.
  (eMaktab fan nomlari interfeys tilida keladi va sinf sahifasida o'qitish tili yo'q —
  fan nomidan aniqlash ishonchsiz; Task 1 topilmasi, admin qarori.)
- **quarter** — sanadan (`quarterOfDate`, Toshkent vaqti), o'qituvchi o'zgartira oladi.
- **year** — `schoolYearOfDate`.
- **grading** — 1–4 `normal`; 5–11 akkauntdagi BSB javobi.
- Topish: `db.findPlanByKey(...)` (arxivlanmagan). Topilmasa — ❌ "bazada reja yo'q".

## 6. eMaktab bilan HTTP ishlash — `emaktab-http.js` (yangi)

### Kirish

- `accounts.storage_state` 12 soatdan yangi bo'lsa — undagi `schools.emaktab.uz`
  cookie'lari olinadi. Aks holda `EmaktabSession.login()` (Playwright), so'ng
  `storageState()` saqlanadi va cookie'lar olinadi. 2FA chiqsa — hozirgi
  `askTwoFactor` oqimi; tasdiqlangach `/auto` davom etadi.
- `createEmaktabHttp({ cookies, fetch })` — cookie jar (javobdagi `set-cookie`
  qo'shiladi), `redirect: 'manual'`; login sahifasiga yo'naltirsa → `SESSION_EXPIRED`
  xatosi → bir marta Playwright bilan qayta kirib, davom etadi.
- Har so'rovga 30 s timeout. Texnik ishlar sahifasi → hozirgi `MAINTENANCE` xatosi.

### Sinf × fanlar

- `listClassSubjects()` → `{ school, periodId, classes: [{ groupId, className, subjects: [{ id, name }] }] }`.
  Manba: `GET /v2/myclasses` — sinf havolasi `/v2/class?class=<groupId>` (matni — sinf nomi)
  va keyingi fan havolalari `/journal/school/<school>/group/<groupId>/subject/<subjectId>?periodId=<id>`
  (`title` — fan nomi). Fayl yuklash shart emas (Task 1 topilmasi).
- Kichik guruhlar: `getsubgroups-cmd?group=`; choraklar: `getperiods-cmd?group=`
  (nomi "2 четверть" / "2-chorak" → raqam).

### Bitta sinf × fanni import qilish — `importOne(job)`

1. `GET /v2/journals/planning/import` → `__RequestVerificationToken`.
   Import holatsiz (fayl yashirin `file` maydonida yuradi) — "osilib qolgan import" yo'q.
2. **1-qadam:** multipart POST: token, `multifile1` (reja fayli), `firstRow=0`, `step1`
   → javobdan yashirin `file=storage:///…`.
3. **2-qadam:** urlencoded POST: `year, group, subject, subgroup ('' = Весь класс),
   period, select_0..N, file, step2`. `select_i` (−1 o'tkazish, 0 dars raqami,
   1 mavzu, 2 uy vazifasi) — eMaktab moslash jadvalida ustun nomi bo'sh keladi, shuning
   uchun ustunlar **faylning o'z sarlavha qatoridan** `COLUMN_RULES` bilan aniqlanadi;
   topilmasa tartib bo'yicha (raqam, mavzu, vazifa) — sof funksiya
   `mapColumnsFromHeaders(headers)`. `select_i` soni 2-qadam sahifasidan olinadi.
4. **Ko'rib chiqish:** 3-qadam jadvali `previewFromHtml(html)` bilan o'qiladi —
   hozirgi `preview()` qoidalari (holat faqat o'z ustunidan, `W.ready`/`W.error`,
   "Импортируемая тема урока заменит текущую…" ogohlantirish — xato emas).
   Har qatorda `rowId` (`select=<rowId>=1|0`).
5. Xato qatorlar bo'lsa — to'xtaydi, natija `{ state: 'needs_choice', rows }`.
6. **Import:** hamma qator tayyor (yoki "Ortiqchasiz" tanlangan) bo'lsa — token +
   har qator `select` + `step3=Импортировать >` POST.
7. **Natijani tekshirish:** javob sahifasidan muvaffaqiyat belgisi o'qiladi; noaniq bo'lsa
   rejalashtirish sahifasidan o'sha sinf × fan × chorak mavzular soni olinadi va
   kutilgan son bilan solishtiriladi. Mos kelmasa — ⚠️ "tekshirib ko'ring" va admin'ga log.

Barcha HTML o'qish sof funksiyalar (`parseToken`, `parseHidden`, `parseMyClasses`,
`mapColumnsFromHeaders`, `previewFromHtml`, `parseImportResult`) — haqiqiy sahifa
nusxalaridan olingan test fixture'lari bilan sinaladi.

## 7. Fon ishi

- `auto/runner.js`: `startRun(tgId, items)` — xotirada; bitta o'qituvchiga bir vaqtda
  bitta ish (ikkinchi `/auto` → "Avvalgi import davom etyapti").
- Global navbat `AUTO_CONCURRENCY` (standart 2) — bir vaqtda nechta o'qituvchi ishi.
- O'qituvchi ichida sinf × fanlar ketma-ket (eMaktab importi bitta "ochiq import" holatiga ega).
- Har element: `fetchPlanFile(plan.file_id)` → vaqtinchalik fayl → `importOne` → fayl o'chiriladi.
- Bir element xatosi qolganlarini to'xtatmaydi.
- `needs_choice` elementlar xotirada 2 soat saqlanadi; tugmalar shu vaqtda ishlaydi.
- Loglar `[auto]` bilan; parol, cookie, token logga yozilmaydi.

## 8. Ishga tushirish tartibi (B xavfini kamaytirish)

0. **O'qish sinovi** (sinovchi akkauntida, import yo'q): login → sinf × fanlar →
   bitta reja bilan 1–2-qadam → ko'rib chiqish jadvali → import bekor qilinadi.
   Haqiqiy HTML nusxalari fixture sifatida saqlanadi (shaxsiy ma'lumotlar olib tashlanib).
1. Admin roziligi bilan **bitta** sinf × fan haqiqiy import — bot o'zi qiladi.
   Admin va sinovchi eMaktab'da natijani ko'radi (mavzu, uy vazifasi, dars raqami).
2. Hammasi to'g'ri bo'lsa — qolgan sinf × fanlar.

(Admin qarori: oxirgi qadamsiz "quruq" sinov bosqichi tashlab ketildi —
o'qish sinovidan keyin darrov bitta haqiqiy import.)

Himoya: `AUTO_MAX_ITEMS` Railway o'zgaruvchisi (standart **1**) — bitta `/auto`
ishida ko'pi bilan nechta sinf × fan import qilinadi. Ko'p bo'lsa, ro'yxatda
birinchi N tasi belgilangan bo'ladi, qolganlari ⬜ (Tanlov bilan almashtirish mumkin).
Birinchi import tekshirilgach admin uni oshiradi (masalan 50).

## 9. Ma'lumotlar bazasi

- `alter table accounts add column if not exists auto_grading text;` — 5–11 uchun
  `'bsb'|'normal'|null`.
- `alter table accounts add column if not exists auto_medium text;` — `'uz'|'ru'|'both'|null`.
- Boshqa sxema o'zgarishi yo'q. Pul jadvallari (`ledger`, `balance`, `free_used`,
  `imports_ok`) o'zgarmaydi.

## 10. Xatolar

| Holat | Xabar |
|---|---|
| Sinovchi emas | oddiy "noma'lum buyruq" |
| Akkaunt ulanmagan | hozirgi kirish taklifi |
| 2FA | hozirgi "Shu linkga kirib, tasdiqlang" oqimi |
| Texnik ishlar | hozirgi `maintenance` matni |
| Reja fayli olinmadi (Drive/Telegram) | ❌ qatorda "reja fayli olinmadi" |
| eMaktab kutilmagan sahifa | ❌ qatorda qisqa sabab; admin'ga sahifa matnining boshi |

## 11. Sinov

- `node:test`: ruxsat (`ADMIN_ID`, `AUTO_TESTERS`); moslash (sinf raqami, fan,
  til, chorak, BSB); HTML sof funksiyalar fixture'larda; `importOne` soxta `fetch`
  bilan (1→2→3 qadam, xato qatorlar → `needs_choice`, `AUTO_MAX_ITEMS` chegarasi,
  `SESSION_EXPIRED` → bir marta qayta kirish); runner (bir o'qituvchiga bitta ish,
  `AUTO_CONCURRENCY`, bitta xato qolganlarini to'xtatmaydi); `chargeImport`
  chaqirilmasligi.
- PGlite: `auto_grading`, `auto_medium` ustunlari va o'qish/yozish.
- Production: 8-bo'limdagi tartib, admin ishtirokida.

## 12. Quruvchiga qoldirilganlar (o'z qarorim)

- Modul nomlari va fayl tuzilishi.
- Matnlar `i18n.js` da uz/ru.
- Ko'rib chiqish xabari uzun bo'lsa bo'laklarga bo'lish (hozirgi `sendChunks`).
- Muvaffaqiyatni tekshirish usuli (6-bo'lim, 7-qadam) 0-qadamdagi haqiqiy sahifaga qarab tanlanadi.

## 13. 2-iteratsiya (2026-11-14, admin qarori): avval tekshiruv, bittadan hal qilish, bitta import

Birinchi haqiqiy sinovdan keyin (10 ta sinf × fanda xato qatorlar bir paytda, mavzular
ro'yxatisiz chiqdi) oqim o'zgaradi:

1. **Tekshiruv.** `/auto` → har rejali sinf × fan eMaktab'ga yuklanib, faqat ko'rib chiqish
   jadvali o'qiladi (`importOne({ checkOnly: true })`, `step3` yuborilmaydi). Jonli xabar
   "⏳ Tekshirilmoqda… 5/19". Natija elementda: `total`, `ok`, `bad`, `existing`, `rows`.
2. **Mavjud mavzular.** Holatida "Импортируемая тема урока заменит текущую" bo'lgan qatorlar
   (`<ul class="alerts">`, 2026-11-14 da 4-A Воспитание'da ko'rilgan) — `existing`. `existing > 0`
   bo'lsa element **belgilanmaydi**, ro'yxatda "📝 mavzular bor (7/7)" yoki "qisman bor (3/6)".
   O'qituvchi Tanlov bilan belgilashi mumkin. (O'zbekcha interfeys matni hali ko'rilmagan.)
3. **Ro'yxat:** ✅ tayyor (N/N) · ⚠️ N mavzu, M dars · 📝 mavzular bor · ❌ sabab.
   Tugmalar: Davom etish / Chorak / Guruh / Tanlov / Bekor. Chorak yoki guruh o'zgarsa —
   qayta tekshiriladi.
4. **Bittadan hal qilish.** Belgilangan ⚠️ elementlar navbat bilan, mavzular ro'yxati bilan
   (xato qatorlar ⚠️ va sababi): Birlashtirish / Ortiqchasiz / O'tkazib yuborish. Birlashtirilgan
   fayl qayta **tekshiriladi**; xato qolsa — o'sha element yana. Ortiqchasiz va O'tkazib yuborish —
   faqat qaror, darhol keyingisi.
5. **Xulosa va import.** "N ta import qilinadi, K tasi o'tkazib yuborildi, E tasida mavzular
   almashtiriladi" → **Tasdiqlash** → bitta jonli jarayon xabari bilan import (tekshiruvdagi
   fayllar qayta ishlatiladi). Import paytida yana xato chiqsa (eMaktab o'zgargan) — ❌ va
   "qayta /auto".
