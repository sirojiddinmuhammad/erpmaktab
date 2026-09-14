import { chromium } from 'playwright';

const BASE = 'https://schools.emaktab.uz';
const IMPORT_URL = `${BASE}/v2/journals/planning/import`;

// Fayldagi ustun nomi uchun shablonlar -> eMaktabdagi maydon.
// Rus, o'zbek lotin va kirill variantlari qamrab olingan.
const COLUMN_RULES = [
  {
    target: 'Номер урока',
    re: /^\s*(п\s*\/?\s*н|№|n|nn|t\s*\/?\s*r|т\s*\/?\s*р|тартиб|tartib|дарс\s*раками|dars\s*raqami|номер|raqam|raqami|рақам|рақами)\s*$/i,
  },
  {
    target: 'Тема урока',
    re: /(тема|mavzu|мавзу|dars\s*mavzu|тема\s*урока)/i,
  },
  {
    target: 'Домашнее задание',
    re: /(дом|задани|uy\s*vazifa|уй\s*вазифа|vazifa|вазифа|topshiriq|топшириқ)/i,
  },
];

// Eski kod uchun moslik (mapColumns ichida ishlatiladi)
const COLUMN_MAP = Object.fromEntries(COLUMN_RULES.map(r => [r.target, r.target]));

// Bitta brauzer hammaga xizmat qiladi, har foydalanuvchiga alohida context.
// Har safar yangi brauzer ochish 2-4 soniya olardi.
let sharedBrowser = null;
async function getBrowser() {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  return sharedBrowser;
}

// Rasm, shrift, video, analitika — bizga kerak emas. Sezilarli tezlashtiradi.
async function blockJunk(ctx) {
  await ctx.route('**/*', route => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'font' || t === 'media' || t === 'stylesheet') {
      return route.abort();
    }
    const u = route.request().url();
    if (/google-analytics|googletagmanager|yandex|metrika|facebook|doubleclick/i.test(u)) {
      return route.abort();
    }
    return route.continue();
  });
}

export class EmaktabSession {
  constructor() {
    this.browser = null;
    this.ctx = null;
    this.page = null;
    this.lastUsed = Date.now();
  }

  touch() { this.lastUsed = Date.now(); }

  // Label matni bo'yicha undan keyingi birinchi <select>
  sel(label) {
    return this.page.locator(
      `xpath=//*[normalize-space(text())="${label}"]/following::select[1]`
    );
  }

  // Sayt ishlayaptimi? Texnik ishlar yoki server xatosini aniqlaydi.
  async assertAlive(resp) {
    const page = this.page;

    const status = resp?.status?.() ?? 200;
    if ([500, 502, 503, 504].includes(status)) throw new Error('MAINTENANCE');

    const bad = await page.evaluate(() => {
      const t = (document.body?.innerText || '').slice(0, 2000);
      return /технически[ей]\s*работ|texnik\s*ishlar|техник\s*ишлар|временно\s*недоступ|vaqtincha\s*ishlamayapti|на\s*обслуживании|service\s*unavailable|bad\s*gateway|502|503/i
        .test(t) && t.length < 1500;
    }).catch(() => false);

    if (bad) throw new Error('MAINTENANCE');
  }

  // Ishonchli o'tish: tarmoq xatosi ham texnik ishlar deb hisoblanadi
  async go(url) {
    let resp;
    try {
      resp = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      if (/net::|ERR_|Timeout/i.test(e.message)) throw new Error('MAINTENANCE');
      throw e;
    }
    await this.assertAlive(resp);
    return resp;
  }

