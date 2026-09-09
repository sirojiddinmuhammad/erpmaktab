import ExcelJS from 'exceljs';

const clean = v => String(v ?? '')
  .replace(/_x000D_/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Faylni o'qib [{topic, hw}] ro'yxatiga aylantiradi. 1-qator sarlavha.
export async function readRows(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Faylda varaq topilmadi.');

  const rows = [];
  ws.eachRow((row, i) => {
    if (i === 1) return; // sarlavha
    const topic = clean(row.getCell(2).text);
    if (!topic) return;
    rows.push({ topic, hw: clean(row.getCell(3).text) });
  });

  if (!rows.length) throw new Error("Faylda mavzu topilmadi.");
  return { rows, sheetName: ws.name };
}

// Yangi fayl yasaydi. Raqamlar 1 dan qayta tartiblanadi.
export async function writeRows(rows, path, sheetName = 'Sheet1') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31) || 'Sheet1');
  ws.addRow(['П/Н', 'Тема', 'Дом. Задания']);
  rows.forEach((r, i) => ws.addRow([i + 1, r.topic, r.hw]));
  await wb.xlsx.writeFile(path);
  return path;
}

// "3-4, 8-9" -> [[3,4],[8,9]]. Xato bo'lsa { error } qaytaradi.
export function parsePairs(text, max) {
  const parts = String(text).split(/[,;\n]+/).map(t => t.trim()).filter(Boolean);
  if (!parts.length) return { error: 'Hech narsa yozilmadi. Namuna: 3-4, 8-9' };

  const pairs = [];
  const used = new Set();

  for (const p of parts) {
    const m = p.match(/^(\d+)\s*[-–—+]\s*(\d+)$/);
    if (!m) return { error: `"${p}" tushunarsiz. Namuna: 3-4, 8-9` };

    const a = Number(m[1]);
    const b = Number(m[2]);

    if (a < 1 || b > max) return { error: `${a}-${b}: bunday raqam yo'q. Mavjud: 1-${max}` };
    if (b !== a + 1) return { error: `${a}-${b}: faqat yonma-yon turgan mavzular birlashadi.` };
    if (used.has(a) || used.has(b)) return { error: `${a} yoki ${b} ikki marta ishlatilgan.` };

    used.add(a);
    used.add(b);
    pairs.push([a, b]);
  }
  return { pairs };
}

// Mavzular nuqta bilan, uy vazifalari vergul bilan qo'shiladi.
export function applyMerges(rows, pairs) {
  const partner = new Map(pairs.map(([a, b]) => [a, b]));
  const skip = new Set(pairs.map(([, b]) => b));

  const out = [];
  rows.forEach((r, idx) => {
    const n = idx + 1;
    if (skip.has(n)) return;

    if (partner.has(n)) {
      const other = rows[partner.get(n) - 1];
      out.push({
        topic: [r.topic, other.topic].filter(Boolean).join('. '),
        hw: [r.hw, other.hw].filter(Boolean).join(', '),
      });
    } else {
      out.push({ ...r });
    }
  });
  return out;
}
