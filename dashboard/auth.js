// Dashboard'ga kirish: botdagi /panel bir martalik token beradi,
// token sessiyaga (cookie `sid`) almashtiriladi. Hammasi xotirada.

import crypto from 'node:crypto';

const rand = () => crypto.randomBytes(32).toString('hex');

export function createAuth({ now = Date.now, tokenTtl = 600_000, sessionTtl = 604_800_000 } = {}) {
  const tokens = new Map();   // token -> muddati
  const sessions = new Map(); // sid -> muddati

  const sweep = () => {
    const t = now();
    for (const [k, exp] of tokens) if (exp <= t) tokens.delete(k);
    for (const [k, exp] of sessions) if (exp <= t) sessions.delete(k);
  };

  return {
    issueToken() {
      sweep();
      const tok = rand();
      tokens.set(tok, now() + tokenTtl);
      return tok;
    },
    redeem(token) {
      sweep();
      if (typeof token !== 'string' || !tokens.has(token)) return null;
      tokens.delete(token);
      const sid = rand();
      sessions.set(sid, now() + sessionTtl);
      return sid;
    },
    check(sid) {
      if (typeof sid !== 'string') return false;
      const exp = sessions.get(sid);
      if (exp == null) return false;
      if (exp <= now()) { sessions.delete(sid); return false; }
      return true;
    },
    logout(sid) { sessions.delete(sid); },
  };
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export const sessionCookie = (sid, maxAgeSec) =>
  `sid=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
