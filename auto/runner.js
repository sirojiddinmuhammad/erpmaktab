// Avtomatik import fon navbati: bir o'qituvchiga bitta ish, umumiy chegara — concurrency.
// Ish grammY handlerini ushlab turmaydi (start darhol qaytadi).

export function createRunner({ concurrency = 2, log = console.log } = {}) {
  const busySet = new Set();   // ishlayotgan yoki navbatdagi o'qituvchilar
  const queue = [];
  let active = 0;

  // Jarayon xabari uchun chaqiruvlar: xatosi ishni to'xtatmaydi
  const safe = (fn, ...args) => { try { fn?.(...args); } catch (e) { log('[auto] progress', e?.message || e); } };

  async function run(tgId, { items, work, onDone, onRun, onItemStart, onItemDone }) {
    const results = [];
    safe(onRun);
    for (let i = 0; i < items.length; i++) {
      safe(onItemStart, i);
      let res;
      try { res = await work(items[i]); }
      catch (error) { res = { state: 'failed', error }; }
      results.push(res);
      safe(onItemDone, i, res);
    }
    busySet.delete(tgId);      // natija xabari kelganda yangi /auto boshlash mumkin
    try { await onDone(results); }
    catch (e) { log('[auto] onDone', tgId, e?.message || e); }
  }

  function pump() {
    while (active < concurrency && queue.length) {
      const [tgId, job] = queue.shift();
      active++;
      run(tgId, job).finally(() => { active--; pump(); });
    }
  }

  return {
    busy: tgId => busySet.has(tgId),
    start(tgId, job) {
      if (busySet.has(tgId)) return false;
      busySet.add(tgId);
      queue.push([tgId, job]);
      pump();
      return true;
    },
  };
}
