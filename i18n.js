const S = {
  // --- tugmalar ---
  btn_import:   { uz: '📤 Import',        ru: '📤 Импорт' },
  btn_profile:  { uz: '👤 Profil',        ru: '👤 Профиль' },
  btn_balance:  { uz: '💳 Balans',        ru: '💳 Баланс' },
  btn_lang:     { uz: '🌐 Til',           ru: '🌐 Язык' },
  btn_cancel:   { uz: '❌ Bekor',         ru: '❌ Отмена' },
  btn_guide:    { uz: "📖 Qo'llanma",     ru: '📖 Инструкция' },
  btn_open:     { uz: "📖 Qo'llanmani ochish", ru: '📖 Открыть инструкцию' },
  btn_all:      { uz: '🔍 Hammasi',       ru: '🔍 Все' },
  btn_back:     { uz: '⬅️ Orqaga',        ru: '⬅️ Назад' },
  btn_ok:       { uz: '✅ Import',        ru: '✅ Импорт' },
  btn_merge:    { uz: '🔗 Birlashtirish', ru: '🔗 Объединить' },
  btn_full:     { uz: "📋 To'liq ro'yxat", ru: '📋 Весь список' },
  btn_login:    { uz: '🔑 eMaktab hisobi', ru: '🔑 Аккаунт eMaktab' },
  btn_rename:   { uz: "✏️ Ismni o'zgartirish", ru: '✏️ Изменить имя' },
  ask_name:     { uz: "Ismingizni yozing:", ru: 'Напишите ваше имя:' },
  name_saved:   { uz: '✅ Saqlandi: {name}', ru: '✅ Сохранено: {name}' },
  btn_topup:    { uz: "➕ To'ldirish",    ru: '➕ Пополнить' },
  btn_history:  { uz: '📜 Tarix',         ru: '📜 История' },
  btn_sub:      { uz: '⭐ Yillik obuna',  ru: '⭐ Годовая подписка' },
  btn_approve:  { uz: '✅ Tasdiqlash',    ru: '✅ Подтвердить' },
  btn_reject:   { uz: '❌ Rad etish',     ru: '❌ Отклонить' },

  // --- start / til ---
  start_new: {
    uz: 'Salom! Dars mavzularini eMaktabga yuklaydigan bot.\n\nAvval tilni tanlang:',
    ru: 'Здравствуйте! Бот для загрузки тем уроков в eMaktab.\n\nСначала выберите язык:',
  },
  start_known: {
    uz: 'Salom, {name}! Yuklash uchun "📤 Import" tugmasini bosing.',
    ru: 'Здравствуйте, {name}! Нажмите "📤 Импорт" для загрузки.',
  },
  start_anon: {
    uz: 'Salom! Dars mavzularini eMaktabga yuklaydigan bot.\n\n' +
        'Boshlash uchun "👤 Profil" dan eMaktab hisobingizni ulang.\n\n' +
        '"📖 Qo\'llanma" bilan tanishib chiqing — 1 daqiqa vaqt oladi.',
    ru: 'Здравствуйте! Бот для загрузки тем уроков в eMaktab.\n\n' +
        'Для начала подключите аккаунт eMaktab в разделе "👤 Профиль".\n\n' +
        'Ознакомьтесь с "📖 Инструкция" — это займёт 1 минуту.',
  },
  guide_msg: {
    uz: '📖 <b>Qo\'llanma</b>\n\nBotdan foydalanish bo\'yicha qisqa yo\'riqnoma.',
    ru: '📖 <b>Инструкция</b>\n\nКраткое руководство по работе с ботом.',
  },
  guide_none: {
    uz: "Qo'llanma hozircha mavjud emas.",
    ru: 'Инструкция пока недоступна.',
  },
  lang_choose: { uz: 'Tilni tanlang:', ru: 'Выберите язык:' },
  lang_set:    { uz: "Til o'zbekchaga o'zgartirildi.", ru: 'Язык изменён на русский.' },
  cancelled:   { uz: 'Bekor qilindi.', ru: 'Отменено.' },

  // --- login ---
  ask_login:    { uz: 'eMaktab loginingizni yuboring:', ru: 'Отправьте ваш логин eMaktab:' },
  ask_password: { uz: "Endi parolni yuboring. (Xabar avtomat o'chiriladi)", ru: 'Теперь пароль. (Сообщение будет удалено)' },
  checking:     { uz: 'Tekshirilyapti...', ru: 'Проверяем...' },
  connected:    { uz: '✅ Ulandi: {name}', ru: '✅ Подключено: {name}' },
  connected_no: { uz: '✅ Ulandi.', ru: '✅ Подключено.' },
  unlinked: {
    uz: '⚠️ eMaktab hisobingiz boshqa Telegram akkauntga ulandi. Bu yerda import ishlamaydi.',
    ru: '⚠️ Ваш аккаунт eMaktab подключён к другому Telegram. Здесь импорт работать не будет.',
  },
  bad_creds:    { uz: "❌ Login yoki parol noto'g'ri.", ru: '❌ Неверный логин или пароль.' },
  need_login:   { uz: 'Avval "👤 Profil" dan eMaktab hisobingizni ulang.', ru: 'Сначала подключите аккаунт eMaktab в "👤 Профиль".' },

  // --- profil ---
  profile: {
    uz: '👤 <b>Profil</b>\n\nIsm: {name}\neMaktab: {login}\nTil: {lang}\n\n💳 Balans: {balance} so\'m\n{plan}\nJami import: {imports} ta',
    ru: '👤 <b>Профиль</b>\n\nИмя: {name}\neMaktab: {login}\nЯзык: {lang}\n\n💳 Баланс: {balance} сум\n{plan}\nВсего импортов: {imports}',
  },
  plan_sub:  { uz: '⭐ Yillik obuna: {date} gacha', ru: '⭐ Годовая подписка: до {date}' },
  plan_free: { uz: '🎁 Bepul import: {n} ta qoldi', ru: '🎁 Бесплатных импортов: {n}' },
  plan_pay:  { uz: '1 import = {price} so\'m', ru: '1 импорт = {price} сум' },
  not_set:   { uz: "kiritilmagan", ru: 'не указано' },

  // --- balans ---
  balance: {
    uz: '💳 <b>Balans</b>\n\n{balance} so\'m\n{plan}\n\n1 import = {price} so\'m\nYillik obuna = {sub} so\'m',
    ru: '💳 <b>Баланс</b>\n\n{balance} сум\n{plan}\n\n1 импорт = {price} сум\nГодовая подписка = {sub} сум',
  },
  topup_card: {
    uz: '💳 <b>Kartaga o\'tkazing</b>\n\n<code>{card}</code>\n{holder}\n\n' +
        '📝 To\'lov izohiga yozing: <code>{ref}</code>\n' +
        '<i>Bu sizni tanib olish uchun kerak.</i>\n\n' +
        '⚠️ Bank komissiyasini hisobga oling. Balansga kartaga <b>tushgan</b> summa yoziladi. ' +
        'Masalan 50 000 yuborsangiz va komissiya 500 so\'m bo\'lsa, balansga 49 500 tushadi.\n\n' +
        'Qancha o\'tkazdingiz? Summani yozing (masalan 50000):',
    ru: '💳 <b>Переведите на карту</b>\n\n<code>{card}</code>\n{holder}\n\n' +
        '📝 В комментарии к платежу укажите: <code>{ref}</code>\n' +
        '<i>Это нужно, чтобы вас опознать.</i>\n\n' +
        '⚠️ Учитывайте комиссию банка. На баланс зачисляется сумма, <b>поступившая</b> на карту. ' +
        'Например, при переводе 50 000 и комиссии 500 сум зачислится 49 500.\n\n' +
        'Какую сумму перевели? Напишите число (например 50000):',
  },
  topup_need_login: {
    uz: 'Balansni to\'ldirishdan oldin "👤 Profil" dan eMaktab hisobingizni ulang.',
    ru: 'Перед пополнением подключите аккаунт eMaktab в разделе "👤 Профиль".',
  },
  topup_wait_shot: {
    uz: '✅ Qabul qilindi. Endi chek skrinshotini yuboring.',
    ru: '✅ Принято. Теперь отправьте скриншот чека.',
  },
  topup_bad_amount: { uz: "Summani raqam bilan yozing, masalan: 50000", ru: 'Напишите сумму числом, например: 50000' },
  topup_screenshot: { uz: 'Endi chek skrinshotini yuboring.', ru: 'Теперь отправьте скриншот чека.' },
  topup_sent:       { uz: "✅ So'rov yuborildi. Tasdiqlangach xabar beramiz.", ru: '✅ Заявка отправлена. Сообщим после подтверждения.' },
  topup_ok:         { uz: '✅ Balans to\'ldirildi: +{amount} so\'m\nJoriy balans: {balance} so\'m', ru: '✅ Баланс пополнен: +{amount} сум\nТекущий баланс: {balance} сум' },
  topup_rejected:   { uz: "❌ To'lov tasdiqlanmadi. Savol bo'lsa admin bilan bog'laning.", ru: '❌ Платёж не подтверждён. Свяжитесь с админом.' },
  history_empty:    { uz: 'Hozircha amaliyot yo\'q.', ru: 'Пока операций нет.' },
  history:          { uz: '📜 <b>Oxirgi amaliyotlar</b>\n\n{rows}', ru: '📜 <b>Последние операции</b>\n\n{rows}' },

  // --- obuna ---
  sub_bought: { uz: '⭐ Yillik obuna faollashtirildi. {date} gacha cheksiz import.', ru: '⭐ Годовая подписка активна до {date}. Импорт без ограничений.' },
  sub_have:   { uz: 'Sizda obuna allaqachon bor ({date} gacha).', ru: 'Подписка уже активна (до {date}).' },
  sub_nomoney:{ uz: 'Obuna uchun {sub} so\'m kerak. Balansingiz: {balance} so\'m.', ru: 'Для подписки нужно {sub} сум. Ваш баланс: {balance} сум.' },

  // --- import ---
  send_file:  { uz: 'Excel faylni yuboring (.xls yoki .xlsx).', ru: 'Отправьте Excel файл (.xls или .xlsx).' },
  only_xlsx:  { uz: 'Faqat .xls yoki .xlsx fayl qabul qilinadi.', ru: 'Принимаются только .xls и .xlsx.' },
  too_big:    { uz: 'Fayl juda katta.', ru: 'Файл слишком большой.' },
  file_got:   { uz: 'Fayl qabul qilindi. eMaktabga ulanyapman...', ru: 'Файл получен. Подключаюсь к eMaktab...' },
  no_money: {
    uz: '💳 Balans yetarli emas.\n\n1 import = {price} so\'m\nBalansingiz: {balance} so\'m\n\n"💳 Balans" dan to\'ldiring.',
    ru: '💳 Недостаточно средств.\n\n1 импорт = {price} сум\nВаш баланс: {balance} сум\n\nПополните в разделе "💳 Баланс".',
  },
  choose:     { uz: '<b>{field}</b>ni tanlang:', ru: 'Выберите <b>{field}</b>:' },
  by_file:    { uz: " <i>(fayl bo'yicha)</i>", ru: ' <i>(по имени файла)</i>' },
  full_list:  { uz: "To'liq ro'yxat:", ru: 'Полный список:' },
  empty_list: { uz: '❌ "{field}" ro\'yxati bo\'sh chiqdi.\n\n{info}', ru: '❌ Список "{field}" пуст.\n\n{info}' },
  mapping:    { uz: 'Ustunlar moslanyapti...', ru: 'Сопоставляем столбцы...' },
  manual_map: { uz: "Ustunlarni qo'lda moslaymiz.", ru: 'Сопоставим столбцы вручную.' },
  map_q:      { uz: 'Fayldagi "{col}" ustuni nimaga to\'g\'ri keladi?', ru: 'Чему соответствует столбец "{col}"?' },
  no_map:     { uz: '❌ Ustun moslash jadvali topilmadi.\n\n{report}', ru: '❌ Таблица сопоставления не найдена.\n\n{report}' },
  no_table:   { uz: '❌ Tekshiruv jadvali topilmadi.\n\n{info}', ru: '❌ Таблица проверки не найдена.\n\n{info}' },

  stats_ok:   { uz: '{n} mavzu · ✅ hammasi tayyor', ru: '{n} тем · ✅ все готовы' },
  stats_bad:  { uz: '{n} mavzu · ✅ {ok} tayyor · ⚠️ {bad} xato', ru: '{n} тем · ✅ {ok} готовы · ⚠️ {bad} с ошибкой' },
  bad_rows:   { uz: '<b>Xato qatorlar:</b> {nums}\n<i>Import qilsangiz ular kirmaydi.</i>', ru: '<b>Строки с ошибкой:</b> {nums}\n<i>Они не будут загружены.</i>' },
  confirm_q:  { uz: 'Yuklaymi?', ru: 'Загрузить?' },
  cost_note:  { uz: '\n\n<i>Narxi: {price} so\'m</i>', ru: '\n\n<i>Стоимость: {price} сум</i>' },
  cost_free:  { uz: '\n\n<i>Bepul ({n} ta qoldi)</i>', ru: '\n\n<i>Бесплатно (осталось {n})</i>' },
  cost_sub:   { uz: '\n\n<i>Obuna bo\'yicha bepul</i>', ru: '\n\n<i>Бесплатно по подписке</i>' },

  merge_prompt: {
    uz: '🔗 <b>Mavzularni birlashtirish</b>\n\nYonma-yon turgan juftliklarni yozing:\n<code>3-4, 8-9</code>',
    ru: '🔗 <b>Объединение тем</b>\n\nНапишите пары соседних номеров:\n<code>3-4, 8-9</code>',
  },
  merge_err:  { uz: '❌ {err}\n\nQayta yozing.', ru: '❌ {err}\n\nНапишите ещё раз.' },
  merged:     { uz: 'Birlashtirildi: {from} → {to} ta dars.\nQayta yuklanyapti...', ru: 'Объединено: {from} → {to} уроков.\nЗагружаем заново...' },
  uploading:  { uz: 'Yuklanyapti...', ru: 'Загружаем...' },
  done:       { uz: '✅ <b>{n} ta dars kiritildi.</b>', ru: '✅ <b>Загружено уроков: {n}</b>' },
  skipped:    { uz: '\n\n⚠️ Kirmadi ({n} ta):\n{rows}', ru: '\n\n⚠️ Не загружено ({n}):\n{rows}' },
  charged:    { uz: '\n\n💳 {price} so\'m yechildi. Balans: {balance} so\'m', ru: '\n\n💳 Списано {price} сум. Баланс: {balance} сум' },
  session_end:{ uz: 'Sessiya tugagan. Qaytadan boshlang.', ru: 'Сессия завершена. Начните заново.' },
  error:      { uz: '❌ Xatolik: {msg}', ru: '❌ Ошибка: {msg}' },
};

export const LANGS = ['uz', 'ru'];
export const LANG_NAME = { uz: "O'zbekcha", ru: 'Русский' };

export function t(lang, key, vars = {}) {
  const row = S[key];
  if (!row) return key;
  let out = row[lang] || row.uz;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  return out;
}

export const money = n => Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ');
