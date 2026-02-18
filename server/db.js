import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDialect() {
  const explicit = (process.env.DB_DIALECT || '').trim().toLowerCase();
  if (explicit === 'postgres' || explicit === 'postgresql' || explicit === 'pg') return 'postgres';
  if (explicit === 'sqlite' || explicit === 'sqlite3') return 'sqlite';

  if (
    process.env.DATABASE_URL ||
    process.env.DATABASE_URL_PRIVATE ||
    process.env.DATABASE_PUBLIC_URL ||
    process.env.PGHOST ||
    process.env.PGHOST_PRIVATE
  ) {
    return 'postgres';
  }
  return 'sqlite';
}

function getSqliteFile() {
  // For Railway/Render-like deploys you can mount a persistent disk at /data.
  const preferredDir = process.env.DB_DIR || (fs.existsSync('/data') ? '/data' : __dirname);
  return path.join(preferredDir, process.env.DB_FILE || 'data.sqlite');
}

function shouldUseSsl(connectionString) {
  if (process.env.DB_SSL === '1') return true;
  if ((process.env.PGSSLMODE || '').toLowerCase() === 'require') return true;
  if (!connectionString) return false;
  try {
    const u = new URL(connectionString);
    const sslmode = (u.searchParams.get('sslmode') || '').toLowerCase();
    return sslmode === 'require' || sslmode === 'verify-full' || sslmode === 'verify-ca';
  } catch {
    return false;
  }
}

function replaceQMarksWithPgParams(sql) {
  let out = '';
  let paramIndex = 0;
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < sql.length) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : '';

    if (inLineComment) {
      out += ch;
      if (ch === '\n') inLineComment = false;
      i += 1;
      continue;
    }

    if (inBlockComment) {
      out += ch;
      if (ch === '*' && next === '/') {
        out += next;
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inSingle) {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }

    if (inDouble) {
      out += ch;
      if (ch === '"' && next === '"') {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      i += 1;
      continue;
    }

    if (ch === '-' && next === '-') {
      out += ch + next;
      inLineComment = true;
      i += 2;
      continue;
    }

    if (ch === '/' && next === '*') {
      out += ch + next;
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (ch === "'") {
      out += ch;
      inSingle = true;
      i += 1;
      continue;
    }

    if (ch === '"') {
      out += ch;
      inDouble = true;
      i += 1;
      continue;
    }

    if (ch === '?') {
      paramIndex += 1;
      out += `$${paramIndex}`;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function isInsertNeedingReturningId(sql) {
  const s = String(sql || '').trim();
  if (!/^insert\s+/i.test(s)) return false;
  if (/returning\s+/i.test(s)) return false;
  return true;
}

export async function createDb() {
  const dialect = resolveDialect();

  if (dialect === 'sqlite') {
    const sqliteDb = await open({
      filename: getSqliteFile(),
      driver: sqlite3.Database
    });

    return {
      dialect,
      exec: (sql) => sqliteDb.exec(sql),
      run: (sql, params = []) => sqliteDb.run(sql, params),
      get: (sql, params = []) => sqliteDb.get(sql, params),
      all: (sql, params = []) => sqliteDb.all(sql, params),
      close: () => sqliteDb.close()
    };
  }

  const connectionString =
    process.env.DATABASE_URL ||
    process.env.DATABASE_URL_PRIVATE ||
    process.env.DATABASE_PUBLIC_URL ||
    null;

  const host = process.env.PGHOST_PRIVATE || process.env.PGHOST || null;
  const portRaw = process.env.PGPORT_PRIVATE || process.env.PGPORT || null;
  const user = process.env.PGUSER || null;
  const password = process.env.PGPASSWORD || null;
  const database = process.env.PGDATABASE || null;

  if (!connectionString) {
    const missing = [];
    if (!host) missing.push('PGHOST (ou PGHOST_PRIVATE)');
    if (!portRaw) missing.push('PGPORT (ou PGPORT_PRIVATE)');
    if (!user) missing.push('PGUSER');
    if (!password) missing.push('PGPASSWORD');
    if (!database) missing.push('PGDATABASE');
    if (missing.length) {
      throw new Error(
        `Postgres selecionado mas faltam variáveis de conexão: ${missing.join(
          ', '
        )}. Defina DATABASE_URL (recomendado) ou todas as PG* acima.`
      );
    }
  }

  const port = portRaw != null ? Number(portRaw) : null;
  const ssl = shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined;

  const pool = new Pool({
    ...(connectionString
      ? { connectionString }
      : { host, port, user, password, database }),
    ssl,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS || 30_000)
  });

  const txStore = new AsyncLocalStorage();

  async function query(text, values) {
    const runner = txStore.getStore()?.client || pool;
    return runner.query(text, values);
  }

  async function exec(sql) {
    const trimmed = String(sql || '').trim().replace(/;+\s*$/, '');
    const upper = trimmed.toUpperCase();

    if (upper === 'BEGIN' || upper === 'BEGIN TRANSACTION') {
      if (txStore.getStore()?.client) throw new Error('Transaction already started');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
      } catch (e) {
        try { client.release(); } catch {}
        throw e;
      }
      txStore.enterWith({ client });
      return;
    }

    if (upper === 'COMMIT') {
      const client = txStore.getStore()?.client;
      if (!client) return;
      try {
        await client.query('COMMIT');
      } finally {
        client.release();
        txStore.enterWith(null);
      }
      return;
    }

    if (upper === 'ROLLBACK') {
      const client = txStore.getStore()?.client;
      if (!client) return;
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
        txStore.enterWith(null);
      }
      return;
    }

    await query(sql, undefined);
  }

  async function run(sql, params = []) {
    let text = replaceQMarksWithPgParams(sql);
    const values = Array.isArray(params) ? params : [];

    let returning = false;
    if (isInsertNeedingReturningId(text)) {
      returning = true;
      text = `${text} RETURNING id`;
    }

    const r = await query(text, values);
    return {
      changes: r.rowCount || 0,
      ...(returning && r.rows?.[0]?.id != null ? { lastID: Number(r.rows[0].id) } : {})
    };
  }

  async function get(sql, params = []) {
    const text = replaceQMarksWithPgParams(sql);
    const values = Array.isArray(params) ? params : [];
    const r = await query(text, values);
    return r.rows?.[0];
  }

  async function all(sql, params = []) {
    const text = replaceQMarksWithPgParams(sql);
    const values = Array.isArray(params) ? params : [];
    const r = await query(text, values);
    return r.rows || [];
  }

  async function close() {
    const client = txStore.getStore()?.client;
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      try {
        client.release();
      } catch {}
      txStore.enterWith(null);
    }
    await pool.end();
  }

  return { dialect, exec, run, get, all, close };
}
