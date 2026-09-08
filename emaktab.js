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
    // login sahifasiga otib yuborsa — sessiya eskirgan
    return !/login/i.test(this.page.url());
  }

  async login(username, password) {
    await this.page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

    // TEKSHIRING: input name'lari DevTools orqali tasdiqlansin
    await this.page.fill('input[name="login"]', username);
    await this.page.fill('input[name="password"]', password);
    await this.page.click('button[type="submit"], input[type="submit"]');
    await this.page.waitForLoadState('networkidle');

    if (/login/i.test(this.page.url())) throw new Error('BAD_CREDENTIALS');
    return await this.ctx.storageState();
  }

  // ---- 1-qadam: fayl ----
  async uploadFile(filePath) {
    await this.page.goto(IMPORT_URL, { waitUntil: 'domcontentloaded' });

    // "Отменить импорт этого файла" — oldingi yarim qolgan importni tozalash
    const cancel = this.page.locator('text=Отменить импорт этого файла');
    if (await cancel.count()) {
      await cancel.first().click();
      await this.page.waitForLoadState('networkidle');
    }

    await this.page.setInputFiles('input[type="file"]', filePath);
    await this.page.check('input[type="radio"][value*="header"], input[type="radio"]'); // 1-qatorda ustun nomlari
    await this.page.click('text=Далее');
    await this.page.waitForLoadState('networkidle');
  }

  // ---- 2-qadam: selectlar ----
  async options(label) {
    const s = this.sel(label);
    await s.waitFor({ state: 'attached' });
    return await s.locator('option').evaluateAll(list =>
      list
        .map(o => ({ value: o.value, label: o.textContent.trim() }))
        .filter(o => o.value && !/^(Не выбрано|—|-)$/i.test(o.label))
    );
  }

  async pick(label, value) {
    await this.sel(label).selectOption(value);
    // sinf tanlangach fan ro'yxati qayta yuklanadi
    await this.page.waitForLoadState('networkidle').catch(() => {});
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
    await this.page.waitForLoadState('networkidle');
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
    await this.page.waitForLoadState('networkidle');
    return await this.page.screenshot({ fullPage: false });
  }

  async close() {
    try { await this.browser?.close(); } catch {}
  }
}
