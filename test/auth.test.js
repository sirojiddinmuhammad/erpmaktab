import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, parseCookies, sessionCookie } from '../dashboard/auth.js';

test('token bir martalik, 10 daqiqa; sessiya 7 kun; logout', () => {
  let t = 0; const a = createAuth({ now: () => t });
  const tok = a.issueToken(); assert.match(tok, /^[0-9a-f]{64}$/);
  const sid = a.redeem(tok); assert.match(sid, /^[0-9a-f]{64}$/);
  assert.equal(a.redeem(tok), null);
  t = 0; const tok2 = a.issueToken(); t = 600_001; assert.equal(a.redeem(tok2), null);
  t = 0; assert.equal(a.check(sid), true); t = 604_800_001; assert.equal(a.check(sid), false);
  t = 0; const s2 = a.redeem(a.issueToken()); a.logout(s2); assert.equal(a.check(s2), false);
  assert.equal(a.check(undefined), false);
  assert.equal(a.redeem(undefined), null);
  assert.equal(a.redeem('nope'), null);
});
test('cookie yordamchilari', () => {
  assert.deepEqual(parseCookies('a=1; sid=abc'), { a: '1', sid: 'abc' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.match(sessionCookie('x', 60), /^sid=x; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=60$/);
});
