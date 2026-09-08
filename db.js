import pg from 'pg';
import crypto from 'node:crypto';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});
// Kalit birinchi ishlatilganda o'qiladi (import paytida emas)
let _key;
function KEY() {
  if (!_key) _key = Buffer.from(process.env.ENC_KEY, 'hex');
  return _key;
}

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

export async function setCreds(userId, username, password) {
  await pool.query(
    `insert into teachers (tg_id, username, password_enc)
     values ($1, $2, $3)
     on conflict (tg_id) do update
       set username = $2, password_enc = $3, storage_state = null`,
    [userId, username, enc(password)]
  );
}

export async function getCreds(userId) {
  const { rows } = await pool.query(
    'select username, password_enc from teachers where tg_id = $1', [userId]
  );
  if (!rows[0]) return null;
  return { username: rows[0].username, password: dec(rows[0].password_enc) };
}

export async function saveState(userId, state) {
  await pool.query(
    'update teachers set storage_state = $2, state_at = now() where tg_id = $1',
    [userId, JSON.stringify(state)]
  );
}

export async function getState(userId) {
  const { rows } = await pool.query(
    `select storage_state from teachers
     where tg_id = $1 and state_at > now() - interval '12 hours'`,
    [userId]
  );
  return rows[0]?.storage_state ?? null;
}

export const SCHEMA = `
create table if not exists teachers (
  tg_id         bigint primary key,
  username      text not null,
  password_enc  text not null,
  storage_state jsonb,
  state_at      timestamptz,
  created_at    timestamptz default now()
);

create table if not exists imports (
  id         bigserial primary key,
  tg_id      bigint references teachers(tg_id),
  class_name text,
  subject    text,
  period     text,
  rows_count int,
  ok         boolean,
  created_at timestamptz default now()
);
`;

// Har ishga tushganda chaqiriladi — jadval bo'lmasa yaratadi, bo'lsa tegmaydi.
export async function ensureSchema() {
  await pool.query(SCHEMA);
}
