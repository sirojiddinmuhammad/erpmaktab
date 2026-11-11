# Dashboard: kiruvchi fayllar, fanlar bo'limi, rejim tugmasi — dizayn

Sana: 2026-11-12 · Branch: `feature/panel-inbox-subjects` · Asos: `docs/superpowers/specs/2026-11-10-plans-dashboard-design.md`

## 1. Maqsad

Rejalar dashboardi ishlayapti. Admin uchta narsani so'radi:

1. Reja fayllari chiqadigan Telegram kanaldan fayllarni bittalab ko'chirmaslik.
2. Fanlar lug'atini dashboard'da boshqarish (qo'shish, tahrirlash, o'chirish).
3. Kunduzgi/kechki rejim tugmasi.

### Muvaffaqiyat mezoni

- Kanaldagi bir kunlik 30 ta faylni bitta forward bilan botga yuborib,
  dashboard'da 5 daqiqadan kam vaqtda saqlash mumkin.
- Fanni dashboard'da qo'shish/tahrirlash botda qayta ishga tushirmasdan ko'rinadi.
- Hech qanday ma'lumot butunlay o'chirilmaydi; kodda `DELETE` qolmaydi.
- O'qituvchilarning import oqimi o'zgarmaydi.

### Doiradan tashqari (YAGNI)

- Botni kanalga admin qilib yangi postlarni avtomatik olish (keyin, alohida).
- Shaxsiy Telegram akkaunt orqali kanal tarixini o'qish (xavfsizlik sababli rad etildi).
- Fanlarni tartiblash (`sort`) ni tahrirlash.

## 2. Kiruvchi fayllar (forward → inbox)

### 2.1 Bot tomoni

`bot.on('message:document')` dagi tekshiruvlar tartibi:

1. Admin ommaviy yuklash oqimida (`af.kind === 'bulk'`) — hozirgidek.
2. Admin import uchun fayl kutilayotgan holatda (`live.get(id)?.step === 'await_file'`)
   — hozirgidek import.
3. **Yangi:** `ctx.from.id === ADMIN_ID` va xabar forward qilingan
   (`ctx.message.forward_origin` bor) → inbox'ga qo'shiladi.
4. Qolgan hollarda — hozirgidek (javobsiz).

Shuning uchun 3-band joriy 1–2 bandlardan keyin, o'qituvchi tekshiruvidan
(`if (!s || s.step !== 'await_file') return;`) **oldin** turadi.

Inbox'ga qo'shish:

- Faqat `.xls`/`.xlsx`. Boshqa forward qilingan fayllar e'tiborsiz.
- Saqlanadigan maydonlar: `file_id`, `file_unique_id`, `file_name`, `file_size`,
  izoh (`caption`, 1000 belgigacha), kanal nomi
  (`forward_origin.chat.title` yoki `sender_user.first_name` yoki `sender_user_name`),
  kanaldagi post sanasi (`forward_origin.date`, sekund → `timestamptz`).
- Takror: `file_unique_id` bo'yicha. Kutilayotgan (olinmagan) yozuv bo'lsa —
  yangisi qo'shilmaydi.
- Mavzular soni (`topics`) inbox'ga qo'shishda hisoblanmaydi (tezlik uchun);
  dashboard ro'yxatga olganda hisoblanadi (2.3).
- Javob: har fayl uchun emas. So'nggi fayldan 3 soniya o'tgach bitta xabar:
  `📥 N ta fayl qabul qilindi (M ta takror). Dashboard → Ommaviy yuklash.`
  Takrorlar soni 0 bo'lsa qavs ko'rsatilmaydi. Taymer xotirada; deploy paytida
  yo'qolsa — faqat xabar yo'qoladi, fayllar bazada.

### 2.2 Baza

```sql
create table if not exists plan_inbox (
  id             bigserial primary key,
  file_id        text not null,
  file_unique_id text not null,
  file_name      text not null,
  file_size      int,
  caption        text,
  source         text,
  posted_at      timestamptz,
  created_at     timestamptz default now(),
  taken_at       timestamptz,          -- jadvalga olingan / saqlangan
  dismissed_at   timestamptz           -- "kerak emas"
);
create index if not exists plan_inbox_pending
  on plan_inbox (created_at) where taken_at is null and dismissed_at is null;
```

