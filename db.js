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

alter table accounts add column if not exists classes    jsonb;
alter table accounts add column if not exists classes_at timestamptz;

create table if not exists users (
  tg_id      bigint primary key,
  lang       text default 'uz',
  account_id bigint references accounts(id),
  created_at timestamptz default now()
);

create table if not exists plans (
  id          bigserial primary key,
  grade       int not null,
  subject_key text not null,
  quarter     int not null,
  file_id     text not null,
  file_name   text,
  topics      int,
  created_at  timestamptz default now(),
  unique (grade, subject_key, quarter)
);

alter table plans add column if not exists year text;
alter table plans add column if not exists medium text;
alter table plans add column if not exists grading text;
update plans set year = '2026/2027' where year is null;
update plans set medium = 'uz' where medium is null;
update plans set grading = 'normal' where grading is null;
alter table plans drop constraint if exists plans_grade_subject_key_quarter_key;
drop index if exists plans_uniq;
drop index if exists plans_uniq2;
create unique index if not exists plans_uniq3
  on plans (grade, subject_key, quarter, year, medium, grading);

create table if not exists subject_extra (
  key        text primary key,
  uz         text,
  ru         text,
  alias      jsonb,
  created_at timestamptz default now()
);
alter table subject_extra add column if not exists sort int default 100;
alter table subject_extra add column if not exists seeded boolean default false;

