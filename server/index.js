import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { createDb } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const ADMIN_USER = String(process.env.ADMIN_USER || 'admin').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const CONSULTANT_DEFAULT_PASSWORD = process.env.CONSULTANT_DEFAULT_PASSWORD || 'consultor'; 

const CONSULTANT_PASSWORDS = (() => {
  // Você pode sobrescrever via env com JSON: CONSULTANT_PASSWORDS_JSON='{"gustavo":"Senha..."}'
  const fallback = {
    'graziele': 'RaconGraz!26',
    'gustavo': 'RaconGus@74',
    'pedro': 'RaconPed#39',
    'poli': 'RaconPoli$58',
    'marcelo': 'RaconMarc%81',
    'victor': 'RaconVic&62',
    'wanderson': 'Raconwand@459',
  };
  try {
    if (process.env.CONSULTANT_PASSWORDS_JSON) {
      const parsed = JSON.parse(process.env.CONSULTANT_PASSWORDS_JSON);
      return { ...fallback, ...parsed };
    }
  } catch (e) {
    console.warn('⚠️ CONSULTANT_PASSWORDS_JSON inválido. Usando fallback.');
  }
  return fallback;
})();
const RESET_CONSULTANT_PASSWORDS = process.env.RESET_CONSULTANT_PASSWORDS === '1';
const RESET_SALES_DATA = process.env.RESET_SALES_DATA === '1';

function generateConsultantPassword(username, consultantId) {
  // Senha "média": prefixo + parte do usuário + símbolo + número (tende a ser única por consultor)
  const clean = String(username || 'consultor').replace(/[^a-z0-9]/gi, '');
  const part = (clean.slice(0, 4) || 'user').padEnd(4, 'x');
  const n = Number(consultantId || 0);
  const num = String((n * 37 + 100) % 900 + 100); // 100-999
  const symbols = ['!', '@', '#', '$', '%', '&'];
  const sym = symbols[n % symbols.length];
  return `Racon${part}${sym}${num}`;
}

function getConsultantPassword(username, consultantId) {
  return CONSULTANT_PASSWORDS[username] || generateConsultantPassword(username, consultantId);
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}


const DEFAULT_CONSULTANTS = [
  'Graziele',
  'Gustavo',
  'Pedro',
  'Poli',
  'Marcelo',
  'Victor',
  'Wanderson'
];

let db;

// =========================
// Helpers
// =========================
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Regra: 1 mês sem pagar boleto atrasado => fase de cancelamento
// (padrão 30 dias; dá pra ajustar via env CANCELLATION_PHASE_DAYS)
const CANCELLATION_PHASE_DAYS = Number(process.env.CANCELLATION_PHASE_DAYS || 30);

function isCancellationPhaseInstallment(it) {
  const billOverdue = Number(it?.bill_overdue || 0) ? 1 : 0;
  if (!billOverdue) return 0;

  const isPaid = String(it?.status || '') === 'paid' || !!it?.paid_date;
  if (isPaid) return 0;

  const dueRaw = String(it?.due_date || '').slice(0, 10);
  // due_date é salvo como YYYY-MM-DD. Nesse formato, o JS interpreta como UTC (ok pra regra de dias).
  const due = new Date(dueRaw);
  if (Number.isNaN(due.getTime())) return 0;

  const now = new Date();
  const diffDays = Math.floor((now.getTime() - due.getTime()) / MS_PER_DAY);
  return diffDays >= CANCELLATION_PHASE_DAYS ? 1 : 0;
}

