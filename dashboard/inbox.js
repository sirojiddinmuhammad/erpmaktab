// Admin forward qilgan reja fayllari: qabul qilish qarori, sana yordamchilari,
// va bir nechta fayldan keyin bitta xulosa xabari.

const TZ_OFFSET_MS = 5 * 3600 * 1000; // Toshkent, UTC+5 (yozgi vaqt yo'q)
const local = d => new Date(d.getTime() + TZ_OFFSET_MS);

export function quarterOfDate(d) {
  const t = local(d);
  const m = t.getUTCMonth(), day = t.getUTCDate();
  if (m === 8 || m === 9) return 1;
  if (m === 10) return day < 8 ? 1 : 2;
  if (m === 11) return 2;
  if (m <= 2) return 3;
  if (m <= 5) return 4;
  return 1;
}

export function schoolYearOfDate(d) {
  const t = local(d);
  const y = t.getUTCMonth() >= 8 ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
  return `${y}/${y + 1}`;
}

function sourceOf(o) {
  return o.chat?.title || o.sender_chat?.title || o.sender_user?.first_name ||
    o.sender_user_name || null;
}

export function inboxDecision(msg, { fromId, adminId, awaitingFile, bulkActive }) {
  if (!adminId || fromId !== adminId) return null;
  if (awaitingFile || bulkActive) return null;
  const doc = msg?.document;
  const origin = msg?.forward_origin;
  if (!doc || !origin) return null;
  if (!/\.xlsx?$/i.test(doc.file_name || '')) return null;
  return {
    fileId: doc.file_id,
    fileUniqueId: doc.file_unique_id,
    fileName: doc.file_name,
    fileSize: doc.file_size ?? null,
    caption: msg.caption ? String(msg.caption).slice(0, 1000) : null,
    source: sourceOf(origin),
    postedAt: origin.date ? new Date(origin.date * 1000) : null,
  };
}

export function createInboxNotifier({ send, delayMs = 3000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let added = 0, dup = 0, timer = null;
  const flush = async () => {
    timer = null;
    const a = added, d = dup;
    added = 0; dup = 0;
    const text = `📥 ${a} ta fayl qabul qilindi${d ? ` (${d} ta takror)` : ''}. Dashboard → Ommaviy yuklash.`;
    try { await send(text); } catch (e) { console.error('[inbox] notify', e?.message || e); }
  };
  return {
    note(wasAdded) {
      if (wasAdded) added++; else dup++;
      if (timer) clearTimer(timer);
      timer = setTimer(flush, delayMs);
    },
  };
}
