// Dashboard'ga kelgan qiymatlarni tekshirish va normallashtirish.

const intIn = (v, lo, hi) => {
  const s = String(v ?? '').trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= lo && n <= hi ? n : null;
};

const validYear = y => {
  const m = String(y ?? '').match(/^(20\d{2})\/(20\d{2})$/);
  return !!m && Number(m[2]) === Number(m[1]) + 1;
};

const ERR = {
  grade: "Sinf 1–11 oralig'ida bo'lishi kerak",
  quarter: "Chorak 1–4 oralig'ida bo'lishi kerak",
  medium: "Til uz yoki ru bo'lishi kerak",
  grading: "Baholash normal yoki bsb bo'lishi kerak",
  year: "Yil 2026/2027 ko'rinishida bo'lishi kerak",
  subject: 'Fan topilmadi',
  file: "Fayl yo'q",
  topics: "Mavzular soni noto'g'ri",
  page: "Sahifa raqami noto'g'ri",
};

const fail = error => ({ ok: false, error });

export function validatePlan(input, subjectKeys) {
  if (!input || typeof input !== 'object') return fail(ERR.file);
  const grade = intIn(input.grade, 1, 11);
  if (grade == null) return fail(ERR.grade);
  const subjectKey = input.subjectKey ?? input.subject;
  if (!subjectKeys.has(subjectKey)) return fail(ERR.subject);
  const quarter = intIn(input.quarter, 1, 4);
  if (quarter == null) return fail(ERR.quarter);
  if (!validYear(input.year)) return fail(ERR.year);
  if (input.medium !== 'uz' && input.medium !== 'ru') return fail(ERR.medium);
  const grading = input.grading || 'normal';
  if (grading !== 'normal' && grading !== 'bsb') return fail(ERR.grading);
  if (typeof input.fileId !== 'string' || !input.fileId) return fail(ERR.file);
  if (typeof input.fileName !== 'string' || !input.fileName) return fail(ERR.file);
  let topics = null;
  if (input.topics != null && input.topics !== '') {
    const s = String(input.topics).trim();
    if (!/^\d{1,5}$/.test(s)) return fail(ERR.topics);
    topics = Number(s);
  }
  return { ok: true, value: {
    grade, subjectKey, quarter, year: input.year, medium: input.medium,
    grading, fileId: input.fileId, fileName: input.fileName, topics,
  } };
}

export const planKey = p =>
  `${p.grade}|${p.subjectKey}|${p.quarter}|${p.year}|${p.medium}|${p.grading}`;

export function findDuplicates(rows) {
  const seen = new Map();
  rows.forEach((r, i) => {
    const k = planKey(r);
    seen.set(k, [...(seen.get(k) || []), i]);
  });
  const out = new Set();
  for (const idx of seen.values()) if (idx.length > 1) idx.forEach(i => out.add(i));
  return out;
}

// Filtrlar ixtiyoriy; bor bo'lsa validatePlan bilan bir xil qoidalar.
export function validateFilter(query, subjectKeys) {
  const v = {};
  const has = k => query.has(k) && query.get(k) !== '';
  if (has('grade')) { v.grade = intIn(query.get('grade'), 1, 11); if (v.grade == null) return fail(ERR.grade); }
  if (has('subject')) { v.subjectKey = query.get('subject'); if (!subjectKeys.has(v.subjectKey)) return fail(ERR.subject); }
  if (has('quarter')) { v.quarter = intIn(query.get('quarter'), 1, 4); if (v.quarter == null) return fail(ERR.quarter); }
  if (has('year')) { v.year = query.get('year'); if (!validYear(v.year)) return fail(ERR.year); }
  if (has('medium')) { v.medium = query.get('medium'); if (v.medium !== 'uz' && v.medium !== 'ru') return fail(ERR.medium); }
  if (has('grading')) { v.grading = query.get('grading'); if (v.grading !== 'normal' && v.grading !== 'bsb') return fail(ERR.grading); }
  if (has('q')) v.q = query.get('q').trim().slice(0, 100);
  v.page = 1;
  if (has('page')) {
    const s = query.get('page');
    if (!/^\d{1,6}$/.test(s) || Number(s) < 1) return fail(ERR.page);
    v.page = Number(s);
  }
  v.archived = query.get('archived') === '1';
  return { ok: true, value: v };
}
