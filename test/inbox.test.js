import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inboxDecision, quarterOfDate, schoolYearOfDate, createInboxNotifier } from '../dashboard/inbox.js';

const msg = (over = {}) => ({
  document: { file_id: 'F', file_unique_id: 'U', file_name: '5 sinf.xlsx', file_size: 10 },
  caption: 'Matematika',
  forward_origin: { type: 'channel', chat: { title: 'Rejalar' }, date: 1794200000 },
  ...over,
});
const opt = (over = {}) => ({ fromId: 1, adminId: 1, awaitingFile: false, bulkActive: false, ...over });

test('inboxDecision: admin forward .xlsx qabul qilinadi', () => {
  assert.deepEqual(inboxDecision(msg(), opt()), {
    fileId: 'F', fileUniqueId: 'U', fileName: '5 sinf.xlsx', fileSize: 10,
    caption: 'Matematika', source: 'Rejalar', postedAt: new Date(1794200000 * 1000),
  });
});
test('inboxDecision: rad etiladigan holatlar', () => {
  assert.equal(inboxDecision(msg(), opt({ fromId: 2 })), null);
  assert.equal(inboxDecision(msg({ forward_origin: undefined }), opt()), null);
  assert.equal(inboxDecision(msg({ document: { file_id: 'F', file_unique_id: 'U', file_name: 'a.pdf' } }), opt()), null);
  assert.equal(inboxDecision(msg(), opt({ awaitingFile: true })), null);
  assert.equal(inboxDecision(msg(), opt({ bulkActive: true })), null);
  assert.equal(inboxDecision({ text: 'hi', forward_origin: {} }, opt()), null);
  assert.equal(inboxDecision(msg(), opt({ adminId: 0, fromId: 0 })), null);
});
test('inboxDecision: izoh qisqaradi, manba turlari', () => {
  assert.equal(inboxDecision(msg({ caption: 'a'.repeat(1500) }), opt()).caption.length, 1000);
  assert.equal(inboxDecision(msg({ caption: undefined }), opt()).caption, null);
  assert.equal(inboxDecision(msg({ forward_origin: { type: 'hidden_user', sender_user_name: 'Ali', date: 1 } }), opt()).source, 'Ali');
  assert.equal(inboxDecision(msg({ forward_origin: { type: 'user', sender_user: { first_name: 'Vali' }, date: 1 } }), opt()).source, 'Vali');
  assert.equal(inboxDecision(msg({ forward_origin: { type: 'chat', sender_chat: { title: 'Guruh' }, date: 1 } }), opt()).source, 'Guruh');
});
test('quarterOfDate (Toshkent vaqti)', () => {
  const q = s => quarterOfDate(new Date(s));
  assert.equal(q('2026-09-15T12:00:00Z'), 1);
  assert.equal(q('2026-11-07T12:00:00Z'), 1);
  assert.equal(q('2026-11-07T20:00:00Z'), 2); // Toshkentda 8-noyabr
  assert.equal(q('2026-11-09T12:00:00Z'), 2);
  assert.equal(q('2026-12-20T12:00:00Z'), 2);
  assert.equal(q('2027-02-01T12:00:00Z'), 3);
  assert.equal(q('2027-04-10T12:00:00Z'), 4);
  assert.equal(q('2027-07-01T12:00:00Z'), 1);
});
test('schoolYearOfDate', () => {
  assert.equal(schoolYearOfDate(new Date('2026-11-09T12:00:00Z')), '2026/2027');
  assert.equal(schoolYearOfDate(new Date('2027-03-01T12:00:00Z')), '2026/2027');
  assert.equal(schoolYearOfDate(new Date('2027-09-01T12:00:00Z')), '2027/2028');
});
test('createInboxNotifier: bitta xulosa xabari', async () => {
  const sent = []; const timers = [];
  const n = createInboxNotifier({
    send: async t => { sent.push(t); },
    delayMs: 3000,
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: t => { t.live = false; },
  });
  n.note(true); n.note(true); n.note(true); n.note(false);
  const live = timers.filter(t => t.live);
  assert.equal(live.length, 1);
  assert.equal(live[0].ms, 3000);
  await live[0].fn();
  assert.deepEqual(sent, ['📥 3 ta fayl qabul qilindi (1 ta takror). Dashboard → Ommaviy yuklash.']);
  n.note(true);
  await timers.filter(t => t.live).at(-1).fn();
  assert.equal(sent[1], '📥 1 ta fayl qabul qilindi. Dashboard → Ommaviy yuklash.');
});
