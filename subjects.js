// Fan lug'ati.
// key    — ichki nom, hech qachon o'zgarmaydi. Rejalar shu bo'yicha saqlanadi.
// uz/ru  — ko'rsatiladigan nom.
// alias  — eMaktabda va kanalda uchraydigan yozilishlar (kichik harfda solishtiriladi).
// combo  — bir necha fanni birlashtiruvchi yozuv (Algebra+Geometriya kabi).

export const SUBJECTS = [
  // ---------- boshlang'ich ----------
  { key: 'math',        uz: 'Matematika',        ru: 'Математика',
    alias: ['matematika', 'математика'] },

  { key: 'alifbe',      uz: 'Alifbe va yozuv',   ru: 'Письмо и букварь',
    alias: ['alifbe', 'alifbe va yozuv', 'savod o‘rgatish', 'письмо и букварь', 'обучение грамоте'] },

  { key: 'ona-tili',    uz: 'Ona tili',          ru: 'Родной язык',
    alias: ['ona tili', 'она тили', 'родной язык'] },

  { key: 'oqish',       uz: 'O‘qish savodxonligi', ru: 'Читательская грамотность',
    alias: ['o‘qish savodxonligi', 'oqish savodxonligi', 'o‘qish savod.', 'o‘qish',
            'читательская грам.', 'читательская грамотность', 'читат.грам.'] },

  { key: 'tarbiya',     uz: 'Tarbiya',           ru: 'Воспитание',
    alias: ['tarbiya', 'тарбия', 'воспитание'] },

  { key: 'science',     uz: 'Tabiiy fanlar',     ru: 'Естественные науки',
    alias: ['tabiiy fanlar', 'tabiiy fan', 'табиий фанлар',
            'естеств. науки', 'естественные науки', 'естествоз.(science)', 'естествознание'] },

  { key: 'tech',        uz: 'Texnologiya',       ru: 'Технология',
    alias: ['texnologiya', 'технология'] },

  { key: 'art',         uz: 'Tasviriy san’at',   ru: 'ИЗО',
    alias: ['tasviriy san’at', 'tasviriy san\'at', 'тасвирий санъат', 'изо', 'изобразительное искусство'] },

  { key: 'it',          uz: 'Informatika',       ru: 'Информатика',
    alias: ['informatika', 'информатика'] },

  { key: 'pe',          uz: 'Jismoniy tarbiya',  ru: 'Физическая культура',
    alias: ['jismoniy tarbiya', 'jismoniy tabiya', 'жисмоний тарбия',
            'физическая культура', 'физ. культура', 'физкультура'] },

  { key: 'music',       uz: 'Musiqa',            ru: 'Музыка',
    alias: ['musiqa', 'мусиқа', 'музыка'] },

  { key: 'future',      uz: 'Kelajak soati',     ru: 'Час будущего',
    alias: ['kelajak soati', 'келажак соати', 'час будущего', 'часы будущего'] },

  // ---------- tillar ----------
  { key: 'ru-lang',     uz: 'Rus tili',          ru: 'Русский язык',
    alias: ['rus tili', 'рус тили', 'русский язык'] },

  { key: 'uz-lang',     uz: 'O‘zbek tili',       ru: 'Узбекский язык',
    alias: ['o‘zbek tili', 'ozbek tili', 'ўзбек тили', 'узбекский язык'] },

  { key: 'en-lang',     uz: 'Ingliz tili',       ru: 'Английский язык',
    alias: ['ingliz tili', 'инглиз тили', 'английский язык'] },

  { key: 'de-lang',     uz: 'Nemis tili',        ru: 'Немецкий язык',
    alias: ['nemis tili', 'немис тили', 'немецкий язык'] },

  { key: 'fr-lang',     uz: 'Fransuz tili',      ru: 'Французский язык',
    alias: ['fransuz tili', 'франсуз тили', 'французский язык'] },

  // ---------- yuqori sinflar ----------
  { key: 'literature',  uz: 'Adabiyot',          ru: 'Литература',
    alias: ['adabiyot', 'адабиёт', 'литература'] },

  { key: 'biology',     uz: 'Biologiya',         ru: 'Биология',
    alias: ['biologiya', 'биология'] },

  { key: 'physics',     uz: 'Fizika',            ru: 'Физика',
    alias: ['fizika', 'физика'] },

  { key: 'chemistry',   uz: 'Kimyo',             ru: 'Химия',
    alias: ['kimyo', 'кимё', 'химия'] },

  { key: 'geography',   uz: 'Geografiya',        ru: 'География',
    alias: ['geografiya', 'география'] },

  { key: 'algebra',     uz: 'Algebra',           ru: 'Алгебра',
    alias: ['algebra', 'алгебра'] },

  { key: 'geometry',    uz: 'Geometriya',        ru: 'Геометрия',
    alias: ['geometriya', 'геометрия'] },

  { key: 'history-world', uz: 'Jahon tarixi',    ru: 'Всемирная история',
    alias: ['jahon tarixi', 'жаҳон тарихи', 'всемирная история'] },

  { key: 'history-uz',  uz: 'O‘zbekiston tarixi', ru: 'История Узбекистана',
    alias: ['o‘zbekiston tarixi', 'ozbekiston tarixi', 'ўзбекистон тарихи', 'история узбекистана'] },

  { key: 'law',         uz: 'Huquq',             ru: 'Государство и право',
    alias: ['huquq', 'ҳуқуқ', 'гос. права', 'государство и право', 'право'] },

  { key: 'economics',   uz: 'Iqtisodiy bilim asoslari', ru: 'Экономика',
    alias: ['iqtisodiy bilim asoslari', 'iba', 'иқтисодий билим асослари', 'экономика'] },

  { key: 'chqbt',       uz: 'Chaqiruvga qadar boshlang‘ich tayyorgarlik', ru: 'НДП',
    alias: ['chqbt', 'chaqiruvga qadar boshlang‘ich tayyorgarlik', 'чақирувга қадар',
            'ндп', 'начальная допризывная подготовка'] },
];