async function initDb() {
  db = await createDb();
  console.log(`[db] dialect=${db.dialect}`);

  if (db.dialect === 'sqlite') {
    await db.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','consultant')),
      consultant_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS consultants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultant_id INTEGER NOT NULL,
      consultant_name TEXT NOT NULL,
      client_number TEXT,
      client_name TEXT NOT NULL,
      product TEXT NOT NULL,
      sale_date TEXT NOT NULL,
      insurance INTEGER NOT NULL DEFAULT 0,
      base_value REAL NOT NULL,
      quotas INTEGER DEFAULT 1,
      unit_value REAL DEFAULT 0,
      commission_percentage REAL NOT NULL,
      total_commission REAL NOT NULL,
      credit_generated REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      value REAL NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('paid','pending','overdue')),
      -- Quando marcado, indica que o cliente está com boleto atrasado (não é atraso de comissão da empresa)
      bill_overdue INTEGER NOT NULL DEFAULT 0,
      paid_date TEXT,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    );

    -- Individual quotas (cotas) for each sale
    CREATE TABLE IF NOT EXISTS sale_quotas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      value REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    );

    CREATE TRIGGER IF NOT EXISTS trg_sales_updated
    AFTER UPDATE ON sales
    FOR EACH ROW
    BEGIN
      UPDATE sales SET updated_at = datetime('now') WHERE id = OLD.id;
    END;
  `);

  // ---- Migrations (idempotent)
  // Older DBs may not have the new sales.client_number column.
  try {
    const cols = await db.all(`PRAGMA table_info(sales)`);
    const hasClientNumber = cols.some(c => c.name === 'client_number');
    if (!hasClientNumber) {
      await db.exec(`ALTER TABLE sales ADD COLUMN client_number TEXT;`);
      console.log('[migration] added sales.client_number');
    }
  } catch (e) {
    console.warn('[migration] failed sales PRAGMA/ALTER.', e?.message || e);
  }

  // Older DBs may not have the new installments.bill_overdue column.
  try {
    const cols = await db.all(`PRAGMA table_info(installments)`);
    const hasBillOverdue = cols.some(c => c.name === 'bill_overdue');
    if (!hasBillOverdue) {
      await db.exec(`ALTER TABLE installments ADD COLUMN bill_overdue INTEGER NOT NULL DEFAULT 0;`);
      console.log('🧩 Migração: adicionada coluna installments.bill_overdue');
    }
  } catch (e) {
    console.warn('⚠️ Não foi possível rodar migrações de installments (PRAGMA/ALTER).', e?.message || e);
  }

  } else {
    await db.exec(`
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
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        consultant_id INTEGER NOT NULL,
        consultant_name TEXT NOT NULL,
        client_number TEXT,
        client_name TEXT NOT NULL,
        product TEXT NOT NULL,
        sale_date TEXT NOT NULL,
        insurance INTEGER NOT NULL DEFAULT 0,
        base_value DOUBLE PRECISION NOT NULL,
        quotas INTEGER DEFAULT 1,
        unit_value DOUBLE PRECISION DEFAULT 0,
        commission_percentage DOUBLE PRECISION NOT NULL,
        total_commission DOUBLE PRECISION NOT NULL,
        credit_generated DOUBLE PRECISION DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
        updated_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
      );

      CREATE TABLE IF NOT EXISTS installments (
        id SERIAL PRIMARY KEY,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        value DOUBLE PRECISION NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('paid','pending','overdue')),
        bill_overdue INTEGER NOT NULL DEFAULT 0,
        paid_date TEXT
      );

      CREATE TABLE IF NOT EXISTS sale_quotas (
        id SERIAL PRIMARY KEY,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        value DOUBLE PRECISION NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sales_consultant_id ON sales(consultant_id);
      CREATE INDEX IF NOT EXISTS idx_installments_sale_id ON installments(sale_id);
      CREATE INDEX IF NOT EXISTS idx_sale_quotas_sale_id ON sale_quotas(sale_id);
    `);

    await db.exec(`
      CREATE OR REPLACE FUNCTION trg_set_sales_updated_at()
      RETURNS trigger AS $$
      BEGIN
        NEW.updated_at := to_char(now(), 'YYYY-MM-DD HH24:MI:SS');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_sales_updated ON sales;
      CREATE TRIGGER trg_sales_updated
      BEFORE UPDATE ON sales
      FOR EACH ROW
      EXECUTE FUNCTION trg_set_sales_updated_at();
    `);

    try {
      await db.exec(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_number TEXT;`);
    } catch (e) {
      console.warn('[migration] failed postgres ALTER (sales.client_number).', e?.message || e);
    }

    try {
      await db.exec(`ALTER TABLE installments ADD COLUMN IF NOT EXISTS bill_overdue INTEGER NOT NULL DEFAULT 0;`);
    } catch (e) {
      console.warn('[migration] failed postgres ALTER (installments.bill_overdue).', e?.message || e);
    }
  }

  // Optional: wipe sales data (useful to re-import and match an Excel exactly).
  // WARNING: this is destructive. Enable only temporarily, then remove the env var.
  if (RESET_SALES_DATA) {
    try {
      const before = await db.get(
        `SELECT
          (SELECT COUNT(*) FROM sales) AS sales,
          (SELECT COUNT(*) FROM installments) AS installments,
          (SELECT COUNT(*) FROM sale_quotas) AS sale_quotas`
      );
      console.warn('⚠️ RESET_SALES_DATA=1: apagando vendas/parcelas/cotas...', before);

      if (db.dialect === 'sqlite') {
        await db.exec(`
          BEGIN;
          DELETE FROM sale_quotas;
          DELETE FROM installments;
          DELETE FROM sales;
          DELETE FROM sqlite_sequence WHERE name IN ('sales','installments','sale_quotas');
          COMMIT;
        `);
      } else {
        await db.exec('BEGIN');
        await db.exec('TRUNCATE TABLE sale_quotas, installments, sales RESTART IDENTITY CASCADE');
        await db.exec('COMMIT');
      }

      const after = await db.get(
        `SELECT
          (SELECT COUNT(*) FROM sales) AS sales,
          (SELECT COUNT(*) FROM installments) AS installments,
          (SELECT COUNT(*) FROM sale_quotas) AS sale_quotas`
      );
      console.warn('✅ Reset concluído.', { before, after });
    } catch (e) {
      console.error('❌ Falha ao resetar vendas (RESET_SALES_DATA).', e?.message || e);
    }
  }

  // Ensure admin user
  const admin = await db.get('SELECT id FROM users WHERE username=?', [ADMIN_USER]);
  if (!admin) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await db.run('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)', [ADMIN_USER, hash, 'admin']);
    console.log(`✅ Admin criado: ${ADMIN_USER}`);
  }

  // Seed default consultants (idempotent)
  for (const name of DEFAULT_CONSULTANTS) {
    const existing = await db.get('SELECT id FROM consultants WHERE name=?', [name]);
    if (!existing) {
      await db.run('INSERT INTO consultants(name,email,active) VALUES(?,?,?)', [name, null, 1]);
    }
  }

  // Create consultant logins (idempotent)
  const consultants = await db.all('SELECT id, name FROM consultants WHERE active=1');
  for (const c of consultants) {
    const existingLogin = await db.get(
      'SELECT id, username, password_hash FROM users WHERE role=? AND consultant_id=? ORDER BY id DESC LIMIT 1',
      ['consultant', c.id]
    );

    if (!existingLogin) {
      const baseUsername = normalizeUsername(slugify(c.name)) || `consultor-${c.id}`;
      let username = baseUsername;
      let suffix = 2;
      while (await db.get('SELECT id FROM users WHERE username=?', [username])) {
        username = `${baseUsername}-${suffix}`;
        suffix += 1;
      }

      const rawPassword = getConsultantPassword(username, c.id);
      const hash = await bcrypt.hash(rawPassword, 10);
      await db.run(
        'INSERT INTO users(username,password_hash,role,consultant_id) VALUES(?,?,?,?)',
        [username, hash, 'consultant', c.id]
      );
      console.log(`✅ Consultor criado: ${c.name} (${username})`);
    } else {
      // Se o consultor já existia, não quebramos o acesso dele.
      // Porém, se ele ainda estiver com a senha padrão (ex: "consultor"), atualizamos automaticamente
      // para a senha individual. Você também pode forçar a atualização via RESET_CONSULTANT_PASSWORDS=1.
      const stillDefault = await bcrypt.compare(CONSULTANT_DEFAULT_PASSWORD, existingLogin.password_hash);
      if (RESET_CONSULTANT_PASSWORDS || stillDefault) {
        const rawPassword = getConsultantPassword(normalizeUsername(existingLogin.username), c.id);
        const hash = await bcrypt.hash(rawPassword, 10);
        await db.run('UPDATE users SET password_hash=? WHERE id=?', [hash, existingLogin.id]);
        console.log(`🔁 Senha do consultor atualizada: ${c.name} (${existingLogin.username})`);
      }
    }
  }
}

