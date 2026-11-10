# Rejalar bazasi dashboardi — dizayn

Sana: 2026-11-10 · Branch: `feature/plans-dashboard` · Holat: ko'rib chiqilmoqda

## 1. Maqsad

Admin har chorak boshida ish rejalar bazasini (`plans` jadvali) tez to'ldira
olishi kerak. Hozir bu faqat Telegram bot ichida, har fayl uchun bir nechta
tugma bosib qilinadi — ko'p faylda noqulay.

Dashboard — kompyuter brauzerida ochiladigan web sahifa:

- rejalarni ko'rish, filtrlash, yuklab olish, almashtirish, arxivlash;
- qaysi sinf × fan uchun reja yetishmayotganini ko'rish (qamrov);
- ko'p faylni birdan yuklash, sinf/fan/BSB fayl nomidan avtomatik taxmin.

Bu uch bosqichli ishning 1-bosqichi:

1. **Rejalar bazasi dashboardi** — shu hujjat.
2. Avtomatik import (yashirin `/` buyrug'i, faqat sinovchilar uchun) — alohida spec.
3. Admin menyusi (`/admin` siz tugmalar) — alohida spec.

### Muvaffaqiyat mezoni

- 30 ta faylni bir chorak uchun 5 daqiqadan kam vaqtda yuklash mumkin.
- Yuklangan reja botning mavjud oqimlarida (admin "Rejalar bazasi",
  keyinchalik avtomatik import) hech qanday o'zgarishsiz ishlaydi.
- Dashboard'ga faqat `ADMIN_ID` kira oladi.
- Hech qanday ma'lumot butunlay o'chirilmaydi.

### Doiradan tashqari (YAGNI)

- Fanlar lug'atini tahrirlash (botda qoladi).
- Bir nechta admin, rollar.
- Telegram Mini App versiyasi.
- Fayl ichini tahrirlash (mavzularni o'zgartirish).

## 2. Yondashuv

Mavjud Railway servisi ichidagi Node HTTP serveriga yangi yo'llar qo'shiladi.
Bu server hozir `guide.html` va `/health` ni beradi (`bot.js`, `PORT`).
Interfeys — bitta oddiy HTML + vanilla JS fayl, qurish bosqichi yo'q,
yangi npm paket yo'q.

Rad etilgan variantlar:

- Alohida servis (Next.js va h.k.) — ikkinchi deploy, qo'shimcha xarajat,
  bitta admin uchun ortiqcha.
- NocoDB/Retool kabi tayyor vosita — Telegram'ga fayl yuklab `file_id`
  ololmaydi, production bazaga to'g'ridan-to'g'ri yozadi.

## 3. Kirish (autentifikatsiya)

1. Admin botga `/panel` yozadi. Buyruq faqat `ctx.from.id === ADMIN_ID`
   uchun ishlaydi; boshqalarga javob yo'q.
2. Bot tasodifiy token (32 bayt, hex) yaratadi va havola yuboradi:
   `https://<RAILWAY_PUBLIC_DOMAIN>/panel/login?t=<token>`.
   Token 10 daqiqa amal qiladi va bir marta ishlatiladi.
3. `/panel/login` tokenni tekshiradi, o'chiradi va sessiya yaratadi:
   cookie `sid` (32 bayt hex), `HttpOnly; Secure; SameSite=Lax; Path=/`,
   muddati 7 kun. Keyin `/panel` ga yo'naltiradi. Token URL'dan darhol
   yo'qoladi (redirect).
4. `/panel` va `/api/*` dagi har so'rov `sid` ni tekshiradi; yo'q yoki
   eskirgan bo'lsa — `401` (API) yoki "Botga /panel yozing" sahifasi.
5. Token va sessiyalar **xotirada** (`Map`) saqlanadi. Deploy yoki qayta
   ishga tushishda sessiya tushadi — admin `/panel` ni qayta yozadi.
   Servis 1 nusxada ishlaydi, shuning uchun bu yetarli.
6. "Chiqish" tugmasi sessiyani o'chiradi.

Yangi maxfiy kalit yoki muhit o'zgaruvchisi kerak emas. `BOT_TOKEN` va
`ENC_KEY` ga tegilmaydi.

`/api/*` dagi o'zgartiruvchi so'rovlar (`POST`) qo'shimcha ravishda
`Origin` sarlavhasi o'z domenimizga tengligini tekshiradi (CSRF himoyasi).

## 4. Sahifalar

### 4.1 Rejalar (ro'yxat)

- Tepada 4 ta raqam: jami rejalar, tanlangan chorakdagi rejalar,
  yetishmaydiganlar soni (qamrovdan), arxivdagilar.
- Filtrlar: yil, chorak, til (uz/ru), sinf, fan, baholash
  (oddiy / BSB / hammasi), matn qidiruv (fayl nomi va fan nomi bo'yicha).
  Filtr qiymatlari URL'da (`?year=...&quarter=...`) — sahifani yangilasa
  saqlanadi.
- Jadval: sinf, fan, chorak, til, baholash, mavzular soni, yuklangan sana,
  amallar. Sahifalash: 50 tadan.
- Amallar:
  - **Ko'rish** — fayldagi mavzular ro'yxati (raqam, mavzu, uy vazifasi)
    modal oynada. Faqat `.xlsx` uchun; `.xls` da "ko'rish mumkin emas,
    yuklab oling".
  - **Yuklab olish** — server faylni Telegram'dan olib, asl nomi bilan
    beradi.
  - **Almashtirish** — bitta fayl tanlanadi, o'sha kalit (sinf, fan,
    chorak, yil, til, baholash) uchun `file_id` yangilanadi.
  - **Arxivlash** — tasdiqlash so'raladi, `archived_at = now()`.
- "Arxiv" filtri yoqilsa arxivdagi rejalar ko'rinadi, ularda
  **Qaytarish** tugmasi bor (`archived_at = null`).

### 4.2 Qamrov

- Filtr: yil, chorak, til, baholash (bittadan tanlanadi).
- Sinf (1–11) × fan jadvali. Katakda: reja bor bo'lsa — mavzular soni
  (yashil), yo'q bo'lsa — "yo'q" (sariq), bu sinfda fan o'qitilmasa — "·".
- **"Kutilgan" juftlik** qanday aniqlanadi: (sinf, fan) juftligi uchun shu
  til va baholashda bazada istalgan yil yoki chorakda kamida bitta
  arxivlanmagan reja bo'lsa — bu juftlik kutiladi. Kutilgan, lekin
  tanlangan yil+chorakda yo'q bo'lsa — "yo'q".
- Bo'sh katak bosilsa — Ommaviy yuklash sahifasi shu sinf/fan/chorak
  bilan oldindan to'ldirilgan holda ochiladi.

### 4.3 Ommaviy yuklash

1. Tepada standart qiymatlar: yil (standart — joriy o'quv yili,
   `admin.currentYear()`), chorak, til, baholash.
2. Fayllar sudrab tashlanadi yoki tanlanadi. Faqat `.xls`/`.xlsx`,
   har biri ≤ 5 MB; boshqalari ro'yxatda "qabul qilinmadi" bilan ko'rinadi.
3. Har fayl **ketma-ket** (bir vaqtda 1 ta) serverga yuboriladi:
   `POST /api/files` (3.5 ga qarang). Server javobi: taxminlar,
   mavzular soni va `file_id`.
4. Jadvalda har qator: fayl nomi, sinf (tanlov), fan (tanlov), BSB
   (belgi), mavzular soni, holat.
   Holat: 🆕 yangi · 🔄 mavjud rejani almashtiradi · ⚠️ sinf yoki fan
   tanlanmagan · ❌ yuklashda xato.
   "Almashtiradi" holati sinf/fan/BSB o'zgarganda qayta tekshiriladi
   (`GET /api/plans/exists`).
5. Ikki qator bir xil kalitga tushsa — ikkalasi ⚠️ "takror" bilan
   belgilanadi va saqlanmaydi, admin birini o'zgartirmaguncha.
6. "N ta rejani saqlash" — faqat to'liq va takror bo'lmagan qatorlar
   `POST /api/plans/batch` bilan saqlanadi. Natija: nechtasi yangi,
   nechtasi almashtirildi, nechtasi o'tkazildi.

## 5. Fayl va Telegram

- Fayl brauzerdan serverga **xom tana** (`Content-Type:
  application/octet-stream`) sifatida keladi, fayl nomi
  `X-File-Name` sarlavhasida (URL-kodlangan). Multipart kutubxonasi kerak
  emas.
- Server faylni vaqtincha `/tmp/emaktab/` ga yozadi, so'ng:
  - taxmin: sinf — `parseFileName().grade`; fan — `bot.js` dagi
    `guessSubject` mantiqi (`admin.keyOfName` → `subjectKey`);
    BSB — `admin.guessGrading`; yil va chorak fayl nomida bo'lsa ular ham;
  - mavzular soni — `.xlsx` uchun `readRows().rows.length`, `.xls` uchun
    `null`;
  - Telegram'ga yuborish: `bot.api.sendDocument(PLANS_CHAT_ID || ADMIN_ID,
    InputFile, { disable_notification: true })`, javobdan `file_id`;
  - vaqtinchalik fayl o'chiriladi.
- `guessSubject` `bot.js` dan umumiy joyga (`hints.js`) ko'chiriladi,
  bot ham, dashboard ham shundan foydalanadi. Mantiq o'zgarmaydi.
- Telegram cheklovi: bitta chatga ~1 xabar/sekund. Ketma-ket yuklash va
  `429` javobida `retry_after` kutib qayta urinish shuni ta'minlaydi.
- Saqlanmagan fayllar Telegram chatida qolib ketadi — zararsiz.
- Yangi ixtiyoriy o'zgaruvchi `PLANS_CHAT_ID` — fayllar uchun alohida
  yopiq kanal. Bo'lmasa `ADMIN_ID` chatiga boradi. Kanal ishlatilsa, bot
  u yerda admin bo'lishi kerak.

## 6. Baza o'zgarishlari

CLAUDE.md qoidalariga mos: faqat `ADD COLUMN IF NOT EXISTS`, hech qanday
`DROP`/`DELETE`/`TRUNCATE`.

```sql
alter table plans add column if not exists archived_at timestamptz;
```

`db.js` dagi o'zgarishlar:

- `listPlans` — yangi filtrlar: `subjectKey`, `q` (qidiruv), `archived`
  (standart — faqat arxivlanmaganlar). Mavjud chaqiruvlar uchun xatti-harakat
  o'zgarmaydi (standart filtr arxivlanmaganlar, ular hozir hammasi).
- `savePlan` — `on conflict ... do update` ga `archived_at = null`
  qo'shiladi: arxivdagi kalitga yangi fayl yuklansa, reja qaytadi.
- Yangi: `archivePlan(id)`, `restorePlan(id)`, `coverage({year, quarter,
  medium, grading})`, `planStatsFull()`.
- Botdagi barcha reja so'rovlari (`gradingVariants`, `planExists`,
  `planYears`, `countPlans`, `planStats`) `archived_at is null` shartini
  oladi.
- **Botdagi 🗑 tugmasi** (`a:pd:` → `db.deletePlan`) arxivlashga
  o'tkaziladi: `db.archivePlan`. `deletePlan` funksiyasi koddan olib
  tashlanadi. Tugma matni "🗄 Arxivlash" bo'ladi.

## 7. API

Hammasi sessiya talab qiladi, JSON qaytaradi.

| Usul | Yo'l | Vazifa |
|---|---|---|
| GET | `/panel/login?t=` | token → sessiya, `/panel` ga redirect |
| POST | `/panel/logout` | sessiyani o'chirish |
| GET | `/panel` | `dashboard.html` |
| GET | `/api/meta` | fanlar ro'yxati (key, uz, ru), yillar, joriy yil |
| GET | `/api/plans` | ro'yxat + filtrlar + sahifalash |
| GET | `/api/stats` | tepadagi 4 raqam |
| GET | `/api/coverage` | qamrov jadvali |
| GET | `/api/plans/exists` | kalit bo'yicha mavjudlik |
| GET | `/api/plans/:id/topics` | mavzular ro'yxati (.xlsx) |
| GET | `/api/plans/:id/file` | faylni yuklab olish |
| POST | `/api/files` | fayl yuklash → taxmin + `file_id` |
| POST | `/api/plans/batch` | bir nechta rejani saqlash |
| POST | `/api/plans/:id/replace` | `{ fileId, fileName, topics }` |
| POST | `/api/plans/:id/archive` | arxivlash |
| POST | `/api/plans/:id/restore` | qaytarish |

Kiruvchi qiymatlar tekshiriladi: sinf 1–11, chorak 1–4, til `uz|ru`,
baholash `normal|bsb`, yil `YYYY/YYYY`, fan — mavjud fan kalitlaridan biri.
Noto'g'ri qiymat — `400` va tushunarli xabar.

## 8. Fayllar tuzilishi

- `dashboard.js` (yangi) — auth (token, sessiya, cookie), API
  yo'llari, so'rov tanasini o'qish. `export function handle(req, res)`:
  yo'l unga tegishli bo'lsa `true` qaytaradi.
- `dashboard.html` (yangi) — interfeys (3 tab, modal, yuklash).
  Yorug' va qorong'i rejim, kompyuter uchun mo'ljallangan.
- `bot.js` — HTTP serverda avval `dashboard.handle` chaqiriladi;
  `/panel` buyrug'i; 🗑 → arxiv; `guessSubject` `hints.js` ga ko'chadi.
- `db.js` — 6-bo'limdagi o'zgarishlar.
- `hints.js` — `guessSubject` shu yerga ko'chadi.

## 9. Xatolar

- Telegram'ga yuklash muvaffaqiyatsiz → qator ❌, sababi ko'rsatiladi,
  "Qayta urinish" tugmasi.
- Excel o'qilmadi → mavzular soni "—", qator baribir saqlanishi mumkin.
- Sessiya tugadi → interfeys "Sessiya tugadi, botga /panel yozing"
  xabarini ko'rsatadi; jadvaldagi kiritilgan ma'lumot yo'qolmaydi
  (sahifa yangilanmaydi).
- Server xatolari logga yoziladi (`[panel]` prefiksi bilan), foydalanuvchiga
  xom xato matni ko'rsatilmaydi.

## 10. Sinov

- **Avtomatik testlar** — Node'ning o'z `node:test` moduli (yangi paket
  yo'q), `npm test`:
  - token: bir martalik, 10 daqiqadan keyin yaroqsiz;
  - sessiya: 7 kundan keyin yaroqsiz, logout ishlaydi;
  - kiruvchi qiymatlarni tekshirish;
  - fayl nomidan taxmin (mavjud fayl nomlari namunalari bilan);
  - bir xil kalitli qatorlarni aniqlash.
- **Staging muhiti** — production bazaga test ma'lumot yozilmaydi:
  - Railway'da `staging` muhiti: alohida Postgres, alohida test bot
    (BotFather'dan yangi token — admin yaratadi), `ENC_KEY` — staging uchun
    yangi kalit (production kaliti emas).
  - Staging `feature/plans-dashboard` branchidan deploy qilinadi.
  - Qo'lda tekshiruv ro'yxati: kirish/chiqish; 30 ta fayl yuklash;
    almashtirish; arxivlash va qaytarish; qamrov jadvali; botdagi
    "Rejalar bazasi" dashboard'da yuklangan rejani ko'radi; botdagi
    arxivlash.
- Production'ga: staging'da tekshirilgandan keyin, admin roziligi bilan
  `main` ga merge.

## 11. Ochiq savollar

- `PLANS_CHAT_ID` uchun alohida kanal ochiladimi yoki fayllar admin
  chatiga boradimi? (Standart: admin chati.)