// Birlashgan yozuvlar: kanalda bitta faylda ikki fan bo'lsa
export const COMBOS = [
  { key: 'algebra+geometry', uz: 'Algebra + Geometriya', ru: 'Алгебра + Геометрия',
    parts: ['algebra', 'geometry'],
    alias: ['algebra+geometriya', 'алгебра+геометрия', 'algebra + geometriya'] },

  { key: 'history',          uz: 'Tarix (Jahon + O‘zbekiston)', ru: 'История (Всемир. + Узб.)',
    parts: ['history-world', 'history-uz'],
    alias: ['tarix', 'тарих', 'история',
            'tarix(jahon+o‘zb.)', 'история(всемир.+узб.)'] },
];

const norm = s => String(s || '')
  .toLowerCase()
  .replace(/[’`]/g, '‘')
  .replace(/\s+/g, ' ')
  .trim();

const INDEX = new Map();
for (const s of [...SUBJECTS, ...COMBOS]) {
  INDEX.set(norm(s.key), s.key);
  INDEX.set(norm(s.uz), s.key);
  INDEX.set(norm(s.ru), s.key);
  for (const a of s.alias || []) INDEX.set(norm(a), s.key);
}

// eMaktabdagi yoki kanaldagi nomni ichki kalitga aylantiradi
export function subjectKey(name) {
  const n = norm(name);
  if (INDEX.has(n)) return INDEX.get(n);

  // Qisman moslik: "Естествоз.(science)" kabi qisqartmalar uchun
  for (const [k, key] of INDEX) {
    if (k.length >= 5 && (n.includes(k) || k.includes(n))) return key;
  }
  return null;
}

export function subjectName(key, lang = 'uz') {
  const s = [...SUBJECTS, ...COMBOS].find(x => x.key === key);
  return s ? (s[lang] || s.uz) : key;
}

export const byKey = key => [...SUBJECTS, ...COMBOS].find(x => x.key === key) || null;
