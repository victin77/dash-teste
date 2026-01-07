import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getDbFile() {
  // Render: mount a persistent disk at /data to keep the SQLite file between deploys.
  const preferredDir = process.env.DB_DIR || (fs.existsSync('/data') ? '/data' : __dirname);
  return path.join(preferredDir, process.env.DB_FILE || 'data.sqlite');
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const CONSULTANT_DEFAULT_PASSWORD = process.env.CONSULTANT_DEFAULT_PASSWORD || 'consultor';


// Per-consultant passwords (optional)
// 1) You can provide JSON via env CONSULTANT_PASSWORDS, e.g.:
//    {"azurdin":"Azurdin@21","vitor":"Vitor@32"}
// 2) If not provided, we fall back to a simple default mapping below.
// NOTE: Passwords are hashed in DB; changing this mapping updates existing consultant hashes (no data loss).
let CONSULTANT_PASSWORDS = {};
try {
  CONSULTANT_PASSWORDS = process.env.CONSULTANT_PASSWORDS ? JSON.parse(process.env.CONSULTANT_PASSWORDS) : {};
} catch (e) {
  console.warn("⚠️ CONSULTANT_PASSWORDS inválido (JSON). Ignorando e usando padrão.");
  CONSULTANT_PASSWORDS = {};
}

const DEFAULT_CONSULTANT_PASSWORDS = {
  victor: "victor@32",
  poli: "poli@45",
  marcelo: "marcelo@18",
  pedro: "pedro@27",
  gustavo: "gustavo@39",
  graziele: "grazi@14"
};

function getConsultantPassword(username) {
  return (
    (CONSULTANT_PASSWORDS && CONSULTANT_PASSWORDS[username]) ||
    DEFAULT_CONSULTANT_PASSWORDS[username] ||
    CONSULTANT_DEFAULT_PASSWORD
  );
}
const DEFAULT_CONSULTANTS = [
  'Graziele',
  'Gustavo',
  'Pedro',
  'Poli',
  'Marcelo',
  'Victor'
];

let db;

async function initDb() {
  db = await open({
    filename: getDbFile(),
    driver: sqlite3.Database
  });

  await db.exec(`
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
    const username = slugify(c.name);
    const u = await db.get('SELECT id FROM users WHERE username=?', [username]);
    const pwd = getConsultantPassword(username);

    if (!u) {
      const hash = await bcrypt.hash(pwd, 10);
      await db.run(
        'INSERT INTO users(username,password_hash,role,consultant_id) VALUES(?,?,?,?)',
        [username, hash, 'consultant', c.id]
      );
      console.log(`✅ Consultor criado: ${c.name} (${username})`);
    } else {
      // Keep users in sync if per-consultant password mapping is provided (no data loss).
      // This lets you change passwords via env without recreating the DB.
      const shouldSync = (CONSULTANT_PASSWORDS && Object.prototype.hasOwnProperty.call(CONSULTANT_PASSWORDS, username)) ||
                         Object.prototype.hasOwnProperty.call(DEFAULT_CONSULTANT_PASSWORDS, username);

      if (shouldSync) {
        const hash = await bcrypt.hash(pwd, 10);
        await db.run('UPDATE users SET password_hash=? WHERE username=?', [hash, username]);
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
      paid_date: it.paid_date ? String(it.paid_date) : null
    }));
  }

  await db.run('DELETE FROM installments WHERE sale_id=?', [saleId]);
  for (const it of installments) {
    await db.run(
      'INSERT INTO installments(sale_id, number, value, due_date, status, paid_date) VALUES(?,?,?,?,?,?)',
      [saleId, it.number, it.value, it.due_date, it.status, it.paid_date]
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

  const user = await db.get('SELECT * FROM users WHERE username=?', [String(username).trim()]);
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
  const rows = await db.all('SELECT id, name FROM consultants WHERE active=1 ORDER BY name');
  res.json(rows);
});

// ---- Admin: Consultants & consultant users
app.get('/api/consultants', auth(), async (req, res) => {
  const rows = await db.all('SELECT id, name, email, active FROM consultants ORDER BY name');
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
  const created = await db.get('SELECT id, name, email, active FROM consultants WHERE id=?', [r.lastID]);
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

  const updated = await db.get('SELECT id, name, email, active FROM consultants WHERE id=?', [id]);
  res.json(updated);
});

app.post('/api/consultants/:id/create-login', auth('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const consultant = await db.get('SELECT * FROM consultants WHERE id=?', [id]);
  if (!consultant) return res.status(404).json({ error: 'not_found' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });

  const hash = await bcrypt.hash(String(password), 10);
  try {
    await db.run(
      'INSERT INTO users(username,password_hash,role,consultant_id) VALUES(?,?,?,?)',
      [String(username).trim(), hash, 'consultant', id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'username_taken' });
  }
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
      consultant_id, consultant_name, client_name, product, sale_date, insurance,
      base_value, quotas, unit_value, commission_percentage, total_commission, credit_generated
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      cid,
      consultant.name,
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
  const its = await db.all('SELECT number,value,due_date,status,paid_date FROM installments WHERE sale_id=? ORDER BY number', [r.lastID]);
  res.json({ ...created, insurance: !!created.insurance, quotas_values: quotasValuesFinal, installments: its });
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

  await db.run(
    `UPDATE sales SET
      client_name=?, product=?, sale_date=?, insurance=?,
      base_value=?, quotas=?, unit_value=?, commission_percentage=?, total_commission=?, credit_generated=?
    WHERE id=?`,
    [
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

  if (body.installments) {
    await upsertInstallments(saleId, total_commission, body.sale_date ?? existing.sale_date, body.installments);
  }

  const updated = await db.get('SELECT * FROM sales WHERE id=?', [saleId]);
  await ensureLegacyQuotasForSale(updated);
  const qs = await db.all('SELECT number,value FROM sale_quotas WHERE sale_id=? ORDER BY number', [saleId]);
  const its = await db.all('SELECT number,value,due_date,status,paid_date FROM installments WHERE sale_id=? ORDER BY number', [saleId]);
  res.json({ ...updated, insurance: !!updated.insurance, quotas_values: qs.map(x => x.value), installments: its });
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
  const currentIts = await db.all('SELECT number,value,due_date,status,paid_date FROM installments WHERE sale_id=? ORDER BY number', [saleId]);
  if (currentIts.length) {
    const oldTotal = Number(existing.total_commission || 0);
    const factor = oldTotal > 0 ? (new_total_commission / oldTotal) : 1;
    let scaled = currentIts.map(it => ({
      number: Number(it.number),
      value: Math.round((Number(it.value || 0) * factor) * 100) / 100,
      due_date: String(it.due_date),
      status: it.status,
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
  const its = await db.all('SELECT number,value,due_date,status,paid_date FROM installments WHERE sale_id=? ORDER BY number', [saleId]);
  res.json({
    ...updated,
    insurance: !!updated.insurance,
    quotas_values,
    installments: its
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

  await upsertInstallments(saleId, existing.total_commission, existing.sale_date, installments);
  const its = await db.all('SELECT number,value,due_date,status,paid_date FROM installments WHERE sale_id=? ORDER BY number', [saleId]);
  res.json({ ok: true, installments: its });
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
  return db.get(sql, params);
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

  const [sToday, s7, sMonth, sAll, instAgg] = await Promise.all([
    salesAggregate({ consultant_id: cid, startDate: today, endDate: today }),
    salesAggregate({ consultant_id: cid, startDate: last7, endDate: today }),
    salesAggregate({ consultant_id: cid, startDate: monthStart, endDate: today }),
    salesAggregate({ consultant_id: cid }),
    installmentsAggregate({ consultant_id: cid, today })
  ]);

  // ✅ Garantia de contagem (fallback) caso installmentsAggregate não esteja trazendo pending/overdue
  // ou esteja retornando campos com nomes diferentes.
  let pending = 0;
  let overdue = 0;
  let paid = 0;

  // Tenta usar o agregado existente primeiro (sem quebrar compatibilidade)
  if (instAgg && typeof instAgg === 'object') {
    // formatos possíveis: { pending, overdue, paid } ou { pendentes, atrasadas, pagas } etc.
    pending = Number(instAgg.pending ?? instAgg.pendente ?? instAgg.pendentes ?? 0);
    overdue  = Number(instAgg.overdue ?? instAgg.atrasada ?? instAgg.atrasadas ?? 0);
    paid     = Number(instAgg.paid ?? instAgg.paga ?? instAgg.pagas ?? 0);
  }

  // Se veio tudo zerado, recalcula lendo as parcelas direto (aí não tem erro)
  if ((pending + overdue + paid) === 0) {
    // espera-se que exista uma função que liste parcelas; se no seu arquivo ela tiver outro nome,
    // troque aqui pelo nome correto (ex.: listInstallments / getInstallments / allInstallments)
    const allInstallments = await listInstallments();

    const visible = isAdmin
      ? allInstallments
      : allInstallments.filter(i => i.consultant_id === cid);

    pending = visible.filter(i => i.status === 'pendente').length;
    overdue = visible.filter(i => i.status === 'atrasada').length;
    paid    = visible.filter(i => i.status === 'paga').length;
  }

  const installments = {
    // mantém os outros campos do agregado se existirem (ex.: total_value, next_due, etc.)
    ...(instAgg && typeof instAgg === 'object' ? instAgg : {}),
    pending,
    overdue,
    paid
  };

  res.json({
    today: { ...sToday },
    last7: { ...s7 },
    month: { ...sMonth },
    all: { ...sAll },
    installments, inst,
    as_of: today
  });
});


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
app.get('/api/summary', auth(), async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const cid = isAdmin ? null : req.user.consultant_id;

  const now = new Date();
  const today = ymd(now);
  const last7 = ymd(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const monthStart = ymd(startOfMonth(now));

  const [sToday, s7, sMonth, sAll, instAgg] = await Promise.all([
    salesAggregate({ consultant_id: cid, startDate: today, endDate: today }),
    salesAggregate({ consultant_id: cid, startDate: last7, endDate: today }),
    salesAggregate({ consultant_id: cid, startDate: monthStart, endDate: today }),
    salesAggregate({ consultant_id: cid }),
    installmentsAggregate({ consultant_id: cid, today })
  ]);

  // ✅ Garantia de contagem (fallback) caso installmentsAggregate não esteja trazendo pending/overdue
  // ou esteja retornando campos com nomes diferentes.
  let pending = 0;
  let overdue = 0;
  let paid = 0;

  // Tenta usar o agregado existente primeiro (sem quebrar compatibilidade)
  if (instAgg && typeof instAgg === 'object') {
    // formatos possíveis: { pending, overdue, paid } ou { pendentes, atrasadas, pagas } etc.
    pending = Number(instAgg.pending ?? instAgg.pendente ?? instAgg.pendentes ?? 0);
    overdue  = Number(instAgg.overdue ?? instAgg.atrasada ?? instAgg.atrasadas ?? 0);
    paid     = Number(instAgg.paid ?? instAgg.paga ?? instAgg.pagas ?? 0);
  }

  // Se veio tudo zerado, recalcula lendo as parcelas direto (aí não tem erro)
  if ((pending + overdue + paid) === 0) {
    // espera-se que exista uma função que liste parcelas; se no seu arquivo ela tiver outro nome,
    // troque aqui pelo nome correto (ex.: listInstallments / getInstallments / allInstallments)
    const allInstallments = await listInstallments();

    const visible = isAdmin
      ? allInstallments
      : allInstallments.filter(i => i.consultant_id === cid);

    pending = visible.filter(i => i.status === 'pendente').length;
    overdue = visible.filter(i => i.status === 'atrasada').length;
    paid    = visible.filter(i => i.status === 'paga').length;
  }

  const installments = {
    // mantém os outros campos do agregado se existirem (ex.: total_value, next_due, etc.)
    ...(instAgg && typeof instAgg === 'object' ? instAgg : {}),
    pending,
    overdue,
    paid
  };

  res.json({
    today: { ...sToday },
    last7: { ...s7 },
    month: { ...sMonth },
    all: { ...sAll },
    installments,
    as_of: today
  });
});

  const saleIds = salesRows.map(r => r.id);
  const instRows = saleIds.length
    ? await db.all(
        `SELECT i.*, s.consultant_name, s.client_name, s.product, s.sale_date
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
    { header: 'Produto', key: 'product', width: 14 },
    { header: 'Base (R$)', key: 'base_value', width: 14 },
    { header: 'Comissão %', key: 'commission_percentage', width: 12 },
    { header: 'Comissão (R$)', key: 'total_commission', width: 14 },
    { header: 'Crédito gerado (R$)', key: 'credit_generated', width: 18 },
    { header: 'Seguro', key: 'insurance', width: 10 },
    { header: 'Cotas', key: 'quotas', width: 8 },
    { header: 'Valor unit (R$)', key: 'unit_value', width: 14 }
  ];
  ws1.getRow(1).font = { bold: true };
  ws1.autoFilter = `A1:K1`;

  salesRows.forEach(r => {
    ws1.addRow({
      ...r,
      insurance: r.insurance ? 'Sim' : 'Não'
    });
  });

  // formatos
  ['E', 'G', 'H', 'K'].forEach(col => ws1.getColumn(col).numFmt = '"R$" #,##0.00');
  ws1.getColumn('F').numFmt = '0.00';

  // Sheet 2: Parcelas
  const ws2 = wb.addWorksheet('Parcelas');
  ws2.columns = [
    { header: 'Venda ID', key: 'sale_id', width: 10 },
    { header: 'Data venda', key: 'sale_date', width: 12 },
    { header: 'Consultor', key: 'consultant_name', width: 18 },
    { header: 'Cliente', key: 'client_name', width: 26 },
    { header: 'Produto', key: 'product', width: 14 },
    { header: 'Parcela nº', key: 'number', width: 10 },
    { header: 'Valor (R$)', key: 'value', width: 14 },
    { header: 'Vencimento', key: 'due_date', width: 12 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Pago em', key: 'paid_date', width: 12 }
  ];
  ws2.getRow(1).font = { bold: true };
  ws2.autoFilter = `A1:J1`;

  instRows.forEach(r => ws2.addRow(r));
  ws2.getColumn('G').numFmt = '"R$" #,##0.00';

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
