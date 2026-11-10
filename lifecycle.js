// Botni ishga tushirish va tinch to'xtatish.
//
// Deploy paytida eski va yangi nusxa bir zum birga ishlaydi. Telegram ulardan
// biriga 409 qaytaradi — yiqilish o'rniga kutib, qayta urinamiz.
// Railway eski nusxaga SIGTERM yuboradi — u polling'ni to'xtatib chiqadi.

export function createLifecycle(bot, {
  exit = code => process.exit(code),
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  log = console,
  retryMs = 3000,
  forceMs = 25_000,
} = {}) {
  let stopping = false;
  let polling = null;

  async function loop() {
    for (let attempt = 1; !stopping; attempt++) {
      try {
        await bot.start();
        return;                                 // bot.stop() chaqirildi
      } catch (e) {
        if (e?.error_code !== 409 || stopping) throw e;
        if (attempt === 1 || attempt % 20 === 0)
          log.warn(`409: boshqa nusxa ham ishlayapti, kutyapmiz (urinish ${attempt})`);
        await sleep(retryMs);
      }
    }
  }

  function run() {
    polling = loop().catch(e => {
      log.error('polling to\'xtadi:', e);
      exit(1);
    });
    return polling;
  }

  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    log.log(`${signal}: bot to'xtatilyapti...`);
    const force = setTimeout(() => exit(0), forceMs);
    force.unref?.();
    try {
      await bot.stop();
      await polling;                            // ishlayotgan xabar tugashini kutamiz
    } catch (e) {
      log.error('to\'xtatishda xato:', e.message);
    }
    clearTimeout(force);
    exit(0);
  }

  return { run, shutdown };
}
