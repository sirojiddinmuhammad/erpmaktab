import { chromium } from 'playwright';

const BASE = 'https://schools.emaktab.uz';
const IMPORT_URL = `${BASE}/v2/journals/planning/import`;

// Fayldagi ustun nomi -> eMaktabdagi maydon
const COLUMN_MAP = {
  'П/Н': 'Номер урока',
  'Тема': 'Тема урока',
  'Дом. Задания': 'Домашнее задание',
};

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
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    this.ctx = await this.browser.newContext({ locale: 'ru-RU' });
    this.page = await this.ctx.newPage();
    this.page.setDefaultTimeout(30_000);
  }

  // storageState bo'lsa qayta login qilinmaydi
  async restore(storageState) {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    this.ctx = await this.browser.newContext({ locale: 'ru-RU', storageState });
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
    await page.waitForTimeout(1500);

    if (/login\.emaktab\.uz/.test(page.url())) {
      const err = await page.locator('.error, .alert, [class*="error"]').first()
        .innerText().catch(() => '');
      throw new Error(err ? `BAD_CREDENTIALS: ${err.slice(0, 120)}` : 'BAD_CREDENTIALS');
    }

    return await this.ctx.storageState();
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
    await this.settle(2000);
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
    // tanlovdan keyin bog'liq ro'yxatlar qayta yuklanadi
    await this.settle(1200);
  }

  // ---- ustun mosligi: avtomatik ----
  async mapColumns() {
    for (const [fileCol, target] of Object.entries(COLUMN_MAP)) {
      const s = this.page.locator(
        `xpath=//tr[td[normalize-space()="${fileCol}"]]//select`
      );
      if (await s.count()) await s.first().selectOption({ label: target });
    }
    await this.page.click('text=Далее');
    await this.settle(2000);
  }

  // ---- 3-qadam: tekshiruv jadvali ----
  async preview() {
    const rows = await this.page.locator('table tr').evaluateAll(trs =>
      trs
        .map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.trim()))
        .filter(c => c.length >= 4 && /^\d+$/.test(c[0]))
        .map(c => ({ n: c[0], lesson: c[1], topic: c[2], hw: c[3], status: c.at(-1) }))
    );
    const bad = rows.filter(r => !/Готов/i.test(r.status));
    return { rows, ok: rows.length - bad.length, bad };
  }

  // ---- 4-qadam ----
  async confirmImport() {
    await this.page.click('text=Импортировать >');
    await this.settle(3000);
    return await this.page.screenshot({ fullPage: false });
  }

  async close() {
    try { await this.browser?.close(); } catch {}
  }
}
