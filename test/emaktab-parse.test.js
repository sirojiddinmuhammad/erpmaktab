import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseToken, parseHidden, parseSelect, parseMyClasses, mapColumnsFromHeaders,
  countColumnSelects, previewFromHtml, isLoginPage, isMaintenance, parseImportResult,
  periodNumber, parseFormHidden,
} from '../emaktab-parse.js';

const fx = n => fs.readFileSync(new URL(`./fixtures/emaktab/${n}`, import.meta.url), 'utf8');

test('parseToken reads the request verification token, null when absent', () => {
  assert.equal(parseToken(fx('import-step1.html')), 'XXX');
  assert.equal(parseToken('<input type="hidden" value="abc" name="__RequestVerificationToken">'), 'abc');
  assert.equal(parseToken('<html></html>'), null);
});

test('parseHidden reads the stored file reference from step 2', () => {
  assert.match(parseHidden(fx('import-step2.html'), 'file'), /^storage:\/\/\//);
  assert.equal(parseHidden(fx('import-step2.html'), 'nope'), null);
});

test('parseFormHidden returns every hidden field of the token form, without the token', () => {
  const h = parseFormHidden(fx('import-step1.html'));
  assert.equal(h.group, '0');
  assert.equal(h.sourceType, 'File');
  assert.equal(h.file, '');
  assert.equal('__RequestVerificationToken' in h, false);
  assert.equal('partnerId' in h, false); // logout formasidan emas
});

test('parseSelect lists options with the selected one marked', () => {
  const o = parseSelect(fx('import-step2.html'), 'period');
  assert.equal(o.length, 6);
  assert.deepEqual(o.find(x => x.selected), { value: '2530691816384972571', label: '2 четверть', selected: true });
});

test('parseMyClasses reads classes, subject ids, school and current period', () => {
  const r = parseMyClasses(fx('myclasses.html'));
  assert.equal(r.school, '1000000000001');
  assert.equal(r.periodId, '2530691816384972571');
  assert.equal(r.classes.length, 3);
  assert.equal(r.classes[0].className, '4-A');
  assert.equal(r.classes[0].groupId, '2514332234414922860');
  assert.equal(r.classes[0].subjects.length, 4);
  assert.deepEqual(r.classes[0].subjects[1], { id: '1984492252597963094', name: 'Информатика' });
  assert.deepEqual(r.classes[2].subjects.map(s => s.name), ['Информатика']);
});

test('mapColumnsFromHeaders uses header names', () => {
  assert.deepEqual(mapColumnsFromHeaders(['№', 'Тема урока', 'Домашнее задание']).values, [0, 1, 2]);
  assert.deepEqual(mapColumnsFromHeaders(['Mavzu', 'T/r', 'Uy vazifasi']).values, [1, 0, 2]);
});

test('mapColumnsFromHeaders falls back to column order for unknown headers', () => {
  assert.deepEqual(mapColumnsFromHeaders(['A', 'B', 'C']).values, [0, 1, 2]);
  assert.deepEqual(mapColumnsFromHeaders(['A', 'B', 'C', 'D']).values, [0, 1, 2, -1]);
  assert.equal(mapColumnsFromHeaders(['A', 'B', 'C']).done, 3);
});

test('countColumnSelects counts select_N on step 2', () => {
  assert.equal(countColumnSelects(fx('import-step2.html')), 3);
});

test('previewFromHtml reads ready and error rows with row ids', () => {
  const { rows } = previewFromHtml(fx('import-step3-errors.html'));
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[0], { n: '1', lesson: '1', topic: 'Test mavzu 1', hw: 'Test vazifa 1', rowId: '2555977925239087533', ok: true, replaces: false, status: 'Готов к импорту.' });
  const bad = rows[6];
  assert.equal(bad.ok, false);
  assert.equal(bad.rowId, null);
  assert.match(bad.status, /превышает/);
});

