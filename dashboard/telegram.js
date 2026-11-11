// Telegram 429 (juda ko'p so'rov) javobida retry_after kutib qayta urinish.

export async function withRetry(fn, { sleep = ms => new Promise(r => setTimeout(r, ms)), tries = 3 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e?.error_code !== 429 || i >= tries) throw e;
      await sleep((Number(e.parameters?.retry_after) || 1) * 1000);
    }
  }
}