function slugify(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function signUser(user) {
  return jwt.sign(
    { id: user.id, role: user.role, consultant_id: user.consultant_id || null },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function auth(requiredRole = null) {
  return (req, res, next) => {
    const token = req.cookies?.session;
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      if (requiredRole && payload.role !== requiredRole) return res.status(403).json({ error: 'forbidden' });
      next();
    } catch {
      return res.status(401).json({ error: 'unauthorized' });
    }
  };
}

function calcTotalCommission(baseValue, pct) {
  const p = Number(pct);
  const b = Number(baseValue);
  const total = b * (p / 100);
  return Math.round(total * 100) / 100;
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // handle month rollovers
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

async function upsertInstallments(saleId, totalCommission, saleDate, providedInstallments) {
  // default 6 parcelas iguais, vencimento mensal a partir do mês seguinte
  let installments = providedInstallments;
  if (!Array.isArray(installments) || installments.length === 0) {
    const per = Math.round((totalCommission / 6) * 100) / 100;
    installments = Array.from({ length: 6 }, (_, i) => ({
      number: i + 1,
      value: per,
      due_date: addMonths(saleDate, i + 1),
      status: 'pending',
      bill_overdue: 0,
      paid_date: null
    }));
    // adjust rounding on last
    const sum = installments.reduce((a, x) => a + x.value, 0);
    const diff = Math.round((totalCommission - sum) * 100) / 100;
    if (diff !== 0) installments[5].value = Math.round((installments[5].value + diff) * 100) / 100;
  } else {
    installments = installments.map((it, idx) => ({
      number: Number(it.number ?? (idx + 1)),
      value: Number(it.value ?? 0),
      due_date: String(it.due_date),
      status: it.status === 'paid' || it.status === 'overdue' ? it.status : 'pending',
      bill_overdue: Number(it.bill_overdue || 0) ? 1 : 0,
      paid_date: it.paid_date ? String(it.paid_date) : null
    }));
  }

  await db.run('DELETE FROM installments WHERE sale_id=?', [saleId]);
  for (const it of installments) {
    await db.run(
      'INSERT INTO installments(sale_id, number, value, due_date, status, bill_overdue, paid_date) VALUES(?,?,?,?,?,?,?)',
      [saleId, it.number, it.value, it.due_date, it.status, it.bill_overdue ? 1 : 0, it.paid_date]
    );
  }
}

function normalizeQuotasValues(input) {
  if (!Array.isArray(input)) return null;
  const values = input
    .map(v => Number(typeof v === 'object' && v ? v.value : v))
    .filter(v => Number.isFinite(v) && v >= 0);
  if (values.length === 0) return null;
  return values.map(v => Math.round(v * 100) / 100);
}

async function upsertQuotas(saleId, quotasValues) {
  await db.run('DELETE FROM sale_quotas WHERE sale_id=?', [saleId]);
  for (let i = 0; i < quotasValues.length; i++) {
    await db.run(
      'INSERT INTO sale_quotas(sale_id, number, value) VALUES(?,?,?)',
      [saleId, i + 1, Number(quotasValues[i])]
    );
  }
}

async function getQuotasBySaleIds(saleIds) {
  if (!saleIds.length) return new Map();
  const rows = await db.all(
    `SELECT sale_id, number, value FROM sale_quotas WHERE sale_id IN (${saleIds.map(() => '?').join(',')}) ORDER BY sale_id, number`,
    saleIds
  );
  const m = new Map();
  for (const r of rows) {
    const arr = m.get(r.sale_id) || [];
    arr.push({ number: Number(r.number), value: Number(r.value) });
    m.set(r.sale_id, arr);
  }
  return m;
}

async function ensureLegacyQuotasForSale(saleRow) {
  // If older DB has quotas/unit_value but no rows in sale_quotas, create them once.
  const existing = await db.get('SELECT id FROM sale_quotas WHERE sale_id=? LIMIT 1', [saleRow.id]);
  if (existing) return;
  const q = Math.max(1, Number(saleRow.quotas || 1));
  const uv = Number(saleRow.unit_value || 0);
  const values = Array.from({ length: q }, () => Math.round(uv * 100) / 100);
  await upsertQuotas(saleRow.id, values);
}

// ---- Auth routes
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });

  const rawUsername = String(username).trim();
  const normalizedUsername = normalizeUsername(rawUsername);
  let user = await db.get('SELECT * FROM users WHERE username=?', [normalizedUsername]);
  if (!user && rawUsername !== normalizedUsername) {
    user = await db.get('SELECT * FROM users WHERE username=?', [rawUsername]);
  }
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  const token = signUser(user);
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  return res.json({
    ok: true,
    user: { role: user.role, consultant_id: user.consultant_id || null }
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth(), async (req, res) => {
  res.json({ ok: true, user: req.user });
});

// Public: list consultants for the login screen
app.get('/api/public/consultants', async (req, res) => {
  const rows = await db.all(`
    SELECT
      c.id,
      c.name,
      (
        SELECT u.username
        FROM users u
        WHERE u.consultant_id = c.id AND u.role = 'consultant'
        ORDER BY u.id DESC
        LIMIT 1
      ) AS login_username
    FROM consultants c
    WHERE c.active=1
    ORDER BY c.name
  `);
  res.json(rows);
});

// ---- Admin: Consultants & consultant users
app.get('/api/consultants', auth(), async (req, res) => {
  const rows = await db.all(`
    SELECT
      c.id,
      c.name,
      c.email,
      c.active,
      (
        SELECT u.username
        FROM users u
        WHERE u.consultant_id = c.id AND u.role = 'consultant'
        ORDER BY u.id DESC
        LIMIT 1
      ) AS login_username
    FROM consultants c
    ORDER BY c.name
  `);
  res.json(rows);
});

app.post('/api/consultants', auth('admin'), async (req, res) => {
  const { name, email, active = true } = req.body || {};
  if (!name) return res.status(400).json({ error: 'missing_name' });
  const r = await db.run('INSERT INTO consultants(name,email,active) VALUES(?,?,?)', [
    String(name).trim(),
    email ? String(email).trim() : null,
    active ? 1 : 0
  ]);
  const created = await db.get(`
    SELECT
      c.id,
      c.name,
      c.email,
      c.active,
      (
        SELECT u.username
        FROM users u
        WHERE u.consultant_id = c.id AND u.role = 'consultant'
        ORDER BY u.id DESC
        LIMIT 1
      ) AS login_username
    FROM consultants c
    WHERE c.id=?
  `, [r.lastID]);
  res.json(created);
});

app.put('/api/consultants/:id', auth('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.get('SELECT * FROM consultants WHERE id=?', [id]);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, email, active } = req.body || {};
  await db.run('UPDATE consultants SET name=?, email=?, active=? WHERE id=?', [
    name !== undefined ? String(name).trim() : existing.name,
    email !== undefined ? (email ? String(email).trim() : null) : existing.email,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    id
  ]);

  const updated = await db.get(`
    SELECT
      c.id,
      c.name,
      c.email,
      c.active,
      (
        SELECT u.username
        FROM users u
        WHERE u.consultant_id = c.id AND u.role = 'consultant'
        ORDER BY u.id DESC
        LIMIT 1
      ) AS login_username
    FROM consultants c
    WHERE c.id=?
  `, [id]);
  res.json(updated);
});

app.post('/api/consultants/:id/create-login', auth('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const consultant = await db.get('SELECT * FROM consultants WHERE id=?', [id]);
  if (!consultant) return res.status(404).json({ error: 'not_found' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });

  const normalizedUsername = normalizeUsername(username);
  const hash = await bcrypt.hash(String(password), 10);
  if (!normalizedUsername) return res.status(400).json({ error: 'missing_fields' });

  try {
    const consultantLogins = await db.all(
      'SELECT id, username FROM users WHERE role=? AND consultant_id=? ORDER BY id DESC',
      ['consultant', id]
    );
    const byUsername = await db.get(
      'SELECT id, role, consultant_id FROM users WHERE username=?',
      [normalizedUsername]
    );

    if (
      byUsername &&
      !(byUsername.role === 'consultant' && Number(byUsername.consultant_id) === id)
    ) {
      return res.status(400).json({ error: 'username_taken' });
    }

    const target = byUsername && byUsername.role === 'consultant' && Number(byUsername.consultant_id) === id
      ? byUsername
      : consultantLogins[0];

    if (target) {
      await db.run(
        'UPDATE users SET username=?, password_hash=?, role=?, consultant_id=? WHERE id=?',
        [normalizedUsername, hash, 'consultant', id, target.id]
      );
      for (const extra of consultantLogins) {
        if (Number(extra.id) !== Number(target.id)) {
          await db.run('DELETE FROM users WHERE id=?', [extra.id]);
        }
      }
    } else {
      await db.run(
        'INSERT INTO users(username,password_hash,role,consultant_id) VALUES(?,?,?,?)',
        [normalizedUsername, hash, 'consultant', id]
      );
    }

    res.json({ ok: true, username: normalizedUsername });
  } catch (e) {
    res.status(400).json({ error: 'username_taken' });
  }
});

app.delete('/api/consultants/:id/login', auth('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const consultant = await db.get('SELECT * FROM consultants WHERE id=?', [id]);
  if (!consultant) return res.status(404).json({ error: 'not_found' });

  const deleted = await db.run('DELETE FROM users WHERE role=? AND consultant_id=?', ['consultant', id]);
  if (!deleted.changes) return res.status(404).json({ error: 'login_not_found' });

  res.json({ ok: true, deleted: deleted.changes });
});

// ---- Sales
app.get('/api/sales', auth(), async (req, res) => {
  const { role, consultant_id } = req.user;
  const rows = role === 'admin'
    ? await db.all('SELECT * FROM sales ORDER BY sale_date DESC, id DESC')
    : await db.all('SELECT * FROM sales WHERE consultant_id=? ORDER BY sale_date DESC, id DESC', [consultant_id]);

  const saleIds = rows.map(r => r.id);

  // Ensure legacy quotas are materialized
  for (const r of rows) {
    await ensureLegacyQuotasForSale(r);
  }

  const quotasMap = await getQuotasBySaleIds(saleIds);
  const installments = saleIds.length
    ? await db.all(
        `SELECT * FROM installments WHERE sale_id IN (${saleIds.map(() => '?').join(',')}) ORDER BY sale_id, number`,
        saleIds
      )
    : [];

  const bySale = new Map();
  for (const it of installments) {
    const arr = bySale.get(it.sale_id) || [];
    arr.push({
      number: it.number,
      value: it.value,
      due_date: it.due_date,
      status: it.status,
      bill_overdue: Number(it.bill_overdue || 0) ? 1 : 0,
      cancellation_phase: isCancellationPhaseInstallment(it),
      paid_date: it.paid_date
    });
    bySale.set(it.sale_id, arr);
  }

  const out = rows.map(r => ({
    ...r,
    insurance: !!r.insurance,
    quotas_values: (quotasMap.get(r.id) || []).map(x => x.value),
    installments: bySale.get(r.id) || []
  }));

  res.json(out);
});

// ---- Ranking (visível para qualquer usuário logado)
// Retorna apenas dados agregados (sem expor detalhes de clientes/vendas).
app.get('/api/ranking', auth(), async (req, res) => {
  // Ranking do "Jogo de Vendas" (jan → mar/2026)
  // Para evitar trapaças: só conta vendas com sale_date entre 2026-01-01 e 2026-03-31.
  const DEFAULT_START = '2026-01-01';
  const DEFAULT_END = '2026-03-31';

  const start = String(req.query.start || DEFAULT_START).trim();
  const end = String(req.query.end || DEFAULT_END).trim();
  const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  if (!isISODate(start) || !isISODate(end)) {
    return res.status(400).json({ error: 'invalid_date_range' });
  }

  const rows = await db.all(
    `SELECT
        c.id AS consultant_id,
        c.name AS name,
        COALESCE(SUM(s.base_value), 0) AS total_sales,
        COUNT(s.id) AS sales_count
     FROM consultants c
     LEFT JOIN sales s
       ON s.consultant_id = c.id
      AND s.sale_date >= ?
      AND s.sale_date <= ?
     WHERE c.active = 1
     GROUP BY c.id, c.name
     ORDER BY total_sales DESC, sales_count DESC, c.name ASC`,
    [start, end]
  );

res.json(
    rows.map(r => ({
      consultant_id: r.consultant_id,
      name: r.name,
      totalSales: Number(r.total_sales || 0),
      salesCount: Number(r.sales_count || 0)
    }))
  );
});

app.post('/api/sales', auth(), async (req, res) => {
  const { role, consultant_id } = req.user;
  const body = req.body || {};

  // consultant can only create for themselves
  const cid = role === 'admin' ? Number(body.consultant_id) : Number(consultant_id);
  if (!cid) return res.status(400).json({ error: 'missing_consultant' });

  const consultant = await db.get('SELECT * FROM consultants WHERE id=?', [cid]);
  if (!consultant) return res.status(400).json({ error: 'invalid_consultant' });

  const quotas_values = normalizeQuotasValues(body.quotas_values);
  // Backward compatible: quotas + unit_value
  const legacyQuotasCount = Math.max(1, Number(body.quotas ?? 1));
  const legacyUnit = Number(body.unit_value ?? 0);
  const quotasValuesFinal = quotas_values || Array.from({ length: legacyQuotasCount }, () => Math.round(legacyUnit * 100) / 100);

  const base_value = quotasValuesFinal.reduce((a, v) => a + Number(v || 0), 0);
  const commission_percentage = Number(body.commission_percentage);
  if (!body.client_name || !body.product || !body.sale_date || !Number.isFinite(base_value) || !Number.isFinite(commission_percentage)) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const total_commission = calcTotalCommission(base_value, commission_percentage);

  const r = await db.run(
    `INSERT INTO sales(
      consultant_id, consultant_name, client_number, client_name, product, sale_date, insurance,
      base_value, quotas, unit_value, commission_percentage, total_commission, credit_generated
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      cid,
      consultant.name,
      body.client_number !== undefined && body.client_number !== null && String(body.client_number).trim() !== ''
        ? String(body.client_number).trim()
        : null,
      String(body.client_name).trim(),
      String(body.product).trim(),
      String(body.sale_date),
      body.insurance ? 1 : 0,
      base_value,
      quotasValuesFinal.length,
      quotasValuesFinal.length ? quotasValuesFinal[0] : 0,
      commission_percentage,
      total_commission,
      Number(body.credit_generated ?? 0)
    ]
  );

  await upsertQuotas(r.lastID, quotasValuesFinal);

  await upsertInstallments(r.lastID, total_commission, String(body.sale_date), body.installments);
  const created = await db.get('SELECT * FROM sales WHERE id=?', [r.lastID]);
  const its = await db.all('SELECT number,value,due_date,status,bill_overdue,paid_date FROM installments WHERE sale_id=? ORDER BY number', [r.lastID]);
  res.json({
    ...created,
    insurance: !!created.insurance,
    quotas_values: quotasValuesFinal,
    installments: its.map(it => ({
      ...it,
      bill_overdue: Number(it.bill_overdue || 0) ? 1 : 0,
      cancellation_phase: isCancellationPhaseInstallment(it)
    }))
  });
});

app.put('/api/sales/:id', auth(), async (req, res) => {
  const saleId = Number(req.params.id);
  const existing = await db.get('SELECT * FROM sales WHERE id=?', [saleId]);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { role, consultant_id } = req.user;
  if (role !== 'admin' && existing.consultant_id !== consultant_id) return res.status(403).json({ error: 'forbidden' });

  const body = req.body || {};

  // If quotas_values is provided, it becomes the source of truth for base_value.
  const newQuotasValues = normalizeQuotasValues(body.quotas_values);
  if (newQuotasValues) {
    await upsertQuotas(saleId, newQuotasValues);
  }

  const base_value = newQuotasValues
    ? newQuotasValues.reduce((a, v) => a + Number(v || 0), 0)
    : (body.base_value !== undefined ? Number(body.base_value) : existing.base_value);
  const commission_percentage = body.commission_percentage !== undefined ? Number(body.commission_percentage) : existing.commission_percentage;
  const total_commission = calcTotalCommission(base_value, commission_percentage);

  const oldTotalCommission = Number(existing.total_commission || 0);
  const hasInstallmentsPayload = Array.isArray(body.installments);
  const oldSaleDate = String(existing.sale_date);
  const nextSaleDate = body.sale_date !== undefined ? String(body.sale_date) : oldSaleDate;
  const saleDateChanged = body.sale_date !== undefined && String(body.sale_date) !== oldSaleDate;
  const commissionChanged = Math.abs(total_commission - oldTotalCommission) >= 0.005;
  const shouldAutoUpdateInstallments = !hasInstallmentsPayload && (commissionChanged || saleDateChanged);

  await db.run(
    `UPDATE sales SET
      client_number=?, client_name=?, product=?, sale_date=?, insurance=?,
      base_value=?, quotas=?, unit_value=?, commission_percentage=?, total_commission=?, credit_generated=?
    WHERE id=?`,
    [
      body.client_number !== undefined
        ? (body.client_number === null || String(body.client_number).trim() === '' ? null : String(body.client_number).trim())
        : existing.client_number,
      body.client_name !== undefined ? String(body.client_name).trim() : existing.client_name,
      body.product !== undefined ? String(body.product).trim() : existing.product,
      body.sale_date !== undefined ? String(body.sale_date) : existing.sale_date,
      body.insurance !== undefined ? (body.insurance ? 1 : 0) : existing.insurance,
      base_value,
      newQuotasValues ? newQuotasValues.length : (body.quotas !== undefined ? Number(body.quotas) : existing.quotas),
      newQuotasValues ? (newQuotasValues[0] ?? 0) : (body.unit_value !== undefined ? Number(body.unit_value) : existing.unit_value),
      commission_percentage,
      total_commission,
      body.credit_generated !== undefined ? Number(body.credit_generated) : existing.credit_generated,
      saleId
    ]
  );

  if (hasInstallmentsPayload) {
    await upsertInstallments(saleId, total_commission, body.sale_date ?? existing.sale_date, body.installments);
  }

  // If the sale total commission changed and installments weren't explicitly provided,
  // automatically rescale existing installments to match the new total_commission.
  if (shouldAutoUpdateInstallments) {
    const currentIts = await db.all(
      'SELECT number,value,due_date,status,bill_overdue,paid_date FROM installments WHERE sale_id=? ORDER BY number',
      [saleId]
    );

    if (currentIts.length) {
      const factor = oldTotalCommission > 0 ? (total_commission / oldTotalCommission) : null;
      let scaled = currentIts.map((it) => ({
        number: Number(it.number),
        value: Math.round(((Number(it.value || 0) * (factor ?? 0)) || 0) * 100) / 100,
        due_date: saleDateChanged ? addMonths(nextSaleDate, Number(it.number)) : String(it.due_date),
        status: it.status,
        bill_overdue: Number(it.bill_overdue || 0) ? 1 : 0,
        paid_date: it.paid_date ? String(it.paid_date) : null
      }));

      if (!factor) {
        const n = scaled.length || 1;
        const per = Math.round((total_commission / n) * 100) / 100;
        scaled = scaled.map((it) => ({ ...it, value: per }));
      }

      const sum = scaled.reduce((a, x) => a + Number(x.value || 0), 0);
      let diff = Math.round((total_commission - sum) * 100) / 100;
      for (let i = scaled.length - 1; i >= 0 && diff !== 0; i--) {
        const cur = Number(scaled[i].value || 0);
        const next = Math.round((cur + diff) * 100) / 100;
        if (next >= 0) {
          scaled[i].value = next;
          diff = 0;
        } else {
          scaled[i].value = 0;
          diff = Math.round((diff + cur) * 100) / 100;
        }
      }

      await upsertInstallments(saleId, total_commission, nextSaleDate, scaled);
    } else {
      await upsertInstallments(saleId, total_commission, nextSaleDate, null);
    }
  }

  const updated = await db.get('SELECT * FROM sales WHERE id=?', [saleId]);
  await ensureLegacyQuotasForSale(updated);
  const qs = await db.all('SELECT number,value FROM sale_quotas WHERE sale_id=? ORDER BY number', [saleId]);
  const its = await db.all('SELECT number,value,due_date,status,bill_overdue,paid_date FROM installments WHERE sale_id=? ORDER BY number', [saleId]);
  res.json({
    ...updated,
    insurance: !!updated.insurance,
    quotas_values: qs.map(x => x.value),
    installments: its.map(it => ({
      ...it,
      bill_overdue: Number(it.bill_overdue || 0) ? 1 : 0,
      cancellation_phase: isCancellationPhaseInstallment(it)
    }))
  });
});

app.delete('/api/sales/:id', auth(), async (req, res) => {
  const saleId = Number(req.params.id);
  const existing = await db.get('SELECT * FROM sales WHERE id=?', [saleId]);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { role, consultant_id } = req.user;
  if (role !== 'admin' && existing.consultant_id !== consultant_id) return res.status(403).json({ error: 'forbidden' });

  await db.run('DELETE FROM sales WHERE id=?', [saleId]);
  res.json({ ok: true });
});

// Update quotas (cotas) for a sale (values per quota)
app.put('/api/sales/:id/quotas', auth(), async (req, res) => {
  const saleId = Number(req.params.id);
  const existing = await db.get('SELECT * FROM sales WHERE id=?', [saleId]);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { role, consultant_id } = req.user;
  if (role !== 'admin' && existing.consultant_id !== consultant_id) return res.status(403).json({ error: 'forbidden' });

  const quotas_values = normalizeQuotasValues(req.body?.quotas_values);
  if (!quotas_values) return res.status(400).json({ error: 'missing_quotas_values' });

  const base_value = quotas_values.reduce((a, v) => a + Number(v || 0), 0);
  const commission_percentage = Number(existing.commission_percentage);
  const new_total_commission = calcTotalCommission(base_value, commission_percentage);

  // Persist quotas
  await upsertQuotas(saleId, quotas_values);

  // Keep installments coherent by scaling values to match the new total commission.
  const currentIts = await db.all('SELECT number,value,due_date,status,bill_overdue,paid_date FROM installments WHERE sale_id=? ORDER BY number', [saleId]);
  if (currentIts.length) {
    const oldTotal = Number(existing.total_commission || 0);
    const factor = oldTotal > 0 ? (new_total_commission / oldTotal) : 1;
    let scaled = currentIts.map(it => ({
      number: Number(it.number),
      value: Math.round((Number(it.value || 0) * factor) * 100) / 100,
      due_date: String(it.due_date),
      status: it.status,
      bill_overdue: Number(it.bill_overdue || 0) ? 1 : 0,
      paid_date: it.paid_date
    }));
    // rounding fix on last installment
    const sum = scaled.reduce((a, x) => a + x.value, 0);
    const diff = Math.round((new_total_commission - sum) * 100) / 100;
    if (diff !== 0 && scaled.length) {
      scaled[scaled.length - 1].value = Math.round((scaled[scaled.length - 1].value + diff) * 100) / 100;
    }
    await upsertInstallments(saleId, new_total_commission, existing.sale_date, scaled);
  }

  await db.run(
    'UPDATE sales SET base_value=?, quotas=?, unit_value=?, total_commission=? WHERE id=?',
    [base_value, quotas_values.length, quotas_values[0] ?? 0, new_total_commission, saleId]
  );

  const updated = await db.get('SELECT * FROM sales WHERE id=?', [saleId]);
  const its = await db.all('SELECT number,value,due_date,status,bill_overdue,paid_date FROM installments WHERE sale_id=? ORDER BY number', [saleId]);
  res.json({
    ...updated,
    insurance: !!updated.insurance,
    quotas_values,
    installments: its.map(it => ({
      ...it,
      bill_overdue: Number(it.bill_overdue || 0) ? 1 : 0,
      cancellation_phase: isCancellationPhaseInstallment(it)
    }))
  });
});

// Update installments for a sale
app.put('/api/sales/:id/installments', auth(), async (req, res) => {
  const saleId = Number(req.params.id);
  const existing = await db.get('SELECT * FROM sales WHERE id=?', [saleId]);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { role, consultant_id } = req.user;
  if (role !== 'admin' && existing.consultant_id !== consultant_id) return res.status(403).json({ error: 'forbidden' });

  const installments = req.body?.installments;
  if (!Array.isArray(installments)) return res.status(400).json({ error: 'missing_installments' });

  let finalInstallments = installments;
  if (role !== 'admin') {
    // Consultants can mark paid/pending but can't set "bill_overdue". Preserve existing flags.
    const existingIts = await db.all('SELECT number, bill_overdue FROM installments WHERE sale_id=?', [saleId]);
    const billMap = new Map(existingIts.map(x => [Number(x.number), Number(x.bill_overdue || 0) ? 1 : 0]));

    finalInstallments = installments.map((it) => {
      const n = Number(it.number);
      const isPaid = String(it.status || '') === 'paid' || !!it.paid_date;
      const existingBill = billMap.get(n) ? 1 : 0;
      return { ...it, bill_overdue: isPaid ? 0 : existingBill };
    });
  }

  await upsertInstallments(saleId, existing.total_commission, existing.sale_date, finalInstallments);
  const its = await db.all('SELECT number,value,due_date,status,bill_overdue,paid_date FROM installments WHERE sale_id=? ORDER BY number', [saleId]);
  res.json({
    ok: true,
    installments: its.map(it => ({
      ...it,
      bill_overdue: Number(it.bill_overdue || 0) ? 1 : 0,
      cancellation_phase: isCancellationPhaseInstallment(it)
    }))
  });
});

// =========================
// Summary (KPIs rápidos)
// =========================
function ymd(d) {
  return d.toISOString().slice(0, 10);
}
function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  return x;
}

function monthRange(monthStr) {
  // monthStr: YYYY-MM (ex: 2026-01)
  const m = String(monthStr || '').trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [yy, mm] = m.split('-').map(Number);
  // use UTC to avoid timezone shifting the day
  const start = new Date(Date.UTC(yy, mm - 1, 1));
  const end = new Date(Date.UTC(yy, mm, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

async function salesAggregate({ consultant_id, startDate, endDate }) {
  const where = [];
  const params = [];
  if (consultant_id != null) { where.push('consultant_id=?'); params.push(consultant_id); }
  if (startDate) { where.push('sale_date>=?'); params.push(startDate); }
  if (endDate) { where.push('sale_date<=?'); params.push(endDate); }
  const sql = `
    SELECT
      COUNT(*) as sales_count,
      COALESCE(SUM(base_value),0) as base_total,
      COALESCE(SUM(total_commission),0) as commission_total,
      COALESCE(SUM(credit_generated),0) as credit_total
    FROM sales
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  `;
  const r = await db.get(sql, params);
  return {
    sales_count: Number(r?.sales_count || 0),
    base_total: Number(r?.base_total || 0),
    commission_total: Number(r?.commission_total || 0),
    credit_total: Number(r?.credit_total || 0)
  };
}

async function installmentsAggregate({ consultant_id, today }) {
  const where = [];
  const params = [];
  if (consultant_id != null) { where.push('s.consultant_id=?'); params.push(consultant_id); }
  params.push(today, today);
  const sql = `
    SELECT
      SUM(CASE WHEN i.paid_date IS NOT NULL OR i.status='paid' THEN 1 ELSE 0 END) as paid_count,
      SUM(CASE WHEN i.paid_date IS NULL AND i.due_date < ? THEN 1 ELSE 0 END) as overdue_count,
      SUM(CASE WHEN i.paid_date IS NULL AND i.due_date >= ? THEN 1 ELSE 0 END) as pending_count
    FROM installments i
    JOIN sales s ON s.id = i.sale_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  `;
  const r = await db.get(sql, params);
  return {
    paid: Number(r?.paid_count || 0),
    overdue: Number(r?.overdue_count || 0),
    pending: Number(r?.pending_count || 0)
  };
}

app.get('/api/summary', auth(), async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const cid = isAdmin ? null : req.user.consultant_id;

  const now = new Date();
  const today = ymd(now);
  const last7 = ymd(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const monthStart = ymd(startOfMonth(now));

  const [sToday, s7, sMonth, sAll] = await Promise.all([
    salesAggregate({ consultant_id: cid, startDate: today, endDate: today }),
    salesAggregate({ consultant_id: cid, startDate: last7, endDate: today }),
    salesAggregate({ consultant_id: cid, startDate: monthStart, endDate: today }),
    salesAggregate({ consultant_id: cid })
  ]);

  const inst = await installmentsAggregate({ consultant_id: cid, today });

  res.json({
    today: { ...sToday },
    last7: { ...s7 },
    month: { ...sMonth },
    all: { ...sAll },
    installments: inst,
    as_of: today
  });
});

// =========================
// Recebimentos por mês (parcelas que vencem no mês)
// =========================
// Exemplo: GET /api/recebimentos?month=2026-01
app.get('/api/recebimentos', auth(), async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  // Para consultor: sempre filtra pelo próprio consultant_id.
  // Para admin: pode filtrar por um consultant_id específico via querystring.
  let cid = isAdmin ? null : req.user.consultant_id;
  if (isAdmin) {
    const qCidRaw = req.query.consultant_id;
    if (qCidRaw !== undefined && qCidRaw !== null && String(qCidRaw).trim() !== '') {
      const qCid = Number(qCidRaw);
      if (!Number.isFinite(qCid) || qCid <= 0) return res.status(400).json({ error: 'invalid_consultant_id' });
      cid = qCid;
    }
  }

  const month = String(req.query.month || '').trim();
  const r = monthRange(month);
  if (!r) return res.status(400).json({ error: 'invalid_month' });

  const where = [];
  const params = [];
  if (cid != null) { where.push('s.consultant_id=?'); params.push(cid); }
  where.push('i.due_date >= ?');
  where.push('i.due_date < ?');
  params.push(r.start, r.end);

  const rows = await db.all(
    `SELECT
        i.sale_id,
        i.number AS installment_number,
        i.value,
        i.due_date,
        i.status,
         i.bill_overdue,
         i.paid_date,
         s.sale_date,
         s.client_number,
         s.client_name,
         s.product,
         s.consultant_name
      FROM installments i
      JOIN sales s ON s.id = i.sale_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY i.due_date ASC, s.sale_date ASC, i.sale_id ASC, i.number ASC`,
    params
  );

  const total = rows.reduce((acc, x) => {
    const value = Number(x.value || 0);
    const billOverdue = Number(x.bill_overdue || 0) ? 1 : 0;
    const isPaid = String(x.status || '') === 'paid' || !!x.paid_date;
    // Se está marcado como "boleto atrasado" e NÃO está pago, não soma no total do mês
    if (billOverdue && !isPaid) return acc;
    return acc + value;
  }, 0);

  res.json({
    month,
    range: r,
    count: rows.length,
    total: Math.round(total * 100) / 100,
    installments: rows.map(x => ({
      sale_id: Number(x.sale_id),
      installment_number: Number(x.installment_number),
      value: Number(x.value),
      due_date: x.due_date,
      status: x.status,
      bill_overdue: Number(x.bill_overdue || 0) ? 1 : 0,
      cancellation_phase: isCancellationPhaseInstallment(x),
       paid_date: x.paid_date,
       sale_date: x.sale_date,
       client_number: x.client_number,
       client_name: x.client_name,
       product: x.product,
       consultant_name: x.consultant_name
     }))
   });
 });

// =========================
// Import Excel (.xlsx)
// =========================
function normalizeSheetName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function cellToString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    // exceljs may return { text } or { richText: [{ text }] }
    if (typeof v.text === 'string') return v.text;
    if (Array.isArray(v.richText)) return v.richText.map(x => x?.text || '').join('');
    if (typeof v.result !== 'undefined') return cellToString(v.result);
  }
  return String(v);
}

function normalizeHeader(s) {
  return normalizeSheetName(s).replace(/\s+/g, ' ').trim();
}

function buildHeaderIndex(ws) {
  const headerRow = ws.getRow(1);
  const idx = new Map();
  for (let c = 1; c <= headerRow.cellCount; c++) {
    const key = normalizeHeader(cellToString(headerRow.getCell(c).value));
    if (!key) continue;
    if (!idx.has(key)) idx.set(key, c);
  }
  return idx;
}

function pickCol(idx, names) {
  for (const n of names) {
    const k = normalizeHeader(n);
    if (idx.has(k)) return idx.get(k);
  }
  return null;
}

function parseMaybeNumber(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return NaN;
  const raw = String(v).trim();
  if (!raw) return NaN;
  // supports "R$ 1.234,56" and "1234.56"
  const cleaned = raw.replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!cleaned) return NaN;
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function toIsoDateOrNull(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Excel serial date (best-effort)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function parseYesNo(v) {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number(v) === 1;
  const s = String(v).trim().toLowerCase();
  return s === 'sim' || s === 's' || s === 'yes' || s === 'y' || s === '1' || s === 'true';
}

function normalizeInstallmentStatus(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'paid' || s === 'pago') return 'paid';
  if (s === 'overdue' || s === 'atrasado') return 'overdue';
  if (s === 'pending' || s === 'pendente') return 'pending';
  return 'pending';
}

function buildQuotasValuesFromBase(baseValue, quotasCount) {
  const q = Math.max(1, Math.min(50, Number(quotasCount || 1)));
  const baseCents = Math.round(Number(baseValue || 0) * 100);
  const each = Math.floor(baseCents / q);
  const rem = baseCents - (each * q);
  const values = Array.from({ length: q }, (_, i) => (each + (i < rem ? 1 : 0)) / 100);
  return values.map(v2 => Math.round(v2 * 100) / 100);
}

app.post(
  '/api/import/xlsx',
  auth('admin'),
  express.raw({
    type: () => true,
    limit: '20mb'
  }),
  async (req, res) => {
    try {
      const mode = (req.query.mode || 'insert').toString(); // insert (default) | skip

      if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'missing_file' });
      }

      let wb;
      try {
        wb = new ExcelJS.Workbook();
        await wb.xlsx.load(req.body);
      } catch {
        return res.status(400).json({ error: 'invalid_xlsx' });
      }

      const wsSales =
        wb.worksheets.find(w => normalizeSheetName(w.name) === 'vendas') ||
        wb.worksheets.find(w => normalizeSheetName(w.name) === 'sales') ||
        (wb.worksheets.length === 1 ? wb.worksheets[0] : null);
      if (!wsSales) {
        return res.status(400).json({ error: 'missing_sheet_vendas', sheets: wb.worksheets.map(w => w.name) });
      }

      const wsInst =
        wb.worksheets.find(w => normalizeSheetName(w.name) === 'parcelas') ||
        wb.worksheets.find(w => normalizeSheetName(w.name) === 'installments') ||
        null;

      const salesHeader = buildHeaderIndex(wsSales);
      const salesCols = {
        sale_date: pickCol(salesHeader, ['data', 'data venda', 'sale_date']),
        consultant_name: pickCol(salesHeader, ['consultor', 'consultant', 'consultant_name']),
        client_number: pickCol(salesHeader, [
          'nº cliente',
          'numero do cliente',
          'número do cliente',
          'cliente nº',
          'cliente numero',
          'client_number',
          'client number',
          'client no'
        ]),
        client_name: pickCol(salesHeader, ['cliente', 'client', 'client_name']),
        product: pickCol(salesHeader, ['produto', 'product']),
        base_value: pickCol(salesHeader, ['base (r$)', 'base', 'base_value']),
        commission_percentage: pickCol(salesHeader, ['comissão %', 'comissao %', 'commission_percentage']),
        credit_generated: pickCol(salesHeader, ['crédito gerado (r$)', 'credito gerado (r$)', 'credit_generated']),
        insurance: pickCol(salesHeader, ['seguro', 'insurance']),
        quotas: pickCol(salesHeader, ['cotas', 'quotas']),
        old_sale_id: pickCol(salesHeader, ['venda id', 'sale id', 'id'])
      };

      const hasSalesHeaders =
        salesCols.sale_date && salesCols.consultant_name && salesCols.client_name && salesCols.product;
      if (!hasSalesHeaders) {
        return res.status(400).json({
          error: 'missing_headers_vendas',
          sheet: wsSales.name,
          headers: [...salesHeader.keys()].slice(0, 40)
        });
      }

      const installmentsByOldSaleId = new Map();
      if (wsInst) {
        const instHeader = buildHeaderIndex(wsInst);
        const instCols = {
          old_sale_id: pickCol(instHeader, ['venda id', 'sale_id', 'sale id']),
          number: pickCol(instHeader, ['parcela nº', 'parcela n', 'parcela', 'number']),
          value: pickCol(instHeader, ['valor (r$)', 'valor', 'value']),
          due_date: pickCol(instHeader, ['vencimento', 'due_date', 'due date']),
          status: pickCol(instHeader, ['status']),
          bill_overdue: pickCol(instHeader, ['boleto atrasado', 'bill_overdue']),
          paid_date: pickCol(instHeader, ['pago em', 'paid_date', 'paid date'])
        };

        for (let r = 2; r <= wsInst.rowCount; r++) {
          const row = wsInst.getRow(r);
          const oldSaleId = Number(parseMaybeNumber(row.getCell(instCols.old_sale_id || 1).value));
          if (!oldSaleId) continue;

          const number = Number(parseMaybeNumber(row.getCell(instCols.number || 6).value));
          const value = parseMaybeNumber(row.getCell(instCols.value || 7).value);
          const due_date = toIsoDateOrNull(row.getCell(instCols.due_date || 8).value);
          const status = normalizeInstallmentStatus(row.getCell(instCols.status || 9).value);
          const bill_overdue = parseYesNo(row.getCell(instCols.bill_overdue || 10).value) ? 1 : 0;
          const paid_date = toIsoDateOrNull(row.getCell(instCols.paid_date || 11).value);

          if (!number || !Number.isFinite(value) || !due_date) continue;

          const list = installmentsByOldSaleId.get(oldSaleId) || [];
          list.push({ number, value, due_date, status, bill_overdue, paid_date });
          installmentsByOldSaleId.set(oldSaleId, list);
        }

        for (const list of installmentsByOldSaleId.values()) {
          list.sort((a, b) => a.number - b.number);
        }
      }

      let createdSales = 0;
      let skippedSales = 0;
      let createdConsultants = 0;
      const errors = [];

      try {
        await db.exec('BEGIN');
        for (let r = 2; r <= wsSales.rowCount; r++) {
          const row = wsSales.getRow(r);

          const sale_date = toIsoDateOrNull(row.getCell(salesCols.sale_date).value);
          const consultant_name = String(row.getCell(salesCols.consultant_name).value || '').trim();
          const client_number = salesCols.client_number ? String(row.getCell(salesCols.client_number).value || '').trim() : '';
          const client_name = String(row.getCell(salesCols.client_name).value || '').trim();
          const product = String(row.getCell(salesCols.product).value || '').trim();
          const base_value = parseMaybeNumber(row.getCell(salesCols.base_value).value);
          const commission_percentage = parseMaybeNumber(row.getCell(salesCols.commission_percentage).value);
          const credit_generated = salesCols.credit_generated ? parseMaybeNumber(row.getCell(salesCols.credit_generated).value) : NaN;
          const insurance = salesCols.insurance ? (parseYesNo(row.getCell(salesCols.insurance).value) ? 1 : 0) : 0;
          const quotas = salesCols.quotas ? Number(parseMaybeNumber(row.getCell(salesCols.quotas).value)) : 1;
          const oldSaleId = salesCols.old_sale_id ? Number(parseMaybeNumber(row.getCell(salesCols.old_sale_id).value)) : NaN;

          const looksEmpty = !sale_date && !consultant_name && !client_name && !product;
          if (looksEmpty) continue;

          if (!sale_date || !consultant_name || !client_name || !product || !Number.isFinite(base_value) || !Number.isFinite(commission_percentage)) {
            errors.push({ row: r, error: 'missing_fields' });
            continue;
          }

          let consultant = await db.get('SELECT * FROM consultants WHERE LOWER(name)=LOWER(?) LIMIT 1', [consultant_name]);
          if (!consultant) {
            const rr = await db.run('INSERT INTO consultants(name,email,active) VALUES(?,?,1)', [consultant_name, null]);
            consultant = await db.get('SELECT * FROM consultants WHERE id=?', [rr.lastID]);
            createdConsultants += 1;
          }

          if (mode === 'skip') {
            const existing = await db.get(
              `SELECT id FROM sales
               WHERE consultant_id=? AND sale_date=? AND client_name=? AND product=? AND ABS(base_value-?) < 0.01
               LIMIT 1`,
              [consultant.id, sale_date, client_name, product, base_value]
            );
            if (existing) {
              skippedSales += 1;
              continue;
            }
          }

          const quotas_values = buildQuotasValuesFromBase(base_value, quotas);
          const total_commission = calcTotalCommission(base_value, commission_percentage);

          const insert = await db.run(
            `INSERT INTO sales(
              consultant_id, consultant_name, client_number, client_name, product, sale_date, insurance,
              base_value, quotas, unit_value, commission_percentage, total_commission, credit_generated
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              consultant.id,
              consultant.name,
              client_number ? client_number : null,
              client_name,
              product,
              sale_date,
              insurance,
              base_value,
              quotas_values.length,
              quotas_values.length ? quotas_values[0] : 0,
              commission_percentage,
              total_commission,
              Number.isFinite(credit_generated) ? credit_generated : 0
            ]
          );

          await upsertQuotas(insert.lastID, quotas_values);

          const inst = oldSaleId && installmentsByOldSaleId.has(oldSaleId)
            ? installmentsByOldSaleId.get(oldSaleId)
            : null;
          await upsertInstallments(insert.lastID, total_commission, sale_date, inst);

          createdSales += 1;
        }

        await db.exec('COMMIT');
      } catch (e) {
        try { await db.exec('ROLLBACK'); } catch {}
        console.error('Import xlsx failed (tx):', e);
        return res.status(500).json({ error: 'import_failed' });
      }

      return res.json({
        ok: true,
        createdSales,
        skippedSales,
        createdConsultants,
        detected: {
          salesSheet: wsSales.name,
          installmentsSheet: wsInst ? wsInst.name : null
        },
        errors: errors.slice(0, 50)
      });
    } catch (e) {
      console.error('Import xlsx failed:', e);
      return res.status(500).json({ error: 'import_failed' });
    }
  }
);