create table if not exists meta (
  key   text primary key,
  value text
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

-- rejalar o'chirilmaydi, arxivlanadi
alter table plans add column if not exists archived_at timestamptz;

-- forward qilingan reja fayllari (dashboard'da ko'rib chiqiladi)
create table if not exists plan_inbox (
  id             bigserial primary key,
  file_id        text not null,
  file_unique_id text not null,
  file_name      text not null,
  file_size      int,
  caption        text,
  source         text,
  posted_at      timestamptz,
  created_at     timestamptz default now(),
  taken_at       timestamptz,
  dismissed_at   timestamptz
);
create index if not exists plan_inbox_pending
  on plan_inbox (created_at) where taken_at is null and dismissed_at is null;

-- fanlar o'chirilmaydi, arxivlanadi
alter table subject_extra add column if not exists archived_at timestamptz;
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
            a.sub_until, coalesce(a.imports_ok,0) as imports_ok, a.classes
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

export async function setClasses(tgId, classes) {
  await pool.query(
    `update accounts set classes = $2, classes_at = now()
      where id = (select account_id from users where tg_id = $1)`,
    [tgId, JSON.stringify(classes)]);
}

export async function getClasses(tgId) {
  const { rows } = await pool.query(
    `select a.classes from users u join accounts a on a.id = u.account_id where u.tg_id = $1`,
    [tgId]);
  return rows[0]?.classes || null;
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

// Rad etilgan to'lovni qayta ochish
export async function undoReject(id) {
  const { rows } = await pool.query(
    "update payments set status='pending', decided_at=null where id=$1 and status='rejected' returning id",
    [id]);
  return rows[0] || null;
}

export async function ledgerRecent(tgId, n = 10) {
  const { rows } = await pool.query(
    `select l.delta, l.reason, l.created_at from ledger l
       join users u on u.account_id = l.account_id
      where u.tg_id = $1 order by l.id desc limit $2`, [tgId, n]);
  return rows;
}

// ---------- ish rejalar ----------
export async function savePlan({ grade, subjectKey, quarter, year, medium, grading,
                                 fileId, fileName, topics }) {
  const { rows } = await pool.query(
    `insert into plans (grade, subject_key, quarter, year, medium, grading,
                        file_id, file_name, topics)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (grade, subject_key, quarter, year, medium, grading) do update
        set file_id = excluded.file_id, file_name = excluded.file_name,
            topics = excluded.topics, created_at = now(), archived_at = null
     returning *, (xmax = 0) as is_new`,
    [grade, subjectKey, quarter, year, medium, grading || 'normal',
     fileId, fileName, topics]);
  return rows[0];
}

// Fan uchun qaysi baholash turlari mavjud
export async function gradingVariants(grade, subjectKey, quarter, year, medium) {
  const { rows } = await pool.query(
    `select distinct grading from plans
      where grade=$1 and subject_key=$2 and quarter=$3 and year=$4 and medium=$5
        and archived_at is null`,
    [grade, subjectKey, quarter, year, medium]);
  return rows.map(r => r.grading || 'normal');
}

// Bazada mavjud o'quv yillari
export async function planYears() {
  const { rows } = await pool.query(
    'select distinct year from plans where year is not null and archived_at is null order by year desc');
  return rows.map(r => r.year);
}

// Filtr: { medium, stage: 'low'|'high', quarter, year }
export async function planExists({ grade, subjectKey, quarter, year, medium, grading }) {
  const { rows } = await pool.query(
    `select 1 from plans
      where grade=$1 and subject_key=$2 and quarter=$3
        and year=$4 and medium=$5 and grading=$6 and archived_at is null limit 1`,
    [grade, subjectKey, quarter, year, medium, grading || 'normal']);
  return !!rows[0];
}

// Ro'yxat filtri. Tartib: medium, quarter, year, grade, grading, subjectKey, q,
// oxirida archived (standart — faqat arxivlanmaganlar).
export function buildPlanFilter(filter = {}) {
  const cond = [];
  const args = [];
  const add = (col, v) => { args.push(v); cond.push(`${col} = $${args.length}`); };

  if (filter.medium)     add('medium', filter.medium);
  if (filter.quarter)    add('quarter', filter.quarter);
  if (filter.year)       add('year', filter.year);
  if (filter.grade)      add('grade', filter.grade);
  if (filter.grading)    add('grading', filter.grading);
  if (filter.subjectKey) add('subject_key', filter.subjectKey);
  if (filter.q) {
    // ilike maxsus belgilari (% _ \) oddiy belgi sifatida qidiriladi
    args.push(`%${String(filter.q).replace(/[\\%_]/g, m => '\\' + m)}%`);
    const n = args.length;
    cond.push(`(file_name ilike $${n} or subject_key ilike $${n})`);
  }
  cond.push(filter.archived ? 'archived_at is not null' : 'archived_at is null');
  return { where: `where ${cond.join(' and ')}`, args };
}

export async function listPlans(offset = 0, limit = 15, filter = {}) {
  const { where, args } = buildPlanFilter(filter);

  const { rows } = await pool.query(
    `select * from plans ${where} order by grade, subject_key, grading limit $${args.length + 1} offset $${args.length + 2}`,
    [...args, limit, offset]);

  const { rows: c } = await pool.query(`select count(*) from plans ${where}`, args);
  return { rows, total: Number(c[0].count) };
}

export async function countPlans() {
  const { rows } = await pool.query('select count(*) from plans where archived_at is null');
  return Number(rows[0].count);
}

export async function getPlan(id) {
  const { rows } = await pool.query('select * from plans where id = $1', [id]);
  return rows[0] || null;
}

// Dashboard uchun: arxivlangan bo'lsa ham qaytaradi
export const planForPanel = getPlan;

export async function archivePlan(id) {
  const r = await pool.query(
    'update plans set archived_at = now() where id = $1 and archived_at is null', [id]);
  return r.rowCount > 0;
}

export async function restorePlan(id) {
  const r = await pool.query(
    'update plans set archived_at = null where id = $1 and archived_at is not null', [id]);
  return r.rowCount > 0;
}

export async function findPlanByKey({ grade, subjectKey, quarter, year, medium, grading }) {
  const { rows } = await pool.query(
    `select id, archived_at from plans
      where grade=$1 and subject_key=$2 and quarter=$3
        and year=$4 and medium=$5 and grading=$6 limit 1`,
    [grade, subjectKey, quarter, year, medium, grading || 'normal']);
  return rows[0] ? { id: Number(rows[0].id), archived: rows[0].archived_at != null } : null;
}

// Qamrov uchun: shu til va baholashdagi barcha arxivlanmagan rejalar
export async function coverageRows({ medium, grading }) {
  const { rows } = await pool.query(
    `select id, grade, subject_key, quarter, year, topics from plans
      where medium = $1 and grading = $2 and archived_at is null`,
    [medium, grading || 'normal']);
  return rows.map(r => ({ ...r, id: Number(r.id) }));
}

export async function panelCounts({ year, quarter, medium }) {
  const { rows } = await pool.query(
    `select count(*) filter (where archived_at is null)::int as total,
            count(*) filter (where archived_at is null and year = $1
                               and quarter = $2 and medium = $3)::int as "inQuarter",
            count(*) filter (where archived_at is not null)::int as archived
       from plans`,
    [year, quarter, medium]);
  return rows[0];
}

export async function planStats() {
  const { rows } = await pool.query(
    `select quarter, count(*)::int as n from plans where archived_at is null
      group by quarter order by quarter`);
  return rows;
}

// ---------- fanlar (baza yagona manba) ----------
// Birinchi ishga tushishda kodagi lug'at bazaga ko'chiriladi.
// Shundan keyin fanlar faqat bazada boshqariladi.
export async function seedSubjects(list) {
  // Bir marta bajariladi. Belgi meta jadvalida — fanlar o'chirilsa ham qaytmaydi.
  const { rows } = await pool.query("select value from meta where key = 'subjects_seeded'");
  if (rows[0]) return 0;

  let n = 0;
  for (const [i, s] of list.entries()) {
    const r = await pool.query(
      `insert into subject_extra (key, uz, ru, alias, sort, seeded)
       values ($1,$2,$3,$4,$5,true) on conflict (key) do nothing returning key`,
      [s.key, s.uz, s.ru, JSON.stringify(s.alias || []), i]);
    if (r.rows[0]) n++;
  }

  await pool.query(
    "insert into meta (key, value) values ('subjects_seeded', now()::text) " +
    "on conflict (key) do nothing");
  return n;
}

export async function addSubject(key, uz, ru, alias = []) {
  await pool.query(
    `insert into subject_extra (key, uz, ru, alias, sort) values ($1,$2,$3,$4,999)
     on conflict (key) do update
        set uz=excluded.uz, ru=excluded.ru, alias=excluded.alias, archived_at=null`,
    [key, uz, ru, JSON.stringify(alias)]);
}

export async function extraSubjects() {
  const { rows } = await pool.query(
    'select key, uz, ru, alias, sort, seeded from subject_extra where archived_at is null order by sort, uz');
  return rows;
}

export async function getSubject(key) {
  const { rows } = await pool.query('select * from subject_extra where key = $1', [key]);
  return rows[0] || null;
}

export async function updateSubject(key, { uz, ru, alias }) {
  await pool.query(
    `update subject_extra
        set uz = coalesce($2, uz), ru = coalesce($3, ru),
            alias = coalesce($4, alias)
      where key = $1`,
    [key, uz ?? null, ru ?? null, alias ? JSON.stringify(alias) : null]);
}

export async function countPlansBySubject(key) {
  const { rows } = await pool.query(
    'select count(*) from plans where subject_key = $1 and archived_at is null', [key]);
  return Number(rows[0].count);
}

// Fan arxivga olinadi (o'chirilmaydi). withPlans: rejalari ham arxivlanadi.
export async function archiveSubject(key, withPlans = false) {
  if (withPlans) await pool.query(
    'update plans set archived_at = now() where subject_key = $1 and archived_at is null', [key]);
  const r = await pool.query(
    'update subject_extra set archived_at = now() where key = $1 and archived_at is null', [key]);
  return r.rowCount > 0;
}

export async function restoreSubject(key) {
  const r = await pool.query(
    'update subject_extra set archived_at = null where key = $1 and archived_at is not null', [key]);
  return r.rowCount > 0;
}

// Dashboard uchun: arxivlanganlari ham, rejalar soni bilan
export async function subjectsForPanel() {
  const { rows } = await pool.query(
    `select s.key, s.uz, s.ru, s.alias, s.archived_at is not null as archived,
            (select count(*)::int from plans p
              where p.subject_key = s.key and p.archived_at is null) as plans
       from subject_extra s
      order by s.archived_at is not null, s.sort, s.uz`);
  return rows.map(r => ({ ...r, alias: r.alias || [] }));
}

export async function subjectKeyExists(key) {
  const { rows } = await pool.query('select 1 from subject_extra where key = $1', [key]);
  return !!rows[0];
}

// Yangi fan; kalit band bo'lsa xato (ustidan yozmaydi)
export async function insertSubject({ key, uz, ru, alias = [] }) {
  await pool.query(
    'insert into subject_extra (key, uz, ru, alias, sort) values ($1,$2,$3,$4,999)',
    [key, uz, ru, JSON.stringify(alias)]);
}

// ---------- kiruvchi reja fayllari (forward) ----------
const PENDING = 'taken_at is null and dismissed_at is null';

export async function addInbox({ fileId, fileUniqueId, fileName, fileSize, caption, source, postedAt }) {
  const r = await pool.query(
    `insert into plan_inbox (file_id, file_unique_id, file_name, file_size, caption, source, posted_at)
     select $1,$2,$3,$4,$5,$6,$7
      where not exists (select 1 from plan_inbox where file_unique_id = $2 and ${PENDING})`,
    [fileId, fileUniqueId, fileName, fileSize ?? null, caption ?? null, source ?? null, postedAt ?? null]);
  return { added: r.rowCount > 0 };
}

export async function listInbox(limit = 200) {
  const { rows } = await pool.query(
    `select id, file_id, file_name, caption, source, posted_at from plan_inbox
      where ${PENDING} order by created_at, id limit $1`, [limit]);
  return rows.map(r => ({ ...r, id: Number(r.id) }));
}

export async function getInbox(ids) {
  const { rows } = await pool.query(
    `select id, file_id, file_name, caption, source, posted_at from plan_inbox
      where id = any($1::bigint[]) and ${PENDING} order by created_at, id`, [ids]);
  return rows.map(r => ({ ...r, id: Number(r.id) }));
}

// Ko'p yozuvni bir so'rovda; takror — barcha holatlar bo'yicha (Drive uchun)
export async function addInboxMany(recs) {
  if (!recs.length) return 0;
  const col = f => recs.map(f);
  const r = await pool.query(
    `insert into plan_inbox (file_id, file_unique_id, file_name, file_size, caption, source, posted_at)
     select x.f, x.u, x.n, x.s, x.c, x.src, x.p
       from unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::text[], $7::timestamptz[])
            as x(f, u, n, s, c, src, p)
      where not exists (select 1 from plan_inbox i where i.file_unique_id = x.u)`,
    [col(x => x.fileId), col(x => x.fileUniqueId), col(x => x.fileName), col(x => x.fileSize ?? null),
     col(x => x.caption ?? null), col(x => x.source ?? null), col(x => x.postedAt ?? null)]);
  return r.rowCount;
}

// Drive fayl id'laridan qaysilari rejalarda yoki inbox'da allaqachon bor
export async function knownDriveIds(ids) {
  if (!ids.length) return new Set();
  const keys = ids.map(i => 'drive:' + i);
  const { rows } = await pool.query(
    `select file_id as k from plans where file_id = any($1::text[])
      union
     select file_unique_id from plan_inbox where file_unique_id = any($1::text[])`, [keys]);
  return new Set(rows.map(r => r.k.slice(6)));
}

// Ko'p kalit bo'yicha mavjud (arxivlanmagan) rejalar — indekslar
export async function existsMany(keys) {
  if (!keys.length) return [];
  const col = f => keys.map(f);
  const { rows } = await pool.query(
    `select distinct k.i - 1 as i
       from unnest($1::int[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[])
            with ordinality as k(g, s, q, y, m, gr, i)
       join plans p on p.grade = k.g and p.subject_key = k.s and p.quarter = k.q
                   and p.year = k.y and p.medium = k.m and p.grading = k.gr
                   and p.archived_at is null
      order by 1`,
    [col(k => k.grade), col(k => k.subjectKey), col(k => k.quarter), col(k => k.year),
     col(k => k.medium), col(k => k.grading || 'normal')]);
  return rows.map(r => Number(r.i));
}

export async function getMeta(key) {
  const { rows } = await pool.query('select value from meta where key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setMeta(key, value) {
  await pool.query(
    'insert into meta (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value',
    [key, value]);
}

export async function countInbox() {
  const { rows } = await pool.query(`select count(*)::int as n from plan_inbox where ${PENDING}`);
  return rows[0].n;
}

export async function markInbox(ids, field) {
  if (field !== 'taken_at' && field !== 'dismissed_at') throw new Error('bad inbox field');
  if (!ids.length) return 0;
  const r = await pool.query(
    `update plan_inbox set ${field} = now() where id = any($1::bigint[]) and ${PENDING}`, [ids]);
  return r.rowCount;
}

// ---------- admin ro'yxatlari ----------
const LIST_SQL = {
  subs: `select a.full_name, a.login, a.balance, a.sub_until, a.imports_ok, a.tg_id
           from accounts a where a.sub_until >= current_date
          order by a.sub_until asc`,
  money: `select a.full_name, a.login, a.balance, a.sub_until, a.imports_ok, a.tg_id
            from accounts a where a.balance > 0 order by a.balance desc`,
  linked: `select a.full_name, a.login, a.balance, a.sub_until, a.imports_ok, a.tg_id
             from accounts a order by a.created_at desc`,
  imported: `select a.full_name, a.login, a.balance, a.sub_until, a.imports_ok, a.tg_id
               from accounts a where a.imports_ok > 0 order by a.imports_ok desc`,
};

export async function listAccounts(kind, offset = 0, limit = 30) {
  const sql = LIST_SQL[kind];
  if (!sql) return { rows: [], total: 0 };
  const { rows } = await pool.query(`${sql} limit $1 offset $2`, [limit, offset]);
  const { rows: c } = await pool.query(`select count(*) from (${sql}) x`);
  return { rows, total: Number(c[0].count) };
}

// /start bosgan, lekin hisob ulamaganlar
export async function listIdle(offset = 0, limit = 30) {
  const sql = `select u.tg_id, u.created_at from users u
                where u.account_id is null order by u.created_at desc`;
  const { rows } = await pool.query(`${sql} limit $1 offset $2`, [limit, offset]);
  const { rows: c } = await pool.query(`select count(*) from (${sql}) x`);
  return { rows, total: Number(c[0].count) };
}

export async function searchAccounts(q, limit = 10) {
  const { rows } = await pool.query(
    `select a.*, u.tg_id as user_tg from accounts a
       left join users u on u.account_id = a.id
      where a.login ilike $1 or coalesce(a.full_name,'') ilike $1
         or a.tg_id::text = $2
      order by a.imports_ok desc limit $3`,
    [`%${q}%`, q.replace(/\D/g, '') || '0', limit]
  );
  return rows;
}

export async function findByLogin(login) {
  const { rows } = await pool.query('select * from accounts where login = $1', [login]);
  return rows[0] || null;
}

// Admin qo'lda balans qo'shadi (manfiy son — yechadi)
export async function adminAdjust(login, delta) {
  const { rows } = await pool.query(
    `update accounts set balance = greatest(0, balance + $2)
      where login = $1 returning id, tg_id, balance`, [login, delta]);
  if (!rows[0]) return null;
  await pool.query(
    'insert into ledger (account_id, tg_id, delta, reason) values ($1,$2,$3,$4)',
    [rows[0].id, rows[0].tg_id, delta, 'admin']);
  return rows[0];
}

// Xabar yuborish uchun qabul qiluvchilar
export async function recipients(kind) {
  const sql = {
    all:      `select tg_id from users where tg_id is not null`,
    linked:   `select tg_id from accounts where tg_id is not null`,
    subs:     `select tg_id from accounts where sub_until >= current_date and tg_id is not null`,
    money:    `select tg_id from accounts where balance > 0 and tg_id is not null`,
  }[kind];
  if (!sql) return [];
  const { rows } = await pool.query(sql);
  return rows.map(r => Number(r.tg_id));
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

  const soon = await q(`
    select count(*) as n from accounts
     where sub_until >= current_date and sub_until <= current_date + 30`);

  const { rows: top } = await pool.query(`
    select coalesce(full_name, login) as name, imports_ok
      from accounts where imports_ok > 0 order by imports_ok desc limit 5`);

  return { users: { ...users, ...acc }, imp, pay, top, soon: soon.n };
}
