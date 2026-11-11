// Fanlar: kalit yasash va kiruvchi qiymatlarni tekshirish.

// Botdagi qoida bilan bir xil: 'x-' + nomdan slug. Band bo'lsa -2, -3, ...
export async function makeSubjectKey(uz, exists) {
  const slug = String(uz || '').toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 30);
  if (!slug) return null;
  const base = 'x-' + slug;
  if (!(await exists(base))) return base;
  for (let i = 2; i < 1000; i++) {
    const k = `${base}-${i}`;
    if (!(await exists(k))) return k;
  }
  return null;
}

export const SUBJECT_KEY_RE = /^[a-z0-9а-яё-]{1,40}$/;

const fail = error => ({ ok: false, error });

export function validateSubject(body) {
  if (!body || typeof body !== 'object') return fail("Ma'lumot yo'q");
  const uz = String(body.uz ?? '').trim();
  if (!uz || uz.length > 80) return fail("O'zbekcha nom 1–80 belgi bo'lishi kerak");
  const ruRaw = String(body.ru ?? '').trim();
  if (ruRaw.length > 80) return fail("Ruscha nom 80 belgidan oshmasin");
  let alias = [];
  if (body.alias != null) {
    if (!Array.isArray(body.alias)) return fail("Tanish so'zlar ro'yxat bo'lishi kerak");
    alias = body.alias.map(a => String(a ?? '').trim()).filter(Boolean);
    if (alias.length > 30) return fail("Tanish so'zlar 30 tadan oshmasin");
    if (alias.some(a => a.length > 80)) return fail("Tanish so'z 80 belgidan oshmasin");
  }
  return { ok: true, value: { uz, ru: ruRaw || uz, alias } };
}