test('previewFromHtml: topic words do not decide the status, warnings are not errors', () => {
  const row = (topic, status, rid = '11') => `<form><input name="__RequestVerificationToken" value="x"><table class="grid">
    <tr><th>№</th><th>№ урока</th><th>Тема урока</th><th>Домашнее задание</th><th>Действие</th><th>Предварительная проверка</th></tr>
    <tr><td>1</td><td>1</td><td>${topic}</td><td></td><td><select name="select"><option value="${rid}=0">Не импортировать</option><option value="${rid}=1" selected="">Импортировать</option></select></td><td><ul class="s2 green"><li>${status}</li></ul></td></tr>
  </table><input type="submit" name="step3" value="Импортировать &gt;"></form>`;
  assert.equal(previewFromHtml(row('Работа над ошибками', 'Готов к импорту.')).rows[0].ok, true);
  assert.equal(previewFromHtml(row('Mavzu', 'Импортируемая тема урока заменит текущую. Импортируемое ДЗ заменит текущее ДЗ в планировании.')).rows[0].ok, true);
});

test('periodNumber reads quarter numbers', () => {
  assert.equal(periodNumber('2 четверть'), 2);
  assert.equal(periodNumber('3-chorak'), 3);
  assert.equal(periodNumber('II chorak'), 2);
  assert.equal(periodNumber('Весь год'), null);
});

test('isLoginPage detects a redirect to login', () => {
  assert.equal(isLoginPage(302, 'https://login.emaktab.uz/?ReturnUrl=x', ''), true);
  assert.equal(isLoginPage(200, null, '<form action="https://login.emaktab.uz/login" method="post"><input name="login"><input type="password" name="password">'), true);
  assert.equal(isLoginPage(200, null, fx('import-step1.html')), false);
});

test('isMaintenance detects short maintenance pages only', () => {
  assert.equal(isMaintenance('<h1>Ведутся технические работы</h1>'), true);
  assert.equal(isMaintenance(fx('import-step1.html')), false);
});

test('parseImportResult: unknown page → ok null with short text', () => {
  const r = parseImportResult('<html><body><p>Что-то произошло</p></body></html>');
  assert.equal(r.ok, null);
  assert.match(r.text, /Что-то/);
  assert.equal(parseImportResult(fx('import-step3-ready.html')).ok, false); // hali ko'rib chiqish sahifasi
});

test('FIX6: a data first row (no header) uses pure column order and reports no header', () => {
  const r = mapColumnsFromHeaders(['1', 'Домашние животные', 'Тема 3, упр. 5']);
  assert.deepEqual(r.values, [0, 1, 2]);
  assert.equal(r.hasHeader, false);
  assert.equal(mapColumnsFromHeaders(['№', 'Тема урока', 'Домашнее задание']).hasHeader, true);
});

test('FIX6: once the topic column is known from headers, unknown columns are skipped', () => {
  assert.deepEqual(mapColumnsFromHeaders(['№', 'Mavzu', 'Soat']).values, [0, 1, -1]);
});

test('parseImportResult looks past the page header and returns keyword snippets', () => {
  const nav = '<header>' + 'Учитель Сотрудник Помощь Выход Журналы Расписание '.repeat(10) + '</header>';
  const ok = parseImportResult(`<html><body>${nav}<div class="msg">Импорт успешно завершён. Загружено 7 записей.</div><input type="file" name="multifile1"></body></html>`);
  assert.equal(ok.ok, true);
  assert.match(ok.snippets.join(' '), /успешно/);
  assert.equal(ok.backAtStep1, true);
  const unknown = parseImportResult(`<html><body>${nav}<p>Данные сохранены в плане.</p></body></html>`);
  assert.equal(unknown.ok, null);
  assert.equal(unknown.backAtStep1, false);
  assert.doesNotMatch(unknown.text, /Учитель Сотрудник Помощь/);
});

test('previewFromHtml marks rows whose existing topic would be replaced', () => {
  const html = fx('import-step3-ready.html').replace(
    '<ul class="s2 green strong"> <li>Готов к импорту.</li> </ul>',
    '<ul class="alerts"> <li>Импортируемая тема урока заменит текущую.</li> <li>Импортируемое ДЗ заменит текущее ДЗ в планировании.</li> </ul>');
  const { rows } = previewFromHtml(html);
  assert.equal(rows[0].replaces, true);
  assert.equal(rows[0].ok, true);
  assert.equal(rows[1].replaces, false);
});
