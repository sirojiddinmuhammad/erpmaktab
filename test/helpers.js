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
  const calls = { listPlans: [], savePlan: [], sendDocument: [], archive: [], markInbox: [], download: [], subjects: [], reload: 0, addInboxMany: [], existsMany: [], setMeta: [] };
  const meta = new Map(Object.entries(over.meta || {}));
  const subjects = new Map([['math', { key: 'math', uz: 'Matematika', ru: 'Математика', alias: [], plans: 2, archived: false }], ['algebra+geometry', { key: 'algebra+geometry', uz: 'Algebra va geometriya', ru: 'Алгебра и геометрия', alias: [], plans: 0, archived: false }], ['x-robot', { key: 'x-robot', uz: 'Robototexnika', ru: 'Робототехника', alias: [], plans: 1, archived: true }]]);
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
    async addInboxMany(recs) { calls.addInboxMany.push(recs); return recs.length; },
    async knownDriveIds(ids) { return new Set(ids.filter(i => (over.knownDrive || []).includes(i))); },
    async existsMany(keys) { calls.existsMany.push(keys); return keys.map((k, i) => (k.grade === 5 ? i : -1)).filter(i => i >= 0); },
    async getMeta(k) { return meta.get(k) ?? null; },
    async setMeta(k, v) { calls.setMeta.push([k, v]); meta.set(k, v); },
    async subjectsForPanel() { return [...subjects.values()]; },
    async subjectKeyExists(k) { return subjects.has(k); },
    async insertSubject(v) { calls.subjects.push(['insert', v]); subjects.set(v.key, { ...v, plans: 0, archived: false }); },
    async getSubject(k) { return subjects.get(k) || null; },
    async updateSubject(k, v) { calls.subjects.push(['update', k, v]); Object.assign(subjects.get(k), v); },
    async archiveSubject(k, withPlans) { calls.subjects.push(['archive', k, withPlans]); return true; },
    async restoreSubject(k) { calls.subjects.push(['restore', k]); return true; },
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
    reloadSubjects: async () => { calls.reload++; },
    drive: null,
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
