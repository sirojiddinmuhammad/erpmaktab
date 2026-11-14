# eMaktab import sahifalari — fixture'lar

2026-11-14 da sinovchi akkauntida (admin ruxsati bilan, Chrome) ko'rilgan tuzilish
asosida qo'lda yozilgan. Ism, login, maktab nomi, token yo'q; maktab ID `1000000000001`,
token `XXX`. Mavzular — "Test mavzu N". Import (`step3`) **yuborilmagan**.

## Topilganlar

1. **Sinf × fanlar** — `GET /v2/myclasses`: sinf havolasi `/v2/class?class=<groupId>`
   (matni sinf nomi, masalan `4-A`), keyin o'sha sinf fanlari
   `https://emaktab.uz/journal/school/<school>/group/<groupId>/subject/<subjectId>?periodId=<joriy chorak>`
   (`title` — fan nomi). Shablon fayl yuklash shart emas.
2. **Ro'yxatlar** (GET JSON `[{value,name}]`):
   - `/v2/journals/getsubjects-cmd?school=&group=` — guruh fanlari;
   - `/v2/journals/getsubgroups-cmd?group=` — kichik guruhlar ("1 группа"); "Весь класс" ro'yxatda yo'q — u `''`/`0`;
   - `/v2/journals/getperiods-cmd?group=` — `Весь год` (0), `1 четверть` … `4 четверть`.
3. **1-qadam** — `POST /v2/journals/planning/import`, `multipart/form-data`: forma yashirin
   maydonlari (`__RequestVerificationToken, group, subject, subgroup, period, school, year,
   file, selectedFile, lessonIndex, lessonTopic, homework, teacher, pageIndex, department,
   parallel, lessonDate, hoursCount, sourceType, sourcePlan`) + `multifile1` (fayl) +
   `firstRow=0` + `step1`. `group/subject/period` oldindan berilsa, 2-qadamda tanlangan bo'lib keladi.
4. **2-qadam** javobi: yashirin `partnerId, school, file=storage:///…, firstRow=False`;
   selectlar `year, group, subject, subgroup ('' = Весь класс), period`; `pageIndex`;
   moslash `select_0..N` (−1 Не импортировать, 0 Номер урока, 1 Тема урока, 2 Домашнее задание);
   tugmalar `step0` (Назад), `step2` (Далее).
   **Moslash jadvalidagi ustun nomi katagi bo'sh keladi** — ustunlarni sahifadan emas,
   faylning o'z sarlavhasidan (`COLUMN_RULES`) aniqlash kerak; topilmasa tartib bo'yicha.
5. **2-qadam POST** (`application/x-www-form-urlencoded`):
   `__RequestVerificationToken, partnerId, school, file, firstRow, year, group, subject,
   subgroup, period, pageIndex, select_0..N, step2`.
6. **3-qadam** (ko'rib chiqish) javobi: yashirin maydonlar (`lessonIndex/lessonTopic/homework`
   endi 0/1/2), jadval ustunlari `№ | № урока | Тема урока | Домашнее задание | Действие |
   Предварительная проверка`. Har qatorda `<select name="select">`:
   - tayyor: `<rowId>=0` / `<rowId>=1` (tanlangan), holat `Готов к импорту.`;
   - xato: faqat `0=0`, `№ урока` katagida `Ошибка!`, holat `<ul class="errors"><li>…</li></ul>`,
     masalan "Номер урока превышает общее количество уроков по предмету."
   Tugmalar: `step1` (Назад), `step3=Импортировать >` (haqiqiy import).
7. **Import holatsiz**: fayl yashirin `file` maydonida yuradi. "Отменить импорт этого файла" —
   oddiy `GET /v2/journals/planning/import?group=…` (1-qadam qaytadi). Osilib qolgan import yo'q.
8. **Sessiyasiz** `GET /v2/journals/planning/import` → login'ga redirect (302).

## Hali noma'lum

- `step3` dan keyingi natija sahifasi (birinchi haqiqiy importda yoziladi).
- Ko'p qatorli faylda `pageIndex` bo'yicha sahifalash (40 qator bitta sahifada keldi).
- eMaktab fan nomlari interfeys tilida keladi ("Математика") — o'qitish tilini fan nomidan
  aniqlash ishonchsiz bo'lishi mumkin.
