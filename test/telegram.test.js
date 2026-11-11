import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../dashboard/telegram.js';

test('withRetry: 429 da retry_after kutib qayta urinadi', async () => {
  const slept = []; let n = 0;
  const r = await withRetry(async () => {
    if (n++ === 0) throw { error_code: 429, parameters: { retry_after: 2 } };
    return 'ok';
  }, { sleep: async ms => { slept.push(ms); } });
  assert.equal(r, 'ok');
  assert.deepEqual(slept, [2000]);
});
test('withRetry: boshqa xatoda darhol tashlaydi', async () => {
  let n = 0;
  await assert.rejects(withRetry(async () => { n++; throw { error_code: 400 }; }, { sleep: async () => {} }), e => e.error_code === 400);
  assert.equal(n, 1);
});
test('withRetry: urinishlar tugasa oxirgi xato', async () => {
  let n = 0;
  await assert.rejects(withRetry(async () => { n++; throw { error_code: 429, parameters: { retry_after: 1 } }; }, { sleep: async () => {}, tries: 3 }), e => e.error_code === 429);
  assert.equal(n, 3);
});
