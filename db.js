import pg from 'pg';
import crypto from 'node:crypto';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

export const PRICE_IMPORT = Number(process.env.PRICE_IMPORT || 2000);
export const PRICE_SUB    = Number(process.env.PRICE_SUB || 50000);
export const FREE_LIMIT   = Number(process.env.FREE_LIMIT || 3);

let _key;
const KEY = () => (_key ??= Buffer.from(process.env.ENC_KEY, 'hex'));

function enc(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

function dec(b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

// accounts — eMaktab hisobi (balans, obuna, bepul importlar shu yerda)
// users    — Telegram foydalanuvchi (til va qaysi hisobga ulangani)
export const SCHEMA = `
create table if not exists teachers (
  tg_id bigint primary key, username text, password_enc text,
  storage_state jsonb, state_at timestamptz, created_at timestamptz default now()
);
alter table teachers add column if not exists full_name  text;
alter table teachers add column if not exists lang       text default 'uz';
alter table teachers add column if not exists balance    integer default 0;
alter table teachers add column if not exists free_used  integer default 0;
alter table teachers add column if not exists sub_until  date;
alter table teachers add column if not exists imports_ok integer default 0;

create table if not exists accounts (
  id            bigserial primary key,
  login         text unique not null,
  password_enc  text,
  full_name     text,
  storage_state jsonb,
  state_at      timestamptz,
  balance       integer default 0,
  free_used     integer default 0,
  sub_until     date,
  imports_ok    integer default 0,
  tg_id         bigint,
  created_at    timestamptz default now()
);

create table if not exists users (
  tg_id      bigint primary key,
  lang       text default 'uz',
  account_id bigint references accounts(id),
  created_at timestamptz default now()
);

create table if not exists payments (
  id bigserial primary key, tg_id bigint, amount integer,
  status text default 'pending', file_id text,
  created_at timestamptz default now(), decided_at timestamptz
);
create table if not exists ledger (
  id bigserial primary key, tg_id bigint, delta integer,
  reason text, created_at timestamptz default now()
);
alter table payments add column if not exists account_id bigint;
alter table ledger   add column if not exists account_id bigint;

-- Eski teachers jadvalidan ko'chirish (bir marta, takroriy ishga tushishga chidamli)
insert into accounts (login, password_enc, full_name, storage_state, state_at,
                      balance, free_used, sub_until, imports_ok, tg_id)
select username, password_enc, full_name, storage_state, state_at,
       coalesce(balance,0), coalesce(free_used,0), sub_until, coalesce(imports_ok,0), tg_id
  from teachers where username is not null
on conflict (login) do nothing;

insert into users (tg_id, lang, account_id)
select t.tg_id, coalesce(t.lang,'uz'), a.id
  from teachers t left join accounts a on a.login = t.username
on conflict (tg_id) do nothing;

update ledger l   set account_id = u.account_id from users u
 where u.tg_id = l.tg_id and l.account_id is null;
update payments p set account_id = u.account_id from users u
 where u.tg_id = p.tg_id and p.account_id is null;
`;

export async function ensureSchema() { await pool.query(SCHEMA); }

// ---------- Telegram foydalanuvchi ----------
export async function ensureUser(tgId) {
  const { rows } = await pool.query(
    `insert into users (tg_id) values ($1)
     on conflict (tg_id) do update set tg_id = excluded.tg_id
     returning *, (xmax = 0) as is_new`,
    [tgId]
  );
  return rows[0];
}

export async function setLang(tgId, lang) {
  await ensureUser(tgId);
  await pool.query('update users set lang = $2 where tg_id = $1', [tgId, lang]);
}

// Telegram + hisob birlashgan ko'rinish
export async function getUser(tgId) {
  const { rows } = await pool.query(
    `select u.tg_id, u.lang, u.account_id,
            a.login as username, a.full_name, a.password_enc,
            coalesce(a.balance,0) as balance, coalesce(a.free_used,0) as free_used,
            a.sub_until, coalesce(a.imports_ok,0) as imports_ok
       from users u left join accounts a on a.id = u.account_id
      where u.tg_id = $1`,
    [tgId]
  );
  return rows[0] || null;
}

async function accountOf(tgId) {
  const { rows } = await pool.query(
    `select a.* from users u join accounts a on a.id = u.account_id where u.tg_id = $1`,
    [tgId]
  );
  return rows[0] || null;
}

// ---------- hisobni ulash ----------
// Login bo'yicha hisob topiladi. Bor bo'lsa balansi bilan qaytadi.
// Oxirgi ulangan Telegram ishlaydi — oldingisi uziladi.
export async function linkAccount(tgId, login, password, fullName = null) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into users (tg_id) values ($1) on conflict do nothing`, [tgId]);

    const { rows } = await c.query(
      `insert into accounts (login, password_enc, full_name, tg_id)
       values ($1, $2, $3, $4)
       on conflict (login) do update
          set password_enc = excluded.password_enc,
              full_name = coalesce(excluded.full_name, accounts.full_name),
              tg_id = excluded.tg_id,
              storage_state = null
       returning *, (xmax = 0) as is_new`,
      [login, enc(password), fullName, tgId]
    );
    const acc = rows[0];

    // oldingi egasini uzamiz
    const { rows: prev } = await c.query(
      `select tg_id from users where account_id = $1 and tg_id <> $2`, [acc.id, tgId]
    );
    await c.query(`update users set account_id = null where account_id = $1 and tg_id <> $2`,
      [acc.id, tgId]);
    await c.query(`update users set account_id = $2 where tg_id = $1`, [tgId, acc.id]);

    await c.query('commit');
    return { account: acc, prevTgIds: prev.map(r => r.tg_id), isNew: acc.is_new };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}

export async function getCreds(tgId) {
  const a = await accountOf(tgId);
  if (!a?.password_enc) return null;
  return { username: a.login, password: dec(a.password_enc) };
}

export async function setName(tgId, fullName) {
  await pool.query(
    `update accounts set full_name = $2
      where id = (select account_id from users where tg_id = $1)`, [tgId, fullName]);
}

export async function saveState(tgId, state) {
  await pool.query(
    `update accounts set storage_state = $2, state_at = now()
      where id = (select account_id from users where tg_id = $1)`,
    [tgId, JSON.stringify(state)]);
}

export async function getState(tgId) {
  const { rows } = await pool.query(
    `select a.storage_state from users u join accounts a on a.id = u.account_id
      where u.tg_id = $1 and a.state_at > now() - interval '12 hours'`, [tgId]);
  return rows[0]?.storage_state ?? null;
}

// ---------- kvota ----------
const hasSub = a => a?.sub_until && new Date(a.sub_until) >= new Date();

export async function checkQuota(tgId) {
  const a = await accountOf(tgId);
  if (!a) return { ok: false, mode: 'nologin', balance: 0 };
  if (hasSub(a)) return { ok: true, mode: 'sub', until: a.sub_until };
  const left = FREE_LIMIT - (a.free_used || 0);
  if (left > 0) return { ok: true, mode: 'free', left };
  if ((a.balance || 0) >= PRICE_IMPORT) return { ok: true, mode: 'paid', balance: a.balance };
  return { ok: false, mode: 'none', balance: a.balance || 0 };
}

export async function chargeImport(tgId) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows } = await c.query(
      `select a.* from users u join accounts a on a.id = u.account_id
        where u.tg_id = $1 for update of a`, [tgId]);
    const a = rows[0];
    if (!a) { await c.query('rollback'); return { ok: false }; }

    let mode, balance = a.balance || 0;
    if (hasSub(a)) {
      mode = 'sub';
    } else if ((a.free_used || 0) < FREE_LIMIT) {
      await c.query('update accounts set free_used = free_used + 1 where id = $1', [a.id]);
      mode = 'free';
    } else if (balance >= PRICE_IMPORT) {
      balance -= PRICE_IMPORT;
      await c.query('update accounts set balance = $2 where id = $1', [a.id, balance]);
      await c.query('insert into ledger (account_id, tg_id, delta, reason) values ($1,$2,$3,$4)',
        [a.id, tgId, -PRICE_IMPORT, 'import']);
      mode = 'paid';
    } else { await c.query('rollback'); return { ok: false }; }

    await c.query('update accounts set imports_ok = imports_ok + 1 where id = $1', [a.id]);
    await c.query('commit');
    const left = FREE_LIMIT - ((a.free_used || 0) + (mode === 'free' ? 1 : 0));
    return { ok: true, mode, balance, left };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}

export async function buySub(tgId) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows } = await c.query(
      `select a.* from users u join accounts a on a.id = u.account_id
        where u.tg_id = $1 for update of a`, [tgId]);
    const a = rows[0];
    if (!a) { await c.query('rollback'); return { ok: false, reason: 'nologin' }; }
    if (hasSub(a)) { await c.query('rollback'); return { ok: false, reason: 'have', until: a.sub_until }; }
    if ((a.balance || 0) < PRICE_SUB) {
      await c.query('rollback');
      return { ok: false, reason: 'money', balance: a.balance || 0 };
    }
    const { rows: r2 } = await c.query(
      `update accounts set balance = balance - $2,
              sub_until = (current_date + interval '1 year')::date
        where id = $1 returning balance, sub_until`, [a.id, PRICE_SUB]);
    await c.query('insert into ledger (account_id, tg_id, delta, reason) values ($1,$2,$3,$4)',
      [a.id, tgId, -PRICE_SUB, 'subscription']);
    await c.query('commit');
    return { ok: true, until: r2[0].sub_until, balance: r2[0].balance };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}

// ---------- to'lovlar ----------
export async function createPayment(tgId, amount, fileId) {
  const a = await accountOf(tgId);
  const { rows } = await pool.query(
    'insert into payments (tg_id, account_id, amount, file_id) values ($1,$2,$3,$4) returning id',
    [tgId, a?.id || null, amount, fileId]);
  return rows[0].id;
}

export async function attachPhoto(id, fileId) {
  await pool.query('update payments set file_id = $2 where id = $1', [id, fileId]);
}

export async function approvePayment(id, amount = null) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows } = await c.query(
      "select * from payments where id = $1 and status = 'pending' for update", [id]);
    if (!rows[0]) { await c.query('rollback'); return null; }

    const p = rows[0];
    const sum = amount ?? p.amount;
    await c.query("update payments set status='approved', amount=$2, decided_at=now() where id=$1",
      [id, sum]);

    const { rows: r2 } = await c.query(
      'update accounts set balance = balance + $2 where id = $1 returning balance, tg_id',
      [p.account_id, sum]);
    if (!r2[0]) { await c.query('rollback'); return null; }

    await c.query('insert into ledger (account_id, tg_id, delta, reason) values ($1,$2,$3,$4)',
      [p.account_id, p.tg_id, sum, 'topup']);
    await c.query('commit');
    return { tgId: r2[0].tg_id || p.tg_id, amount: sum, balance: r2[0].balance };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}

export async function rejectPayment(id) {
  const { rows } = await pool.query(
    "update payments set status='rejected', decided_at=now() where id=$1 and status='pending' returning tg_id",
    [id]);
  return rows[0]?.tg_id || null;
}

export async function ledgerRecent(tgId, n = 10) {
  const { rows } = await pool.query(
    `select l.delta, l.reason, l.created_at from ledger l
       join users u on u.account_id = l.account_id
      where u.tg_id = $1 order by l.id desc limit $2`, [tgId, n]);
  return rows;
}

// ---------- hisobot ----------
export async function stats() {
  const q = async sql => (await pool.query(sql)).rows[0];

  const users = await q(`
    select count(*) as total,
           count(*) filter (where created_at >= current_date) as today
      from users`);

  const acc = await q(`
    select count(*) as linked,
           count(*) filter (where imports_ok > 0) as active,
           count(*) filter (where sub_until >= current_date) as subs,
           coalesce(sum(balance),0) as balances,
           coalesce(sum(imports_ok),0) as imports_total
      from accounts`);

  const imp = await q(`
    select count(*) filter (where created_at >= current_date) as today,
           count(*) filter (where created_at >= current_date - 6) as week
      from ledger where reason = 'import'`);

  const pay = await q(`select coalesce(sum(amount),0) as total from payments where status='approved'`);

  const { rows: top } = await pool.query(`
    select coalesce(full_name, login) as name, imports_ok
      from accounts where imports_ok > 0 order by imports_ok desc limit 5`);

  return { users: { ...users, ...acc }, imp, pay, top };
}