  // Tugmani bir necha usulda qidiradi: matn, input value, button, link.
  // eMaktabda "Далее >" ba'zan <input type=submit value="Далее >"> bo'ladi.
  async clickButton(word, { timeout = 15000 } = {}) {
    const page = this.page;
    const tries = [
      `input[type="submit"][value*="${word}"]`,
      `input[type="button"][value*="${word}"]`,
      `button:has-text("${word}")`,
      `a:has-text("${word}")`,
      `text=${word}`,
    ];

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const sel of tries) {
        const loc = page.locator(sel).first();
        if (await loc.count().catch(() => 0)) {
          await loc.click({ timeout: 5000 }).catch(() => {});
          return true;
        }
      }
      await page.waitForTimeout(500);
    }

    // Topilmadi — avval sayt tirikmi tekshiramiz
    await this.assertAlive(null);

    const info = await page.evaluate(() =>
      document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 400)
    ).catch(() => '');
    throw new Error(`"${word}" tugmasi topilmadi.\n\n${info}`);
  }

  // Sahifa tinchishini kutish. networkidle ishlatmaymiz —
  // eMaktab doimiy so'rov yuborib turadi va u hech qachon tugamaydi.
  async settle(ms = 1200) {
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(ms);
  }

  async launch() {
    this.browser = await getBrowser();
    this.ctx = await this.browser.newContext({ locale: 'ru-RU' });
    await blockJunk(this.ctx);
    this.page = await this.ctx.newPage();
    this.page.setDefaultTimeout(30_000);
  }

  // storageState bo'lsa qayta login qilinmaydi
  async restore(storageState) {
    this.browser = await getBrowser();
    this.ctx = await this.browser.newContext({ locale: 'ru-RU', storageState });
    await blockJunk(this.ctx);
    this.page = await this.ctx.newPage();
    this.page.setDefaultTimeout(30_000);

    await this.go(IMPORT_URL);
    // login subdomeniga otib yuborsa — sessiya eskirgan
    return !/login\.emaktab\.uz/.test(this.page.url());
  }

  async login(username, password) {
    const page = this.page;
    await this.go('https://login.emaktab.uz/login');

    const userCandidates = [
      'input[name="login"]',
      'input[name="Login"]',
      'input[name="username"]',
      'input[name="UserName"]',
      '#login',
      'input[type="text"]:not([type="hidden"])',
      'input[type="email"]',
    ];

    let userInput = null;
    for (const s of userCandidates) {
      const loc = page.locator(s).first();
      if (await loc.count() && await loc.isVisible().catch(() => false)) {
        userInput = loc;
        break;
      }
    }

    const passInput = page.locator('input[type="password"]').first();

    if (!userInput || !(await passInput.count())) {
      // Sahifadagi maydonlarni ro'yxatlab beramiz — selektorni aniqlash uchun
      const found = await page.locator('input').evaluateAll(list =>
        list.map(i => `${i.type}|name=${i.name}|id=${i.id}`).join('  ///  ')
      );
      throw new Error(`Login maydoni topilmadi. URL: ${page.url()}\nSahifadagi inputlar: ${found || 'yo\'q'}`);
    }

    await userInput.fill(username);
    await passInput.fill(password);

    await page.locator('button[type="submit"], input[type="submit"]').first().click();
    await page.waitForURL(u => !/login\.emaktab\.uz/.test(u.href), { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(600);

    if (/login\.emaktab\.uz/.test(page.url())) {
      const err = await page.locator('.error, .alert, [class*="error"]').first()
        .innerText().catch(() => '');
      throw new Error(err ? `BAD_CREDENTIALS: ${err.slice(0, 120)}` : 'BAD_CREDENTIALS');
    }

    const fullName = await this.getUserName();
    return { state: await this.ctx.storageState(), fullName };
  }

  // Foydalanuvchi ismini o'qiydi. Aniq selektordan boshlab, zaxiralar bilan.
  async getUserName() {
    return await this.page.evaluate(() => {
      const clean = t => (t || '').replace(/\s+/g, ' ').trim();
      const good = t => t && t.length >= 3 && t.length <= 60 &&
        !/Помощь|Выход|Сотрудник|Учитель|Yordam|Chiqish/i.test(t);

      // 1) Rasmiy test-id ichidagi ism
      const box = document.querySelector('[data-test-id="user-profile-info"]');
      if (box) {
        const p = box.querySelector('.user-profile-box__initials');
        if (p && good(clean(p.textContent))) return clean(p.textContent);
      }

      // 2) Klass bo'yicha
      const init = document.querySelector('.user-profile-box__initials');
      if (init && good(clean(init.textContent))) return clean(init.textContent);

      // 3) "Сотрудник" / "Учитель" yozuvidan oldingi qator
      const cat = [...document.querySelectorAll('p, span, div')]
        .find(e => e.children.length === 0 && /^(Сотрудник|Учитель)$/i.test(clean(e.textContent)));
      if (cat) {
        const prev = cat.previousElementSibling;
        if (prev && good(clean(prev.textContent))) return clean(prev.textContent);
      }

      return '';
    }).catch(() => '');
  }

  // "Мои классы" sahifasidan sinf va fanlarni o'qiydi.
  // Natija: [{ cls: '4-А', subjects: ['Воспитание', ...] }]
  async fetchClasses() {
    await this.go(`${BASE}/v2/myclasses`);
    await this.page.waitForSelector('#ContentPanelMyClasses', { timeout: 15000 }).catch(() => {});
    await this.settle(400);

    return await this.page.evaluate(() => {
      const norm = t => (t || '').replace(/\s+/g, ' ').trim();
      const out = [];

      const panel = document.querySelector('#ContentPanelMyClasses') || document;
      // Har bir sinf bloki .cc ichida. Topilmasa — sinf havolasidan yuqoriga chiqamiz.
      let blocks = [...panel.querySelectorAll('.cc')];
      if (!blocks.length) {
        blocks = [...panel.querySelectorAll('a[href*="/v2/class?class="]')]
          .map(a => a.closest('div'))
          .filter(Boolean);
      }

      for (const b of blocks) {
        const clsLink = b.querySelector('a[href*="/v2/class?class="]');
        if (!clsLink) continue;

        const cls = norm(clsLink.textContent);
        if (!cls) continue;

        // Fanlar: /subject/ havolalari. Nomi title'da aniqroq turadi.
        const subjects = [...b.querySelectorAll('a[href*="/subject/"]')]
          .map(a => norm(a.getAttribute('title') || a.textContent))
          .filter(Boolean);

        if (!subjects.length) continue;
        if (out.some(o => o.cls === cls)) continue;

        out.push({ cls, subjects: [...new Set(subjects)] });
      }
      return out;
    }).catch(() => []);
  }

  // Ism bazada bo'lmasa, ochiq sahifadan olamiz
  async fetchNameIfNeeded() {
    try {
      if (!/emaktab\.uz/.test(this.page.url())) return '';
      return await this.getUserName();
    } catch { return ''; }
  }

  // "Мои классы" sahifasidan sinf va fanlar ro'yxati
  async getMyClasses() {
    await this.go(`${BASE}/v2/myclasses`);
    await this.settle(600);

    return await this.page.evaluate(() => {
      const text = document.body.innerText;
      const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim());

      const out = [];
      let current = null;

      for (const line of lines) {
        // Sinf sarlavhasi: "4-A", "11-В", "2-Г"
        if (/^\d{1,2}\s*-\s*[A-ZА-ЯЁ]$/i.test(line)) {
          current = { name: line.replace(/\s+/g, ''), subjects: [] };
          out.push(current);
          continue;
        }

        const m = line.match(/^Журнал\s+предмета\s*:\s*(.+)$/i);
        if (m && current) {
          current.subjects = m[1]
            .split(',')
            .map(x => x.trim().replace(/\.$/, ''))
            .filter(Boolean);
        }
      }

      return out.filter(c => c.subjects.length);
    }).catch(() => []);
  }

  // ---- 1-qadam: fayl ----
  async uploadFile(filePath) {
    const page = this.page;

    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.go(IMPORT_URL);
      await this.settle(600);

      if (/login\.emaktab\.uz/.test(page.url())) throw new Error('BAD_CREDENTIALS');

      // Fayl maydoni bormi?
      const input = page.locator('input[type="file"]');
      if (await input.count()) {
        await input.first().setInputFiles(filePath, { timeout: 20000 });

        // "1-qatorda ustun nomlari"
        const radio = page.locator('input[type="radio"]');
        if (await radio.count()) await radio.first().check().catch(() => {});

        await this.settle(800);   // fayl qabul qilinishini kutamiz

        // Sahifada xato chiqdimi?
        const err = await page.evaluate(() => {
          const t = document.body.innerText;
          const m = t.match(/[^\n]*(не поддерж|неверн|ошибк|формат)[^\n]*/i);
          return m ? m[0].trim() : '';
        }).catch(() => '');
        if (err && !/Ошибка!/.test(err)) throw new Error(`eMaktab: ${err}`);

        await this.clickButton('Далее');
        await this.settle(400);
        return;
      }

      // Yo'q bo'lsa: yarim qolgan importni bekor qilamiz va qaytadan urinamiz
      const cancel = page.locator('text=Отменить импорт этого файла');
      if (await cancel.count()) {
        await cancel.first().click().catch(() => {});
        await this.settle(1000);
        continue;
      }

      // "Назад" bilan 1-qadamga qaytishga urinamiz
      const back = page.locator('text=< Назад, text=Назад');
      if (await back.count()) {
        await back.first().click().catch(() => {});
        await this.settle(800);
        continue;
      }

      if (attempt === 3) {
        const info = await page.evaluate(() =>
          document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 500)
        ).catch(() => '');
        throw new Error(
          `Fayl yuklash maydoni topilmadi.\nURL: ${page.url()}\n\n${info}`
        );
      }
      await this.settle(1000);
    }
  }

  // ---- 2-qadam: selectlar ----
  async options(label, { timeout = 20000 } = {}) {
    const s = this.sel(label);
    await s.waitFor({ state: 'attached', timeout });

    const deadline = Date.now() + timeout;
    let last = [];

    // Bog'liq ro'yxatlar AJAX bilan to'ladi — to'lguncha kutamiz
    while (Date.now() < deadline) {
      last = await s.locator('option').evaluateAll(list =>
        list
          .map((o, index) => ({ index, value: o.value, label: o.textContent.trim() }))
          // Faqat matn bo'yicha filtr: "Весь класс" kabi variantlarda value bo'sh bo'lishi mumkin
          .filter(o => o.label && !/^(Не выбрано|Не выбран|—|-)$/i.test(o.label))
      );
      if (last.length) return last;
      await this.page.waitForTimeout(500);
    }
    return last;
  }

  // Diagnostika: select bo'sh chiqqanda nima borligini ko'rsatadi
  async debugSelect(label) {
    const s = this.sel(label);
    if (!(await s.count())) return `"${label}" uchun select topilmadi`;
    const raw = await s.locator('option').evaluateAll(l =>
      l.map(o => `[${o.value}] ${o.textContent.trim()}`).join(' // ')
    );
    const disabled = await s.isDisabled().catch(() => null);
    return `select topildi (disabled=${disabled}), optionlar: ${raw || 'bo\'sh'}`;
  }

  // index bo'yicha tanlaymiz — bo'sh value'li variantlar uchun ishonchli
  // Barcha selectlarni xom holda ko'rsatadi (/debug uchun)
  async dumpAll(labels) {
    const out = [];
    for (const l of labels) out.push(`${l}: ${await this.debugSelect(l)}`);
    return out.join('\n\n');
  }

  async pick(label, index) {
    await this.sel(label).selectOption({ index });
    // Uzoq kutmaymiz: keyingi options() o'zi to'lguncha so'rab turadi
    await this.settle(250);
  }

  // ---- ustun mosligi: avtomatik ----
  async mapColumns() {
    await this.page.waitForFunction(() =>
      [...document.querySelectorAll('select')].some(s =>
        [...s.options].some(o => /номер\s*урока/i.test(o.textContent))
      ), null, { timeout: 30000 }
    ).catch(() => {});

    const rules = COLUMN_RULES.map(r => ({ target: r.target, src: r.re.source, flags: r.re.flags }));

    const plan = await this.page.evaluate(({ rules }) => {
      const norm = t => (t || '').replace(/\s+/g, ' ').trim();
      const all = [...document.querySelectorAll('select')];

      const mapping = all
        .map((sel, idx) => ({ sel, idx }))
        .filter(({ sel }) => [...sel.options].some(o => /номер\s*урока/i.test(o.textContent)));

      if (!mapping.length) {
        return { actions: [], report: [`Moslash selectlari topilmadi. Sahifada ${all.length} ta select bor.`] };
      }

      const labelOf = sel => {
        const tr = sel.closest('tr');
        if (tr) {
          for (const c of [...tr.querySelectorAll('td, th')])
            if (!c.querySelector('select')) return norm(c.textContent);
        }
        let n = sel.parentElement;
        for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
          const t = norm(n.textContent.replace(sel.textContent, ''));
          if (t) return t;
        }
        return '';
      };

      const actions = [];
      const report = [];
      const used = new Set();

      // 1) Har bir moslash selectining qator nomini shablonlarga solishtiramiz
      for (const m of mapping) {
        const label = labelOf(m.sel);
        const rule = rules.find(r => new RegExp(r.src, r.flags).test(label));
        if (!rule) continue;

        const opts = [...m.sel.options];
        let oi = opts.findIndex(o => norm(o.textContent).toLowerCase() === rule.target.toLowerCase());
        if (oi === -1) oi = opts.findIndex(o => norm(o.textContent).toLowerCase().includes(rule.target.toLowerCase()));
        if (oi === -1) { report.push(`${label}: "${rule.target}" varianti yo'q`); continue; }

        used.add(m.idx);
        actions.push({ selectIndex: m.idx, optionIndex: oi });
        report.push(`${label} -> ${rule.target}`);
      }

      // 2) Topilmaganlarni tartib bo'yicha to'ldiramiz (raqam, mavzu, vazifa)
      if (actions.length < Math.min(3, mapping.length)) {
        const order = ['Номер урока', 'Тема урока', 'Домашнее задание'];
        mapping.forEach((m, i) => {
          if (used.has(m.idx) || i >= order.length) return;
          const opts = [...m.sel.options];
          const oi = opts.findIndex(o => norm(o.textContent).toLowerCase().includes(order[i].toLowerCase()));
          if (oi === -1) return;
          used.add(m.idx);
          actions.push({ selectIndex: m.idx, optionIndex: oi });
          report.push(`${labelOf(m.sel) || `#${i + 1}`} -> ${order[i]} (tartib bo'yicha)`);
        });
      }

      return { actions, report };
    }, { rules });

    for (const a of plan.actions) {
      await this.page.locator('select').nth(a.selectIndex).selectOption({ index: a.optionIndex });
    }

    this.lastMapReport = plan.report.join('\n');
    return { done: plan.actions.length, need: 3, report: this.lastMapReport };
  }

  // Qo'lda moslash uchun: moslash selectlari va ularning variantlari
  async mappingSelects() {
    await this.page.waitForFunction(() =>
      [...document.querySelectorAll('select')].some(s =>
        [...s.options].some(o => /номер\\s*урока/i.test(o.textContent))
      ), null, { timeout: 20000 }
    ).catch(() => {});

    return await this.page.evaluate(() => {
      const all = [...document.querySelectorAll('select')];
      const labelOf = sel => {
        const tr = sel.closest('tr');
        if (tr) {
          for (const c of [...tr.querySelectorAll('td, th')])
            if (!c.querySelector('select')) return c.textContent.replace(/\\s+/g, ' ').trim();
        }
        return '';
      };
      return all
        .map((sel, selectIndex) => ({ sel, selectIndex }))
        .filter(({ sel }) => [...sel.options].some(o => /номер\\s*урока/i.test(o.textContent)))
        .map(({ sel, selectIndex }) => ({
          selectIndex,
          label: labelOf(sel) || `Ustun ${selectIndex}`,
          options: [...sel.options].map((o, index) => ({ index, label: o.textContent.trim() })),
        }));
    });
  }

  async setSelect(selectIndex, optionIndex) {
    await this.page.locator('select').nth(selectIndex).selectOption({ index: optionIndex });
  }

  // Moslashdan keyin "Далее" ni bosish (qo'lda rejim uchun alohida)
  async submitMapping() {
    await this.clickButton('Далее');
    await this.page.waitForSelector('table tr', { timeout: 30000 }).catch(() => {});
    await this.settle(400);
  }

  // ---- 3-qadam: tekshiruv jadvali ----
  async preview() {
    const data = await this.page.evaluate(() => {
      const norm = t => (t || '').replace(/\s+/g, ' ').trim();

      const table = [...document.querySelectorAll('table')]
        .find(t => /Тема\s*урока/i.test(t.textContent));
      if (!table) return { rows: [] };

      const trs = [...table.querySelectorAll('tr')];

      // Sarlavhadan ustun raqamlarini olamiz
      let col = null;
      for (const tr of trs) {
        const cells = [...tr.querySelectorAll('th, td')].map(c => norm(c.textContent));
        if (cells.some(c => /Тема\s*урока/i.test(c))) {
          col = {
            lesson: cells.findIndex(c => /№\s*урока/i.test(c)),
            topic:  cells.findIndex(c => /Тема\s*урока/i.test(c)),
            hw:     cells.findIndex(c => /Домашнее\s*задание/i.test(c)),
            status: cells.findIndex(c => /Предварительная|проверк/i.test(c)),
          };
          break;
        }
      }
      if (!col || col.topic === -1) return { rows: [] };

      const rows = [];
      for (const tr of trs) {
        const tds = [...tr.querySelectorAll('td')];
        if (!tds.length) continue;

        const cells = tds.map(c => norm(c.innerText));
        if (!/^\d+$/.test(cells[0])) continue;

        const pick = i => (i >= 0 && i < cells.length ? cells[i] : '');

        // MUHIM: holat faqat o'z ustunidan o'qiladi.
        // Mavzu nomida "ошибками" kabi so'z bo'lishi mumkin — u xato emas.
        const statusCell = col.status !== -1 ? pick(col.status) : cells.at(-1);
        const isOk = /Готов/i.test(statusCell);
        const isError = !isOk && /Ошибк|Xato/i.test(statusCell);

        const lesson = pick(col.lesson);

        rows.push({
          n: cells[0],
          lesson: /^\d+$/.test(lesson) ? lesson : cells[0],
          topic: pick(col.topic),
          hw: pick(col.hw),
          ok: isOk,
          status: statusCell || (isError ? 'Xato' : ''),
        });
      }
      return { rows };
    });

    const rows = data.rows || [];
    let diag = '';
    if (!rows.length) {
      diag = await this.page.evaluate(() =>
        `Sahifa matni:\n${document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 600)}`
      ).catch(() => '');
    }

    const bad = rows.filter(r => !r.ok);
    return { rows, ok: rows.length - bad.length, bad, diag, mapReport: this.lastMapReport || '' };
  }

  // ---- 4-qadam ----
  async confirmImport() {
    await this.clickButton('Импортировать');
    await this.settle(3000);
    return await this.page.screenshot({ fullPage: false });
  }

  async close() {
    // Brauzer umumiy — faqat o'z contextimizni yopamiz
    try { await this.ctx?.close(); } catch {}
  }
}
