// Qamrov jadvali: sinf (1–11) × fan. Juftlik bazada istalgan yil/chorakda
// bo'lsa "kutiladi"; tanlangan yil+chorakda bo'lsa ok, aks holda missing.

export function buildCoverage(rows, { year, quarter }) {
  const cells = {};
  const subjects = new Set();
  for (const r of rows) {
    const k = `${r.grade}|${r.subject_key}`;
    subjects.add(r.subject_key);
    if (r.year === year && Number(r.quarter) === Number(quarter))
      cells[k] = { state: 'ok', id: r.id, topics: r.topics ?? null };
    else if (!cells[k]) cells[k] = { state: 'missing' };
  }
  const missing = Object.values(cells).filter(c => c.state === 'missing').length;
  return {
    grades: Array.from({ length: 11 }, (_, i) => i + 1),
    subjects: [...subjects].sort(),
    cells,
    missing,
  };
}
