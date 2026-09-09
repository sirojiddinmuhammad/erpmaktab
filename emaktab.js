import { chromium } from 'playwright';

const BASE = 'https://schools.emaktab.uz';
const IMPORT_URL = `${BASE}/v2/journals/planning/import`;

// Fayldagi ustun nomi -> eMaktabdagi maydon
const COLUMN_MAP = {
  'П/Н': 'Номер урока',
  'Тема': 'Тема урока',
  'Дом. Задания': 'Домашнее задание',
};

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

    await this.page.goto(IMPORT_URL, { waitUntil: 'domcontentloaded' });
    // login subdomeniga otib yuborsa — sessiya eskirgan
    return !/login\.emaktab\.uz/.test(this.page.url());
  }

  async login(username, password) {
    const page = this.page;
    await page.goto('https://login.emaktab.uz/login', { waitUntil: 'domcontentloaded' });

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

  // Sahifa sarlavhasidan foydalanuvchi ismini o'qiydi
  async getUserName() {
    return await this.page.evaluate(() => {
      const clean = t => (t || '').replace(/\s+/g, ' ').trim();
      const junk = /Помощь|Выход|Yordam|Chiqish|Сотрудник|Учитель|Xodim|O'qituvchi/gi;

      // "Выход" havolasi yonidagi blokda ism turadi
      const exit = [...document.querySelectorAll('a')]
        .find(a => /Выход|Chiqish/i.test(a.textContent));
      if (exit) {
        let n = exit.parentElement;
        for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
          const t = clean(n.innerText).replace(junk, '').trim();
          if (t.length >= 4 && t.length <= 60 && /[А-ЯЁA-Z]/.test(t)) return t;
        }
      }

      // Zaxira: profil havolasidagi matn
      const prof = document.querySelector('[class*="user"] a, [class*="profile"] a, a[href*="/user/"]');
      if (prof) {
        const t = clean(prof.textContent).replace(junk, '').trim();
        if (t.length >= 4) return t;
      }
      return '';
    }).catch(() => '');
  }

  // ---- 1-qadam: fayl ----
  async uploadFile(filePath) {
    await this.page.goto(IMPORT_URL, { waitUntil: 'domcontentloaded' });

    // "Отменить импорт этого файла" — oldingi yarim qolgan importni tozalash
    const cancel = this.page.locator('text=Отменить импорт этого файла');
    if (await cancel.count()) {
      await cancel.first().click();
      await this.settle();
    }

    await this.page.setInputFiles('input[type="file"]', filePath);
    await this.page.check('input[type="radio"][value*="header"], input[type="radio"]'); // 1-qatorda ustun nomlari
    await this.page.click('text=Далее');
    await this.settle(400);
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
    // Moslash selectlarida albatta "Номер урока" varianti bor.
    // Shu belgi bilan ularni parametr selectlaridan (sinf, fan) ajratamiz.
    await this.page.waitForFunction(() =>
      [...document.querySelectorAll('select')].some(s =>
        [...s.options].some(o => /номер\s*урока/i.test(o.textContent))
      ), null, { timeout: 30000 }
    ).catch(() => {});

    const plan = await this.page.evaluate((MAP) => {
      const norm = t => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const all = [...document.querySelectorAll('select')];

      const mapping = all
        .map((sel, idx) => ({ sel, idx }))
        .filter(({ sel }) => [...sel.options].some(o => /номер\s*урока/i.test(o.textContent)));

      if (!mapping.length) {
        return {
          actions: [],
          report: [`Moslash selectlari topilmadi. Sahifada ${all.length} ta select bor.`],
        };
      }

      // Selectning qatoridagi ustun nomini o'qish
      const labelOf = sel => {
        const tr = sel.closest('tr');
        if (tr) {
          for (const c of [...tr.querySelectorAll('td, th')])
            if (!c.querySelector('select')) return c.textContent;
        }
        let n = sel.parentElement;
        for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
          const t = n.textContent.replace(sel.textContent, '').trim();
          if (t) return t;
        }
        return '';
      };

      const cols = Object.keys(MAP);
      const actions = [];
      const report = [];
      const used = new Set();

      for (let ci = 0; ci < cols.length; ci++) {
        const fileCol = cols[ci];
        const target = MAP[fileCol];

        // 1) qator nomi bo'yicha, 2) topilmasa tartib bo'yicha
        let hit = mapping.find(m => !used.has(m.idx) && norm(labelOf(m.sel)).includes(norm(fileCol)));
        if (!hit && mapping[ci] && !used.has(mapping[ci].idx)) hit = mapping[ci];
        if (!hit) { report.push(`${fileCol}: mos select yo'q`); continue; }

        const opts = [...hit.sel.options];
        let oi = opts.findIndex(o => norm(o.textContent) === norm(target));
        if (oi === -1) oi = opts.findIndex(o => norm(o.textContent).includes(norm(target)));
        if (oi === -1) {
          report.push(`${fileCol}: "${target}" yo'q. Bor: ${opts.map(o => o.textContent.trim()).join(' | ')}`);
          continue;
        }

        used.add(hit.idx);
        actions.push({ selectIndex: hit.idx, optionIndex: oi });
        report.push(`${fileCol} -> ${target}`);
      }
      return { actions, report };
    }, COLUMN_MAP);

    for (const a of plan.actions) {
      await this.page.locator('select').nth(a.selectIndex).selectOption({ index: a.optionIndex });
    }

    this.lastMapReport = plan.report.join('\n');
    // Uchalasi ham qo'yilmasa — qo'lda rejimga o'tamiz
    return { done: plan.actions.length, need: Object.keys(COLUMN_MAP).length, report: this.lastMapReport };
  }

  // Oldin tanlangan parametrlarni qayta qo'yadi (qayta yuklashdan keyin)
  async applyParams(list) {
    for (const { label, optionLabel } of list) {
      const opts = await this.options(label);
      const hit = opts.find(o => o.label === optionLabel)
               || opts.find(o => o.label.includes(optionLabel));
      if (!hit) throw new Error(`"${optionLabel}" varianti qayta topilmadi (${label}).`);
      await this.pick(label, hit.index);
    }
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
    await this.page.click('text=Далее');
    await this.page.waitForSelector('table tr', { timeout: 30000 }).catch(() => {});
    await this.settle(400);
  }

  // ---- 3-qadam: tekshiruv jadvali ----
  async preview() {
    const data = await this.page.evaluate(() => {
      const norm = t => (t || '').replace(/\s+/g, ' ').trim();

      // Kerakli jadval: sarlavhasida "Тема урока" bo'lgani
      const table = [...document.querySelectorAll('table')]
        .find(t => /Тема\s*урока/i.test(t.textContent));
      if (!table) return { rows: [] };

      const trs = [...table.querySelectorAll('tr')];

      // Sarlavha qatoridan ustun raqamlarini aniqlaymiz
      let col = null;
      for (const tr of trs) {
        const cells = [...tr.querySelectorAll('th, td')].map(c => norm(c.textContent));
        if (cells.some(c => /Тема\s*урока/i.test(c))) {
          col = {
            lesson: cells.findIndex(c => /№\s*урока/i.test(c)),
            topic:  cells.findIndex(c => /Тема\s*урока/i.test(c)),
            hw:     cells.findIndex(c => /Домашнее\s*задание/i.test(c)),
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
        if (!/^\d+$/.test(cells[0])) continue; // sarlavha yoki bo'sh qator

        // Holatni butun qator matnidan aniqlaymiz — ustun siljisa ham ishlaydi
        const rowText = norm(tr.innerText);
        const isError = /Ошибка|Xato/i.test(rowText);
        const isOk = /Готов/i.test(rowText);

        // Xato qatorda kataklar siljishi mumkin: mavzuni "Ошибка" so'zidan tozalaymiz
        const pick = i => (i >= 0 && i < cells.length ? cells[i] : '');
        let topic = pick(col.topic);
        let hw = pick(col.hw);
        let lesson = pick(col.lesson);

        if (isError) {
          // Siljish bo'lsa: "Ошибка!" turgan katakni tashlab, keyingilarini olamiz
          const ei = cells.findIndex(c => /^Ошибка/i.test(c));
          if (ei !== -1 && ei <= col.topic) {
            topic = norm(pick(col.topic).replace(/^Ошибка!?\.?/i, '')) || pick(col.topic + 1);
            if (/^Ошибка/i.test(lesson) || !/^\d+$/.test(lesson)) lesson = '';
          }
        }

        rows.push({
          n: cells[0],
          lesson: /^\d+$/.test(lesson) ? lesson : cells[0],
          topic,
          hw,
          ok: isOk && !isError,
          status: isError ? 'Xato' : (isOk ? 'Tayyor' : 'Nomalum'),
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
    await this.page.click('text=Импортировать >');
    await this.settle(3000);
    return await this.page.screenshot({ fullPage: false });
  }

  async close() {
    // Brauzer umumiy — faqat o'z contextimizni yopamiz
    try { await this.ctx?.close(); } catch {}
  }
}