"Kutilayotgan" = `taken_at is null and dismissed_at is null`.
Takror tekshiruvi: kutilayotganlar orasida bir xil `file_unique_id`.

`db.js` funksiyalari:

- `addInbox({ fileId, fileUniqueId, fileName, fileSize, caption, source, postedAt })`
  → `{ added: boolean }`. Takror bo'lsa `added: false`.
- `listInbox(limit = 200)` → kutilayotganlar, `created_at` bo'yicha.
- `countInbox()` → kutilayotganlar soni.
- `markInbox(ids: number[], field: 'taken_at'|'dismissed_at')` → o'zgarganlar soni.

### 2.3 Dashboard API

| Usul | Yo'l | Vazifa |
|---|---|---|
| GET | `/api/inbox` | `{ count, rows: [{ id, fileName, caption, source, postedAt }] }` |
| POST | `/api/inbox/take` | `{ ids }` → har biri uchun `/api/files` javobi bilan bir xil shakl + `inboxId` |
| POST | `/api/inbox/dismiss` | `{ ids }` → `{ ok, n }` |

`take` har fayl uchun (ketma-ket, ko'pi bilan 50 ta):

1. `downloadFile(file_id)` → `.xlsx` bo'lsa `readRows` → `topics` (xato → `null`).
2. Taxmin: `/api/files` dagi bilan bir xil, matn sifatida
   `fileName + ' ' + caption` ishlatiladi (sinf, fan, chorak, yil, BSB).
3. Chorak topilmasa — `posted_at` sanasidan (`quarterOfDate`, quyida).
   Yil topilmasa — `posted_at` dan o'quv yili (sentyabrdan yangi yil).
4. Telegram'ga qayta yuborilmaydi: `fileId` = inbox'dagi `file_id`.
5. `taken_at = now()` — fayl jadvalga olindi, inbox ro'yxatidan chiqadi.
   Yuklab bo'lmasa — o'sha yozuv `{ inboxId, error }` bilan qaytadi,
   `taken_at` qo'yilmaydi.

`quarterOfDate(d)`: sentyabr–oktyabr → 1; noyabr 1–7 → 1, 8+ → 2; dekabr → 2;
yanvar–mart → 3; aprel–iyun → 4; iyul–avgust → 1. Bu UI dagi `guessQuarter`
bilan bir xil; serverga ko'chiriladi va testlanadi.

### 2.4 Dashboard UI

Ommaviy yuklash tabida, fayl tashlash maydonidan yuqorida:

- `📥 Kiruvchi: N ta fayl` (N = 0 bo'lsa blok ko'rinmaydi), ikki tugma:
  **Jadvalga olish** (hammasini) va **Ro'yxatni ko'rish** (modal: fayl nomi,
  izoh, kanal, sana; har birida "kerak emas").
- "Jadvalga olish" → `/api/inbox/take` → qatorlar jadvalga qo'shiladi
  (holat va saqlash mavjud mantiq bilan). Qator manbai "📥" belgisi bilan.
- Tab ochilganda va 30 soniyada bir marta `GET /api/inbox` (faqat tab ochiq bo'lsa).

Jadvaldan qator olib tashlansa (✕) — inbox'ga qaytmaydi (u allaqachon olingan);
faylni qaytadan forward qilish mumkin, chunki olingan yozuv takror hisoblanmaydi.

## 3. Fanlar bo'limi

### 3.1 Baza

```sql
alter table subject_extra add column if not exists archived_at timestamptz;
```

- `extraSubjects()` — faqat `archived_at is null` (botdagi tugmalar, taxminlar
  va `admin.allSubjects()` shu orqali arxivlanganlarni ko'rmaydi).
- Yangi `subjectsForPanel()` — hammasi, `archived_at` bilan, rejalar soni bilan
  (`count(*) filter (where archived_at is null)` — `plans` jadvalidan).
- `archiveSubject(key, withPlans)` — `update subject_extra set archived_at = now()`;
  `withPlans` bo'lsa rejalar ham arxivlanadi (hozirgi `deleteSubject` mantiqi).
- `restoreSubject(key)` — `archived_at = null` (rejalar avtomatik qaytmaydi).
- `deleteSubject` olib tashlanadi; botdagi `sdy` callback `archiveSubject` ni chaqiradi,
  matn "🗄 Arxivlandi". Kodda `delete from` qolmaydi.
- `addSubject` hozir to'qnashuvda mavjud fanni **ustidan yozadi**. Dashboard
  buni ishlatmaydi: yangi `createSubject({ uz, ru, alias })` kalitni yasaydi
  (`x-` + nomdan, botdagi bilan bir xil qoida), band bo'lsa `-2`, `-3`… qo'shadi,
  `insert` qiladi va kalitni qaytaradi.

Har o'zgarishdan keyin `admin.loadExtraSubjects()` chaqiriladi — bot va
dashboard darhol yangi ro'yxatni ko'radi.

### 3.2 API

| Usul | Yo'l | Vazifa |
|---|---|---|
| GET | `/api/subjects` | `{ rows: [{ key, uz, ru, alias, plans, archived }] }` |
| POST | `/api/subjects` | `{ uz, ru, alias }` → `{ key }` |
| POST | `/api/subjects/:key` | `{ uz, ru, alias }` → `{ ok }` |
| POST | `/api/subjects/:key/archive` | `{ withPlans }` → `{ ok }` |
| POST | `/api/subjects/:key/restore` | `{ ok }` |

Tekshiruv: `uz` majburiy, 1–80 belgi; `ru` ixtiyoriy (bo'sh bo'lsa `uz`), 80 belgigacha;
`alias` — satrlar massivi, har biri 1–80, ko'pi bilan 30 ta; kalit `^[a-z0-9а-яё-]{1,40}$`.
`/api/meta` dagi `subjects` faqat arxivlanmaganlar (o'zgarmaydi).

### 3.3 UI

To'rtinchi tab **Fanlar**:

- Qidiruv maydoni; jadval: o'zbekcha, ruscha, tanish so'zlar, rejalar soni, amallar.
- **➕ Fan qo'shish** — modal: o'zbekcha, ruscha, tanish so'zlar (vergul bilan).
- **Tahrirlash** — o'sha modal.
- **O'chirish** — rejalar 0 bo'lsa oddiy `confirm`; bo'lsa modal:
  "Bu fanda N ta reja bor" + **Faqat fan** / **Fan + rejalar arxivga** / Bekor.
- "Arxiv" belgisi — arxivlangan fanlar va **Qaytarish** tugmasi.

## 4. Kunduzgi / kechki rejim

- Header'da "Chiqish" yonida tugma: hozirgi rejim kechki bo'lsa ☀️, aks holda 🌙.
- Bosilganda `<html data-theme="light|dark">` o'rnatiladi va
  `localStorage['panel-theme']` ga yoziladi (o'qish/yozish `try/catch` ichida).
- Sahifa ochilganda saqlangan qiymat bo'lsa — qo'llanadi; bo'lmasa tizim rejimi
  (`prefers-color-scheme`), atribut qo'yilmaydi.
- CSS tokenlari allaqachon `[data-theme]` ni qo'llaydi.

## 5. Xatolar

- Inbox'ga yozish xatosi botda logga `[inbox]` bilan; adminga xabar yo'q
  (keyingi xulosa xabari kelmasa, admin qayta forward qiladi).
- `take` dagi bitta fayl xatosi qolganlarini to'xtatmaydi.
- Fanlar API: noto'g'ri qiymat → `400` va matn; topilmadi → `404`.

## 6. Sinov

- `node:test`:
  - inbox: forward bo'lmagan / admin bo'lmagan / `.pdf` / takror holatlari
    (bot handleri sof funksiyaga ajratiladi: `inboxDecision(msg, ctx)`);
  - `quarterOfDate`, o'quv yili sanadan;
  - `take`: izohdan taxmin, sanadan chorak, bitta xato qolganlarni to'xtatmaydi;
  - fanlar: tekshiruv, kalit yasash va to'qnashuv, arxiv/qaytarish yo'llari, Origin.
- Vaqtinchalik Postgres (PGlite) da `db.js` yangi so'rovlari va migratsiya.
- Soxta serverda brauzerda: inbox bloki, fanlar tabi, rejim tugmasi (ikkala rejim,
  375 px kenglik).
- Production'ga: admin roziligi bilan `main` ga merge.
