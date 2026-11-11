// Dashboard testlari uchun soxta bog'liqliklar va real HTTP server.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createDashboard } from '../dashboard/server.js';

export const ORIGIN = 'https://panel.test';

export async function startPanel(over = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-'));
  const htmlPath = path.join(tmp, 'index.html');
  await fs.writeFile(htmlPath, '<!doctype html><title>Panel</title>');
  const calls = { listPlans: [], savePlan: [], sendDocument: [], archive: [], markInbox: [], download: [] };
  const inbox = over.inbox || [];
  const plans = over.plans || [];
  const db = {
    async listPlans(offset, limit, filter) { calls.listPlans.push({ offset, limit, filter }); return { rows: plans, total: plans.length }; },
    async panelCounts() { return { total: 3, inQuarter: 1, archived: 0 }; },
    async coverageRows() { return [{ id: 1, grade: 5, subject_key: 'math', quarter: 2, year: '2026/2027', topics: 3 }, { id: 2, grade: 6, subject_key: 'math', quarter: 1, year: '2026/2027', topics: 3 }]; },
    async findPlanByKey() { return null; },
    async planForPanel(id) { return plans.find(p => Number(p.id) === id) || null; },
    async planYears() { return ['2026/2027']; },
    async savePlan(p) { calls.savePlan.push(p); return { ...p, id: 9, is_new: true }; },
    async archivePlan(id) { calls.archive.push(id); return true; },
    async restorePlan() { return true; },
    async listInbox() { return inbox.filter(r => !r.done); },
    async getInbox(ids) { return inbox.filter(r => !r.done && ids.includes(r.id)); },
    async countInbox() { return inbox.filter(r => !r.done).length; },
    async markInbox(ids, field) { calls.markInbox.push({ ids, field }); for (const r of inbox) if (ids.includes(r.id)) r.done = field; return ids.length; },
    ...over.db,
  };
  const dash = createDashboard({
    db,
    subjects: () => [{ key: 'math', uz: 'Matematika', ru: 'Математика' }, { key: 'russian', uz: 'Rus tili', ru: 'Русский язык' }],
    keyOf: name => (/русский/i.test(name) ? 'russian' : /matematika/i.test(name) ? 'math' : null),
    currentYear: () => '2026/2027',
    guessGrading: () => null,
    readRows: async () => ({ rows: [{ topic: 'a', hw: '' }, { topic: 'b', hw: 'x' }] }),
    sendDocument: async (buf, fileName) => { calls.sendDocument.push({ size: buf.length, fileName }); return 'FILE1'; },
    downloadFile: async id => { calls.download.push(id); return Buffer.from('xlsx-bytes'); },
    publicOrigin: ORIGIN,
    htmlPath,
    tmpDir: tmp,
    log: () => {},
    ...over.deps,
  });
  const server = http.createServer(async (req, res) => {
    if (await dash.handle(req, res)) return;
    res.writeHead(200); res.end('guide');
  });
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async () => {
    const link = new URL(dash.issueLoginLink());
    const r = await fetch(base + link.pathname + link.search, { redirect: 'manual' });
    return r.headers.get('set-cookie').split(';')[0];
  };
  const close = async () => { await new Promise(r => server.close(r)); await fs.rm(tmp, { recursive: true, force: true }); };
  return { base, dash, calls, login, close, tmp };
}
