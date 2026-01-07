import 'dotenv/config';
import pkg from 'pg';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const { Pool } = pkg;

const SQLITE_FILE = process.env.SQLITE_FILE || './data.sqlite';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida.');
  process.exit(1);
}

async function main() {
  console.log('➡️ Abrindo SQLite em:', SQLITE_FILE);
  const sdb = await open({ filename: SQLITE_FILE, driver: sqlite3.Database });

  console.log('➡️ Conectando no PostgreSQL...');
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

  // Ensure schema exists (server/index.js also does it on start, but migration might run standalone)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','consultant')),
      consultant_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS consultants (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      consultant_id INTEGER NOT NULL,
      consultant_name TEXT NOT NULL,
      client_name TEXT NOT NULL,
      product TEXT NOT NULL,
      sale_date TEXT NOT NULL,
      insurance BOOLEAN NOT NULL DEFAULT FALSE,
      base_value DOUBLE PRECISION NOT NULL,
      quotas INTEGER DEFAULT 1,
      unit_value DOUBLE PRECISION DEFAULT 0,
      commission_percentage DOUBLE PRECISION NOT NULL,
      total_commission DOUBLE PRECISION NOT NULL,
      credit_generated DOUBLE PRECISION DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (now()::text),
      updated_at TEXT NOT NULL DEFAULT (now()::text)
    );
    CREATE TABLE IF NOT EXISTS installments (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('paid','pending','overdue')),
      paid_date TEXT,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sale_quotas (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    );
  `);

  console.log('⚠️ Limpando tabelas no PostgreSQL (TRUNCATE)...');
  await pool.query(`TRUNCATE sale_quotas, installments, sales, users, consultants RESTART IDENTITY CASCADE;`);

  const consultants = await sdb.all('SELECT * FROM consultants');
  const users = await sdb.all('SELECT * FROM users');
  const sales = await sdb.all('SELECT * FROM sales');
  const installments = await sdb.all('SELECT * FROM installments');
  const quotas = await sdb.all('SELECT * FROM sale_quotas');

  console.log(`➡️ Importando consultants: ${consultants.length}`);
  for (const c of consultants) {
    await pool.query(
      `INSERT INTO consultants (id, name, email, active) VALUES ($1,$2,$3,$4)`,
      [c.id, c.name, c.email ?? null, !!c.active]
    );
  }

  console.log(`➡️ Importando users: ${users.length}`);
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role, consultant_id) VALUES ($1,$2,$3,$4,$5)`,
      [u.id, u.username, u.password_hash, u.role, u.consultant_id ?? null]
    );
  }

  console.log(`➡️ Importando sales: ${sales.length}`);
  for (const s of sales) {
    await pool.query(
      `INSERT INTO sales (
        id, consultant_id, consultant_name, client_name, product, sale_date, insurance,
        base_value, quotas, unit_value, commission_percentage, total_commission, credit_generated,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        s.id, s.consultant_id, s.consultant_name, s.client_name, s.product, s.sale_date,
        !!s.insurance,
        Number(s.base_value), Number(s.quotas ?? 1), Number(s.unit_value ?? 0),
        Number(s.commission_percentage), Number(s.total_commission), Number(s.credit_generated ?? 0),
        s.created_at ?? null, s.updated_at ?? null
      ]
    );
  }

  console.log(`➡️ Importando installments: ${installments.length}`);
  for (const it of installments) {
    await pool.query(
      `INSERT INTO installments (id, sale_id, number, value, due_date, status, paid_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [it.id, it.sale_id, it.number, Number(it.value), it.due_date, it.status, it.paid_date ?? null]
    );
  }

  console.log(`➡️ Importando sale_quotas: ${quotas.length}`);
  for (const q of quotas) {
    await pool.query(
      `INSERT INTO sale_quotas (id, sale_id, number, value)
       VALUES ($1,$2,$3,$4)`,
      [q.id, q.sale_id, q.number, Number(q.value)]
    );
  }

  // Reset sequences to max(id)
  await pool.query(`SELECT setval(pg_get_serial_sequence('consultants','id'), COALESCE(MAX(id),1)) FROM consultants;`);
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), COALESCE(MAX(id),1)) FROM users;`);
  await pool.query(`SELECT setval(pg_get_serial_sequence('sales','id'), COALESCE(MAX(id),1)) FROM sales;`);
  await pool.query(`SELECT setval(pg_get_serial_sequence('installments','id'), COALESCE(MAX(id),1)) FROM installments;`);
  await pool.query(`SELECT setval(pg_get_serial_sequence('sale_quotas','id'), COALESCE(MAX(id),1)) FROM sale_quotas;`);

  console.log('✅ Migração concluída.');
  await pool.end();
  await sdb.close();
}

main().catch((e) => {
  console.error('❌ Erro na migração:', e);
  process.exit(1);
});
