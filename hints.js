// Fayl nomidan sinf, chorak, o'quv yili va fan haqida ishora oladi.
// Hech narsa topilmasa bo'sh obyekt qaytadi — u holda filtr ishlamaydi.

const norm = t => String(t ?? '').toLowerCase().replace(/[_\s]+/g, ' ').trim();

export function parseFileName(fileName) {
  const base = String(fileName || '')
    .replace(/\.[^.]+$/, '')          // kengaytma
    .replace(/@[\w.-]+/g, ' ')        // @kanal_nomi
    .replace(/[_]+/g, ' ');

  const text = norm(base);
  const hints = { raw: text };

  // O'quv yili: 2026 2027 / 2026-2027 / 2026/2027
  const y = text.match(/(20\d{2})\s*[-–—/]?\s*(20\d{2})/);
  if (y) hints.year = [y[1], y[2]];

  // Chorak: "1 четверть", "1-chorak", "1 чорак"
  const q = text.match(/(\d)\s*-?\s*(четверт|chorak|чорак|chorack)/);
  if (q) hints.quarter = Number(q[1]);

  // Sinf darajasi: "2 кл", "2-класс", "4 sinf", "4-синф"
  const g = text.match(/(\d{1,2})\s*-?\s*(кл|класс|sinf|синф|klass)/);
  if (g) hints.grade = Number(g[1]);

  return hints;
}

// Variantdagi birinchi butun sonni oladi: "2-А" -> 2, "1 четверть" -> 1
const leadNumber = label => {
  const m = String(label).match(/\d{1,2}/);
  return m ? Number(m[0]) : null;
};

// Variantlarni fayl nomidagi ishoralarga qarab filtrlaydi.
// Hech narsa mos kelmasa bo'sh massiv qaytadi — chaqiruvchi to'liq ro'yxatni ko'rsatadi.
export function filterOptions(fieldLabel, options, hints) {
  if (!hints || !options?.length) return [];

  switch (fieldLabel) {
    case 'Учебный год': {
      if (!hints.year) return [];
      const [a, b] = hints.year;
      return options.filter(o => o.label.includes(a) && o.label.includes(b));
    }

    case 'Учебный период': {
      if (hints.quarter == null) return [];
      return options.filter(o => leadNumber(o.label) === hints.quarter);
    }

    case 'Класс': {
      if (hints.grade == null) return [];
      return options.filter(o => leadNumber(o.label) === hints.grade);
    }

    case 'Предмет': {
      if (!hints.raw) return [];
      // Fayl nomida fan nomi to'liq uchraydimi?
      const hit = options.filter(o => {
        const n = norm(o.label);
        return n.length >= 3 && hints.raw.includes(n);
      });
      // Bir nechta mos kelsa (masalan qisqasi uzunining ichida) — eng uzunini qoldiramiz
      if (hit.length > 1) {
        const max = Math.max(...hit.map(o => o.label.length));
        return hit.filter(o => o.label.length === max);
      }
      return hit;
    }

    default:
      return [];
  }
}

// Fayldan aniqlangani xavfsiz avtomat qo'yiladigan maydonlar
export const AUTO_FIELDS = new Set(['Учебный год', 'Учебный период']);