// =========================
// Export Excel (.xlsx)
// =========================
app.get('/api/export/xlsx', auth(), async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const scope = (req.query.scope || 'me').toString();
  const effectiveScope = (isAdmin && scope === 'all') ? 'all' : 'me';

  const salesRows = effectiveScope === 'all'
    ? await db.all(`SELECT * FROM sales ORDER BY sale_date DESC, id DESC`)
    : await db.all(`SELECT * FROM sales WHERE consultant_id=? ORDER BY sale_date DESC, id DESC`, [req.user.consultant_id]);

  const saleIds = salesRows.map(r => r.id);
  const instRows = saleIds.length
    ? await db.all(
        `SELECT i.*, s.consultant_name, s.client_number, s.client_name, s.product, s.sale_date
         FROM installments i
         JOIN sales s ON s.id=i.sale_id
         WHERE i.sale_id IN (${saleIds.map(() => '?').join(',')})
         ORDER BY i.sale_id, i.number`,
        saleIds
      )
    : [];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dashboard de Comissões';
  wb.created = new Date();

  // Sheet 1: Vendas
  const ws1 = wb.addWorksheet('Vendas');
  ws1.columns = [
    { header: 'Data', key: 'sale_date', width: 12 },
    { header: 'Consultor', key: 'consultant_name', width: 18 },
    { header: 'Cliente', key: 'client_name', width: 26 },
    { header: 'Nº Cliente', key: 'client_number', width: 14 },
    { header: 'Produto', key: 'product', width: 14 },
    { header: 'Base (R$)', key: 'base_value', width: 14 },
    { header: 'Comissão %', key: 'commission_percentage', width: 12 },
    { header: 'Comissão (R$)', key: 'total_commission', width: 14 },
    { header: 'Crédito gerado (R$)', key: 'credit_generated', width: 18 },
    { header: 'Seguro', key: 'insurance', width: 10 },
    { header: 'Cotas', key: 'quotas', width: 8 },
    { header: 'Valor unit (R$)', key: 'unit_value', width: 14 },
    { header: 'Venda ID', key: 'id', width: 10 }
  ];
  ws1.getRow(1).font = { bold: true };
  ws1.autoFilter = `A1:M1`;

  salesRows.forEach(r => {
    ws1.addRow({
      ...r,
      insurance: r.insurance ? 'Sim' : 'Não'
    });
  });

  // formatos
  ['F', 'H', 'I', 'L'].forEach(col => ws1.getColumn(col).numFmt = '"R$" #,##0.00');
  ws1.getColumn('G').numFmt = '0.00';

  // Sheet 2: Parcelas
  const ws2 = wb.addWorksheet('Parcelas');
  ws2.columns = [
    { header: 'Venda ID', key: 'sale_id', width: 10 },
    { header: 'Data venda', key: 'sale_date', width: 12 },
    { header: 'Consultor', key: 'consultant_name', width: 18 },
    { header: 'Cliente', key: 'client_name', width: 26 },
    { header: 'Nº Cliente', key: 'client_number', width: 14 },
    { header: 'Produto', key: 'product', width: 14 },
    { header: 'Parcela nº', key: 'number', width: 10 },
    { header: 'Valor (R$)', key: 'value', width: 14 },
    { header: 'Vencimento', key: 'due_date', width: 12 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Boleto atrasado', key: 'bill_overdue', width: 15 },
    { header: 'Pago em', key: 'paid_date', width: 12 }
  ];
  ws2.getRow(1).font = { bold: true };
  ws2.autoFilter = `A1:L1`;

  instRows.forEach(r => ws2.addRow(r));
  ws2.getColumn('H').numFmt = '"R$" #,##0.00';

  const filename = `export-${effectiveScope}-${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  await wb.xlsx.write(res);
  res.end();
});

// ---- Serve client (SEMPRE POR ÚLTIMO)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

await initDb();
app.listen(PORT, () => console.log(`🚀 Server on :${PORT}`));
