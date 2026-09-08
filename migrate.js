import 'dotenv/config';
import pg from 'pg';
import { SCHEMA } from './db.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(SCHEMA);
console.log('Jadvallar tayyor.');
await pool.end();
