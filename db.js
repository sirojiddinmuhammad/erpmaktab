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

export const SCHEMA = `
create table if not exists teachers (
  tg_id         bigint primary key,
  username      text,
  password_enc  text,
  storage_state jsonb,
  state_at      timestamptz,
  created_at    timestamptz default now()
);

alter table teachers alter column username drop not null;
alter table teachers alter column password_enc drop not null;
alter table teachers add column if not exists full_name  text;
alter table teachers add column if not exists lang       text    default 'uz';
alter table teachers add column if not exists balance    integer default 0;
alter table teachers add column if not exists free_used  integer default 0;
alter table teachers add column if not exists sub_until  date;
alter table teachers add column if not exists imports_ok integer default 0;

create table if not exists payments (
  id         bigserial primary key,
  tg_id      bigint,
  amount     integer,
  status     text default 'pending',
  file_id    text,
  created_at timestamptz default now(),
  decided_at timestamptz
);

create table if not exists ledger (
  id         bigserial primary key,
  tg_id      bigint,
  delta      integer,
  reason     text,
  created_at timestamptz default now()
);
`;

export async function ensureSchema() {
  await pool.query(SCHEMA);
}

// ---------- foydalanuvchi ----------
export async function ensureUser(tgId) {
  const { rows } = await pool.query(
    `insert into teachers (tg_id) values ($1)
     on conflict (tg_id) do update set tg_id = excluded.tg_id
     returning *`,
    [tgId]
  );
  return rows[0];
}

export async function getUser(tgId) {
  const { rows } = await pool.query('select * from teachers where tg_id = $1', [tgId]);
  return rows[0] || null;
}

export async function setLang(tgId, lang) {
  await ensureUser(tgId);
  await pool.query('update teachers set lang = $2 where tg_id = $1', [tgId, lang]);
}

export async function setCreds(tgId, username, password, fullName = null) {
  await ensureUser(tgId);
  await pool.query(
    `update teachers
        set username = $2, password_enc = $3,
            full_name = coalesce($4, full_name), storage_state = null
      where tg_id = $1`,
    [tgId, username, enc(password), fullName]
  );
}

export async function getCreds(tgId) {
  const { rows } = await pool.query(
    'select username, password_enc from teachers where tg_id = $1', [tgId]
  );
  if (!rows[0]?.password_enc) return null;
  return { username: rows[0].username, password: dec(rows[0].password_enc) };
}

export async function saveState(tgId, state) {
  await pool.query(
    'update teachers set storage_state = $2, state_at = now() where tg_id = $1',
    [tgId, JSON.stringify(state)]
  );
}

export async function getState(tgId) {
  const { rows } = await pool.query(
    `select storage_state from teachers
      where tg_id = $1 and state_at > now() - interval '12 hours'`,
    [tgId]
  );
  return rows[0]?.storage_state ?? null;
}

// ---------- import huquqi ----------
const hasSub = u => u?.sub_until && new Date(u.sub_until) >= new Date();

export async function checkQuota(tgId) {
  const u = await ensureUser(tgId);
  if (hasSub(u)) return { ok: true, mode: 'sub', until: u.sub_until };
  const left = FREE_LIMIT - (u.free_used || 0);
  if (left > 0) return { ok: true, mode: 'free', left };
  if ((u.balance || 0) >= PRICE_IMPORT) return { ok: true, mode: 'paid', balance: u.balance };
  return { ok: false, mode: 'none', balance: u.balance || 0 };
}

// Faqat muvaffaqiyatli importdan keyin chaqiriladi
export async function chargeImport(tgId) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows } = await c.query('select * from teachers where tg_id = $1 for update', [tgId]);
    const u = rows[0];

    let mode;
    let balance = u.balance || 0;

    if (hasSub(u)) {
      mode = 'sub';
    } else if ((u.free_used || 0) < FREE_LIMIT) {
      await c.query('update teachers set free_used = free_used + 1 where tg_id = $1', [tgId]);
      mode = 'free';
    } else if (balance >= PRICE_IMPORT) {
      balance -= PRICE_IMPORT;
      await c.query('update teachers set balance = $2 where tg_id = $1', [tgId, balance]);
      await c.query('insert into ledger (tg_id, delta, reason) values ($1, $2, $3)',
        [tgId, -PRICE_IMPORT, 'import']);
      mode = 'paid';
    } else {
      await c.query('rollback');
      return { ok: false };
    }

    await c.query('update teachers set imports_ok = imports_ok + 1 where tg_id = $1', [tgId]);
    await c.query('commit');

    const left = FREE_LIMIT - ((u.free_used || 0) + (mode === 'free' ? 1 : 0));
    return { ok: true, mode, balance, left };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// ---------- obuna ----------
export async function buySub(tgId) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows } = await c.query('select * from teachers where tg_id = $1 for update', [tgId]);
    const u = rows[0];

    if (hasSub(u)) { await c.query('rollback'); return { ok: false, reason: 'have', until: u.sub_until }; }
    if ((u.balance || 0) < PRICE_SUB) {
      await c.query('rollback');
      return { ok: false, reason: 'money', balance: u.balance || 0 };
    }

    const { rows: r2 } = await c.query(
      `update teachers
          set balance = balance - $2,
              sub_until = (current_date + interval '1 year')::date
        where tg_id = $1 returning balance, sub_until`,
      [tgId, PRICE_SUB]
    );
    await c.query('insert into ledger (tg_id, delta, reason) values ($1, $2, $3)',
      [tgId, -PRICE_SUB, 'subscription']);
    await c.query('commit');
    return { ok: true, until: r2[0].sub_until, balance: r2[0].balance };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// ---------- to'lovlar ----------
export async function createPayment(tgId, amount, fileId) {
  const { rows } = await pool.query(
    'insert into payments (tg_id, amount, file_id) values ($1, $2, $3) returning id',
    [tgId, amount, fileId]
  );
  return rows[0].id;
}

export async function approvePayment(id, amount = null) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows } = await c.query(
      "select * from payments where id = $1 and status = 'pending' for update", [id]
    );
    if (!rows[0]) { await c.query('rollback'); return null; }

    const p = rows[0];
    const sum = amount ?? p.amount;

    await c.query("update payments set status='approved', amount=$2, decided_at=now() where id=$1", [id, sum]);
    const { rows: r2 } = await c.query(
      'update teachers set balance = balance + $2 where tg_id = $1 returning balance',
      [p.tg_id, sum]
    );
    await c.query('insert into ledger (tg_id, delta, reason) values ($1, $2, $3)',
      [p.tg_id, sum, 'topup']);
    await c.query('commit');
    return { tgId: p.tg_id, amount: sum, balance: r2[0].balance };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function rejectPayment(id) {
  const { rows } = await pool.query(
    "update payments set status='rejected', decided_at=now() where id=$1 and status='pending' returning tg_id",
    [id]
  );
  return rows[0]?.tg_id || null;
}

export async function setName(tgId, fullName) {
  await pool.query('update teachers set full_name = $2 where tg_id = $1', [tgId, fullName]);
}

export async function ledgerRecent(tgId, n = 10) {
  const { rows } = await pool.query(
    'select delta, reason, created_at from ledger where tg_id = $1 order by id desc limit $2',
    [tgId, n]
  );
  return rows;
}
