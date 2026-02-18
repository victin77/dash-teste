import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../api.js';
import { fmtBRL, fmtDate, statusLabel, todayIso } from '../utils.js';
import {
  Moon,
  Sun,
  LogOut,
  Plus,
  RefreshCw,
  Users,
  BarChart3,
  FileText,
  Settings2,
  KeyRound,
  Trash2,
  Pencil,
  Download,
  Upload,
  X
} from 'lucide-react';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

function Shell({ darkMode, children }) {
  return (
    <div
      className={`relative h-screen w-screen overflow-hidden transition-colors duration-500
        ${darkMode ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900"}`}>
      <div className={`pointer-events-none absolute inset-0 ${darkMode ? 'bg-grid-slate-dark' : 'bg-grid-slate'} opacity-100`} />
      <div className="pointer-events-none absolute inset-0 opacity-80 bg-[radial-gradient(900px_circle_at_15%_10%,rgba(59,130,246,0.18),transparent_45%),radial-gradient(1000px_circle_at_85%_20%,rgba(99,102,241,0.14),transparent_55%)]" />
      <div className="relative flex h-full w-full flex-col">
        {children}
      </div>
    </div>
  );
}


function Pill({ icon: Icon, label, value, tone='violet' }) {
  const map = {
    violet: 'from-violet-600 to-purple-600 shadow-violet-600/25',
    emerald: 'from-emerald-600 to-teal-600 shadow-emerald-600/25',
    cyan: 'from-cyan-600 to-blue-600 shadow-cyan-600/25',
    amber: 'from-amber-500 to-orange-600 shadow-amber-600/25',
    rose: 'from-rose-600 to-pink-600 shadow-rose-600/25'
  };
  return (
    <div className={`rounded-3xl p-5 bg-gradient-to-r ${map[tone]} shadow-xl`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-white/70">{label}</div>
          <div className="text-2xl font-bold text-white mt-1">{value}</div>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center">
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-violet-500/15 border border-violet-400/20 flex items-center justify-center">
          <Icon className="w-5 h-5 text-violet-300" />
        </div>
        <div>
          <div className="text-lg font-semibold">{title}</div>
          {subtitle && <div className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}

function Modal({ open, title, children, onClose, widthClass='max-w-3xl' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative w-full ${widthClass} rounded-3xl bg-white dark:bg-slate-950 border border-slate-200/60 dark:border-white/10 shadow-2xl overflow-hidden`}>
        <div className="px-6 py-5 border-b border-slate-200/60 dark:border-white/10 flex items-center justify-between">
          <div className="font-semibold">{title}</div>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center w-10 h-10 rounded-2xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/5"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange, type='text', placeholder, required }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}{required && <span className="text-rose-400">*</span>}</div>
      <input
        type={type}
        value={value}
        onChange={(e)=>onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
      />
    </div>
  );
}

function SelectInput({ label, value, onChange, options, required }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}{required && <span className="text-rose-400">*</span>}</div>
      <select
        value={value}
        onChange={(e)=>onChange(e.target.value)}
        className="w-full rounded-2xl bg-slate-50 dark:bg-white/5 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-white/10 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
      >
        <option value="" className="bg-white text-slate-500 dark:bg-slate-900 dark:text-slate-300">Selecione...</option>
        {options.map(o => <option key={o.value} value={o.value} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">{o.label}</option>)}
      </select>
    </div>
  );
}

function SaleForm({ open, onClose, onSave, consultants, user, editing }) {
  const isAdmin = user.role === 'admin';
  const [consultantId, setConsultantId] = useState(editing?.consultant_id ? String(editing.consultant_id) : '');
  const [clientNumber, setClientNumber] = useState(editing?.client_number || '');
  const [clientName, setClientName] = useState(editing?.client_name || '');
  const [product, setProduct] = useState(editing?.product || 'Imóvel');
  const [saleDate, setSaleDate] = useState(editing?.sale_date || todayIso());
  const [insurance, setInsurance] = useState(Boolean(editing?.insurance));
  const initialQuotasValues = useMemo(() => {
    if (Array.isArray(editing?.quotas_values) && editing.quotas_values.length) {
      return editing.quotas_values.map(v => Number(v) || 0);
    }
    const q = Math.max(1, Number(editing?.quotas ?? 1));
    const uv = Number(editing?.unit_value ?? 0);
    return Array.from({ length: q }, () => uv);
  }, [editing]);
  const [quotasValues, setQuotasValues] = useState(initialQuotasValues);
  const [commissionPct, setCommissionPct] = useState(editing?.commission_percentage ?? 0.8);
  const [creditGenerated, setCreditGenerated] = useState(editing?.credit_generated ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setConsultantId(editing?.consultant_id ? String(editing.consultant_id) : '');
    setClientNumber(editing?.client_number || '');
    setClientName(editing?.client_name || '');
    setProduct(editing?.product || 'Imóvel');
    setSaleDate(editing?.sale_date || todayIso());
    setInsurance(Boolean(editing?.insurance));
    setQuotasValues(initialQuotasValues);
    setCommissionPct(editing?.commission_percentage ?? 0.8);
    setCreditGenerated(editing?.credit_generated ?? 0);
  }, [open, editing]);

  const baseValue = useMemo(() => {
    return Math.round(quotasValues.reduce((a, v) => a + (Number(v) || 0), 0) * 100) / 100;
  }, [quotasValues]);

  const setQuotaCount = (n) => {
    const count = Math.max(1, Math.min(50, Number(n) || 1));
    setQuotasValues(prev => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push(0);
      return next;
    });
  };

  const setQuotaValue = (idx, val) => {
    const v = Number(val);
    setQuotasValues(prev => prev.map((x, i) => (i === idx ? (Number.isFinite(v) ? v : 0) : x)));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave({
        consultant_id: isAdmin ? Number(consultantId) : undefined,
        client_number: clientNumber,
        client_name: clientName,
        product,
        sale_date: saleDate,
        insurance,
        base_value: Number(baseValue),
        quotas_values: quotasValues.map(v => Number(v) || 0),
        commission_percentage: Number(commissionPct),
        credit_generated: Number(creditGenerated)
      });
      onClose();
    } catch (err) {
      setError('Confira os campos obrigatórios.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar venda' : 'Nova venda'} widthClass="max-w-4xl">
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isAdmin && (
            <SelectInput
              label="Consultor"
              required
              value={consultantId}
              onChange={setConsultantId}
              options={consultants.map(c=>({ value: String(c.id), label: c.name }))}
            />
          )}
          <TextInput label="Cliente" required value={clientName} onChange={setClientName} placeholder="Nome do cliente" />
          <TextInput label="Nº do cliente" value={clientNumber} onChange={setClientNumber} placeholder="Ex: 12345" />
          <SelectInput
            label="Produto"
            required
            value={product}
            onChange={setProduct}
            options={['Imóvel','Auto','Moto','Agro','Serviços'].map(x=>({ value:x, label:x }))}
          />
          <TextInput label="Data da venda" required type="date" value={saleDate} onChange={setSaleDate} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <div className="text-sm font-medium text-slate-600 dark:text-slate-300">Base (R$) <span className="text-xs text-slate-400">(soma das cotas)</span></div>
            <input
              type="text"
              value={fmtBRL(baseValue)}
              readOnly
              className="w-full rounded-2xl bg-slate-100/70 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-3 focus:outline-none"
            />
          </div>
          <TextInput label="% Comissão" required type="number" value={commissionPct} onChange={setCommissionPct} placeholder="Ex: 0.8" />
          <TextInput label="Qtd cotas" required type="number" value={quotasValues.length} onChange={setQuotaCount} />
        </div>

        <div className="rounded-3xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">Cotas (valores individuais)</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">O total da venda é a soma das cotas.</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {quotasValues.map((v, idx) => (
              <div key={idx} className="space-y-2">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-300">Cota {idx + 1}</div>
                <input
                  type="number"
                  value={v}
                  onChange={(e) => setQuotaValue(idx, e.target.value)}
                  className="w-full rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                  placeholder="0"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextInput label="Crédito gerado (R$)" type="number" value={creditGenerated} onChange={setCreditGenerated} />
          <div className="flex items-end">
            <label className="flex items-center gap-3 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-3 w-full">
              <input type="checkbox" checked={insurance} onChange={(e)=>setInsurance(e.target.checked)} />
              <span className="text-sm text-slate-700 dark:text-slate-200 font-medium">Com seguro</span>
            </label>
          </div>
        </div>

        {error && <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-200">{error}</div>}

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-3 rounded-2xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5">Cancelar</button>
          <button disabled={saving} className="px-5 py-3 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold shadow-lg shadow-violet-600/20 disabled:opacity-60">{saving ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* =========================
   HELPERS PARCELAS
========================= */

function isOverdue(due_date) {
  if (!due_date) return false;
  // comparando yyyy-mm-dd (string) funciona bem
  return String(due_date) < todayIso();
}

function normalizeInstallmentForUi(it) {
  // status "overdue" automático no front se estiver pendente e vencido
  const paid = it.status === 'paid' || !!it.paid_date;
  const billOverdue = Number(it.bill_overdue || 0) ? 1 : 0;
  const overdueAuto = !paid && isOverdue(it.due_date);
  const status = paid ? 'paid' : (overdueAuto ? 'overdue' : 'pending');
  return {
    number: Number(it.number),
    value: Number(it.value || 0),
    due_date: String(it.due_date),
    status,
    bill_overdue: billOverdue,
    paid_date: it.paid_date ? String(it.paid_date) : null
  };
}

function displayInstallmentStatus(it) {
  if (it.status === 'paid' || it.paid_date) return 'paid';
  if (Number(it.bill_overdue || 0)) return 'bill_overdue';
  return it.status || 'pending';
}

/* =========================
   HELPERS BUSCA VENDAS
========================= */
function normalizeSearchText(value) {
  return String(value ?? '')
    .replace(/,/g, '.')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9./\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function digitsOnly(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

function isNumericToken(value) {
  return /^\d+(?:[.,]\d+)?$/.test(String(value ?? '').trim());
}

function normalizeNumericToken(value) {
  const token = String(value ?? '').trim().replace(',', '.');
  if (!token) return '';
  if (/^\d+\.\d+$/.test(token)) {
    const [intPart, decPart] = token.split('.');
    const cleanDec = decPart.replace(/0+$/g, '');
    return cleanDec ? `${intPart}.${cleanDec}` : intPart;
  }
  return token;
}

function smallTypoMatch(a, b) {
  const maxDistance = a.length >= 7 ? 2 : 1;
  if (Math.abs(a.length - b.length) > maxDistance) return false;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDistance) return false;
    [prev, curr] = [curr, prev];
  }

  return prev[b.length] <= maxDistance;
}

function hasSingleAdjacentSwap(a, b) {
  if (a.length !== b.length || a.length < 4) return false;
  const diff = [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) diff.push(i);
    if (diff.length > 2) return false;
  }
  if (diff.length !== 2) return false;
  const [i, j] = diff;
  return j === i + 1 && a[i] === b[j] && a[j] === b[i];
}

function tokenMatches(queryToken, candidateToken) {
  if (!queryToken || !candidateToken) return false;
  if (candidateToken.includes(queryToken)) return true;

  const numericToken = isNumericToken(queryToken) || isNumericToken(candidateToken);
  if (numericToken) {
    const queryNorm = normalizeNumericToken(queryToken);
    const candidateNorm = normalizeNumericToken(candidateToken);
    if (queryNorm && candidateNorm && queryNorm === candidateNorm) return true;

    const queryDigits = digitsOnly(queryToken);
    const candidateDigits = digitsOnly(candidateToken);
    if (queryDigits.length >= 4 && candidateDigits.includes(queryDigits)) return true;
    return false;
  }

  if (hasSingleAdjacentSwap(queryToken, candidateToken)) return true;
  if (queryToken.length < 4 || candidateToken.length < 4) return false;
  return smallTypoMatch(queryToken, candidateToken);
}

function buildSaleSearchDoc(sale) {
  const installments = Array.isArray(sale.installments) ? sale.installments : [];
  const today = todayIso();

  let hasPaid = false;
  let hasPending = false;
  let hasOverdue = false;
  let hasBillOverdue = false;
  let hasCancelPhase = false;

  for (const it of installments) {
    const paid = String(it.status || '') === 'paid' || !!it.paid_date;
    if (paid) {
      hasPaid = true;
      continue;
    }

    const billOverdue = Number(it.bill_overdue || 0) === 1;
    const due = String(it.due_date || '').slice(0, 10);
    const overdueAuto = String(it.status || '') === 'overdue' || (Boolean(due) && due < today);
    const pending = !billOverdue && !overdueAuto;

    if (billOverdue) hasBillOverdue = true;
    if (overdueAuto || billOverdue) hasOverdue = true;
    if (pending) hasPending = true;
    if (Number(it.cancellation_phase || 0) === 1 && billOverdue) hasCancelPhase = true;
  }

  const saleDateIso = String(sale.sale_date || '').slice(0, 10);
  const saleDateBr = fmtDate(saleDateIso);
  const saleDateDigits = digitsOnly(saleDateBr || saleDateIso);

  const numberTermsFrom = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return [];
    return [
      String(n),
      n.toFixed(2),
      n.toFixed(2).replace('.', ','),
      fmtBRL(n),
      digitsOnly(fmtBRL(n))
    ];
  };

  const numericTerms = [
    ...numberTermsFrom(sale.base_value),
    ...numberTermsFrom(sale.total_commission),
    ...numberTermsFrom(sale.commission_percentage),
    ...numberTermsFrom(sale.unit_value),
    ...numberTermsFrom(sale.credit_generated)
  ];

  const quotaTerms = Array.isArray(sale.quotas_values)
    ? sale.quotas_values.flatMap((v) => numberTermsFrom(v))
    : [];

  const keywords = [
    'venda',
    'cliente',
    'consultor',
    'produto',
    'valor',
    'base',
    'comissao',
    'parcela',
    'parcelas',
    hasPending ? 'pendente pendentes' : '',
    hasPaid ? 'paga pago pagas pagos quitada quitado' : '',
    hasOverdue ? 'atrasada atrasado atrasadas atrasados vencida vencido em atraso' : '',
    hasBillOverdue ? 'boleto atrasado boleto em aberto' : '',
    hasCancelPhase ? 'fase cancelamento' : ''
  ].join(' ');

  const rawParts = [
    sale.client_name,
    sale.client_number,
    sale.consultant_name,
    sale.product,
    saleDateIso,
    saleDateBr,
    saleDateDigits,
    digitsOnly(sale.client_number || ''),
    ...numericTerms,
    ...quotaTerms,
    keywords
  ];
  const raw = rawParts.join(' ');

  const text = normalizeSearchText(raw);
  const digitTokens = rawParts
    .map((part) => digitsOnly(part))
    .filter(Boolean);
  const tokens = text ? Array.from(new Set(text.split(' '))) : [];
  return { text, digitTokens, tokens };
}

function matchesSaleQuery(searchDoc, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  if (searchDoc.text.includes(normalizedQuery)) return true;

  const normalizedDigits = digitsOnly(normalizedQuery);
  if (
    normalizedDigits.length >= 4 &&
    searchDoc.digitTokens.some((digits) => digits.includes(normalizedDigits))
  ) return true;

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  return queryTokens.every((qToken) => {
    if (searchDoc.text.includes(qToken)) return true;

    const tokenDigits = digitsOnly(qToken);
    if (
      tokenDigits.length >= 4 &&
      searchDoc.digitTokens.some((digits) => digits.includes(tokenDigits))
    ) return true;

    return searchDoc.tokens.some((token) => tokenMatches(qToken, token));
  });
}

export default function Dashboard({ user, onLogout }) {
  const [darkMode, setDarkMode] = useState(true);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState([]);
  const [consultants, setConsultants] = useState([]);
  const [summary, setSummary] = useState(null);
  const [rankingAll, setRankingAll] = useState([]);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef(null);

  // recebimentos por mês (parcelas que vencem no mês)
  const [cashMonth, setCashMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [cashConsultantId, setCashConsultantId] = useState(''); // admin: filtrar recebimentos por consultor ("" = todos)
  const [cashflow, setCashflow] = useState(null);
  const [cashflowError, setCashflowError] = useState('');

  const [saleFormOpen, setSaleFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [details, setDetails] = useState(null);

  // abas do modal de detalhes
  const [detailsTab, setDetailsTab] = useState('installments');

  // edição de cotas
  const [editingQuotas, setEditingQuotas] = useState([]);
  const [savingQuotas, setSavingQuotas] = useState(false);
  const [quotasMsg, setQuotasMsg] = useState('');

  // edição de parcelas
  const [editingInstallments, setEditingInstallments] = useState([]);
  const [savingInstallments, setSavingInstallments] = useState(false);
  const [installmentsMsg, setInstallmentsMsg] = useState('');

  const isAdmin = user.role === 'admin';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const load = async () => {
    setLoading(true);
    try {
      const [c, s, rank, sum] = await Promise.all([
        api.listConsultants(),
        api.listSales(),
        api.ranking().catch(() => []),
        fetch('/api/summary', { credentials: 'include' }).then(r => r.ok ? r.json() : null)
      ]);
      setConsultants(c);
      setSales(s);
      setRankingAll(Array.isArray(rank) ? rank : []);
      setSummary(sum);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    let alive = true;
    setCashflowError('');
    api.recebimentos(cashMonth, isAdmin ? cashConsultantId : null)
      .then((r) => { if (alive) setCashflow(r); })
      .catch(() => { if (alive) setCashflowError('Não foi possível carregar os recebimentos desse mês.'); });
    return () => { alive = false; };
  }, [cashMonth, cashConsultantId, isAdmin]);

  useEffect(() => {
    // toda vez que abrir detalhes, prepara parcelas editáveis
    if (!details) {
      setEditingInstallments([]);
      setInstallmentsMsg('');
      setEditingQuotas([]);
      setQuotasMsg('');
      return;
    }
    setDetailsTab('installments');
    const list = (details.installments || []).map(normalizeInstallmentForUi).sort((a,b)=>a.number-b.number);
    setEditingInstallments(list);
    setInstallmentsMsg('');

    const qs = Array.isArray(details.quotas_values) && details.quotas_values.length
      ? details.quotas_values
      : Array.from({ length: Math.max(1, Number(details.quotas || 1)) }, () => Number(details.unit_value || 0));
    setEditingQuotas(qs.map(v => Number(v) || 0));
    setQuotasMsg('');
  }, [details]);

  const kpis = useMemo(() => {
    const total = sales.reduce((a, x) => a + Number(x.total_commission || 0), 0);
    let paid = 0, pending = 0, overdue = 0;

    for (const s of sales) {
      for (const it0 of (s.installments || [])) {
        const it = normalizeInstallmentForUi(it0);
        const v = Number(it.value || 0);
        if (it.status === 'paid') paid += v;
        else if (it.status === 'overdue') overdue += v;
        else pending += v;
      }
    }

    const credit = sales.reduce((a, x) => a + Number(x.credit_generated || 0), 0);
    return { total, paid, pending, overdue, credit, count: sales.length };
  }, [sales]);

  const chartPalette = useMemo(() => {
    // Paleta consistente (fica bonita no dark e no light)
    return {
      bars: [
        'rgba(59, 130, 246, 0.85)',  // blue
        'rgba(16, 185, 129, 0.85)',  // green
        'rgba(245, 158, 11, 0.85)',  // amber
        'rgba(239, 68, 68, 0.85)',   // red
        'rgba(168, 85, 247, 0.85)',  // purple
        'rgba(14, 165, 233, 0.85)'   // sky
      ],
      donut: {
        paid: 'rgba(16, 185, 129, 0.85)',
        pending: 'rgba(245, 158, 11, 0.85)',
        overdue: 'rgba(239, 68, 68, 0.85)'
      }
    };
  }, []);

  const chartTheme = useMemo(() => {
    const text = darkMode ? '#e2e8f0' : '#334155';
    const muted = darkMode ? '#94a3b8' : '#64748b';
    const grid = darkMode ? 'rgba(148,163,184,0.15)' : 'rgba(15,23,42,0.08)';
    return { text, muted, grid };
  }, [darkMode]);

  const ranking = useMemo(() => {
    // Ranking por VENDAS totais (não exibe comissão).
    // Importante: para consultores, usamos /api/ranking (agregado) para eles verem o ranking completo
    // sem precisar expor as vendas dos outros.
    if (Array.isArray(rankingAll) && rankingAll.length) {
      return rankingAll
        .map(r => ({ name: r.name || '-', totalSales: Number(r.totalSales || 0), salesCount: Number(r.salesCount || 0) }))
        .sort((a, b) => b.totalSales - a.totalSales);
    }
    // fallback (caso o endpoint falhe): calcula com base nas vendas carregadas
    const map = new Map();
    for (const s of sales) {
      const key = s.consultant_name || '-';
      map.set(key, (map.get(key) || 0) + Number(s.base_value || 0));
    }
    return [...map.entries()]
      .map(([name, totalSales]) => ({ name, totalSales: Number(totalSales || 0) }))
      .sort((a, b) => b.totalSales - a.totalSales);
  }, [sales, rankingAll]);

  const getRankTier = (totalSales) => {
    const v = Number(totalSales || 0);
    if (v >= 1_500_000) return { key: 'lenda', label: 'Lenda das Vendas', color: 'rgba(251, 191, 36, 0.90)' }; // gold
    if (v >= 1_000_000) return { key: 'mestre', label: 'Mestre das Vendas', color: 'rgba(59, 130, 246, 0.90)' }; // blue
    if (v >= 800_000) return { key: 'diamante', label: 'Diamante', color: 'rgba(14, 165, 233, 0.90)' }; // sky
    if (v >= 400_000) return { key: 'ouro', label: 'Ouro', color: 'rgba(245, 158, 11, 0.90)' }; // amber
    if (v >= 200_000) return { key: 'prata', label: 'Prata', color: 'rgba(148, 163, 184, 0.90)' }; // slate
    if (v >= 100_000) return { key: 'bronze', label: 'Bronze', color: 'rgba(160, 98, 46, 0.90)' }; // warm
    return { key: 'iniciante', label: 'Iniciante', color: 'rgba(100, 116, 139, 0.70)' };
  };

  const chartBar = useMemo(() => {
    const top = ranking.slice(0, 6);
    const bg = top.map(x => getRankTier(x.totalSales).color);
    const border = bg.map(c => c.replace('0.90', '1').replace('0.70', '1'));
    return {
      data: {
        labels: top.map(x => x.name),
        datasets: [{
          label: 'Vendas totais (R$)',
          data: top.map(x => Math.round(x.totalSales * 100) / 100),
          backgroundColor: bg,
          borderColor: border,
          borderWidth: 1,
          borderRadius: 10,
          barThickness: 22
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            callbacks: {
              title: (items) => {
                const it = items?.[0];
                return it?.label || '';
              },
              label: (ctx) => {
                const total = ctx.parsed?.y ?? ctx.parsed;
                const tier = getRankTier(total);
                return [`Total: ${fmtBRL(total)}`, `Nível: ${tier.label}`];
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: chartTheme.muted },
            grid: { color: chartTheme.grid }
          },
          y: {
            ticks: { color: chartTheme.muted },
            grid: { color: chartTheme.grid }
          }
        }
      }
    };
  }, [ranking, chartPalette, chartTheme]);

  const chartDonut = useMemo(() => ({
    data: {
      labels: ['Pago', 'Pendente', 'Atrasado'],
      datasets: [{
        data: [kpis.paid, kpis.pending, kpis.overdue],
        backgroundColor: [chartPalette.donut.paid, chartPalette.donut.pending, chartPalette.donut.overdue],
        borderColor: [
          chartPalette.donut.paid.replace('0.85','1'),
          chartPalette.donut.pending.replace('0.85','1'),
          chartPalette.donut.overdue.replace('0.85','1')
        ],
        borderWidth: 1,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: chartTheme.text } },
        tooltip: { enabled: true }
      }
    }
  }), [kpis, chartPalette, chartTheme]);

  const logout = async () => {
    await api.logout();
    onLogout();
  };

  const downloadExcel = async () => {
    const scope = isAdmin ? 'all' : 'me';
    const resp = await fetch(`/api/export/xlsx?scope=${scope}`, { credentials: 'include' });
    if (!resp.ok) {
      alert('Não foi possível exportar agora. Faça login novamente e tente de novo.');
      return;
    }
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export-${scope}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const importExcel = async (file) => {
    if (!file) return;
    if (!String(file.name || '').toLowerCase().endsWith('.xlsx')) {
      alert('Selecione um arquivo .xlsx.');
      return;
    }

    const ok = confirm(
      'Importar este arquivo Excel (.xlsx) para o sistema?\n\nDica: use o arquivo exportado pelo próprio Dashboard.'
    );
    if (!ok) return;

    const run = async (mode) => {
      const r = await api.importXlsx(file, { mode });
      await load();
      return r;
    };

    setImporting(true);
    try {
      const r = await run('insert');

      if (Array.isArray(r.errors) && r.errors.length) {
        console.warn('Import xlsx errors:', r.errors);
      }

      alert(
        `Importação concluída.\n\n` +
        `Modo: importar tudo (inclui duplicadas)\n` +
        `Vendas importadas: ${r.createdSales || 0}\n` +
        `Consultores criados: ${r.createdConsultants || 0}` +
        (r.errors?.length ? `\nErros: ${r.errors.length} (veja o console)` : '')
      );
    } catch (err) {
      const code = err?.payload?.error || err?.message;
      alert(code === 'forbidden'
        ? 'Apenas o administrador pode importar Excel.'
        : `Não foi possível importar.\n\nErro: ${code || 'desconhecido'}`);
    } finally {
      setImporting(false);
    }
  };

  const saveSale = async (payload) => {
    if (editing) {
      await api.updateSale(editing.id, payload);
      setEditing(null);
    } else {
      await api.createSale(payload);
    }
    await load();
  };

  const deleteSale = async (id) => {
    await api.deleteSale(id);
    setDetails(null);
    await load();
  };

  const setInstallmentUiStatus = (number, newUiStatus) => {
    setEditingInstallments(prev => prev.map(it => {
      if (it.number !== number) return it;

      if (newUiStatus === 'paid') {
        return { ...it, status: 'paid', bill_overdue: 0, paid_date: todayIso() };
      }
      if (newUiStatus === 'bill_overdue') {
        // boleto atrasado (cliente não pagou) - mantém como pendente para regras automáticas,
        // mas marca a flag para exibir corretamente.
        return { ...it, status: 'pending', bill_overdue: 1, paid_date: null };
      }
      // pending: se está vencida, vai aparecer como atrasada automaticamente (normalize)
      return { ...it, status: 'pending', bill_overdue: 0, paid_date: null };
    }));
  };

  const saveInstallments = async () => {
    if (!details) return;
    setSavingInstallments(true);
    setInstallmentsMsg('');

    try {
      // ao salvar: se não está pago e venceu, manda como overdue (pra ficar persistido)
      const payloadInstallments = editingInstallments.map(it => {
        const paid = it.status === 'paid' || !!it.paid_date;
        const overdue = !paid && isOverdue(it.due_date);
        return {
          number: it.number,
          value: it.value,
          due_date: it.due_date,
          status: paid ? 'paid' : (overdue ? 'overdue' : 'pending'),
          bill_overdue: paid ? 0 : (Number(it.bill_overdue || 0) ? 1 : 0),
          paid_date: paid ? (it.paid_date || todayIso()) : null
        };
      });

      const resp = await fetch(`/api/sales/${details.id}/installments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ installments: payloadInstallments })
      });

      if (!resp.ok) {
        setInstallmentsMsg('Erro: Não foi possível salvar as parcelas. Faça login novamente e tente de novo.');
        return;
      }

      // recarrega tudo e reabre detalhes atualizado (por id)
      await load();
      setInstallmentsMsg('Sucesso: Parcelas salvas.');
      // Atualiza o modal com os dados mais recentes
      setDetails(prev => {
        if (!prev) return prev;
        const updated = sales.find(x => x.id === prev.id);
        return updated || prev;
      });
    } catch (e) {
      setInstallmentsMsg('Erro ao salvar parcelas.');
    } finally {
      setSavingInstallments(false);
    }
  };

  const setDetailQuotaCount = (n) => {
    const count = Math.max(1, Math.min(50, Number(n) || 1));
    setEditingQuotas(prev => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push(0);
      return next;
    });
  };

  const setDetailQuotaValue = (idx, value) => {
    const v = Number(value);
    setEditingQuotas(prev => prev.map((x, i) => (i === idx ? (Number.isFinite(v) ? v : 0) : x)));
  };

  const saveQuotas = async () => {
    if (!details) return;
    setSavingQuotas(true);
    setQuotasMsg('');
    try {
      const values = editingQuotas.map(v => Number(v) || 0);
      const updated = await api.updateQuotas(details.id, values);
      // atualiza a lista local e o modal
      await load();
      setDetails(updated);
      setQuotasMsg('Sucesso: Cotas salvas.');
    } catch (e) {
      setQuotasMsg('Erro: Não foi possível salvar as cotas.');
    } finally {
      setSavingQuotas(false);
    }
  };

  return (
    <Shell darkMode={darkMode}>
      <header className="z-40 shrink-0 backdrop-blur-xl bg-white/70 dark:bg-slate-950/40 border-b border-slate-200/70 dark:border-white/10 shadow-sm shadow-black/5">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <div className="flex items-center gap-4">
              <motion.div whileHover={{ rotate: 180, scale: 1.06 }} transition={{ duration: 0.3 }} className="relative w-12 h-12">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-500/35">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>
              </motion.div>
              <div>
                <div className="text-xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                  Dashboard de Comissões
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  {isAdmin
                    ? 'Admin'
                    : `Consultor - ${consultants.find(c => c.id === user.consultant_id)?.name || '-'}`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={load} className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-2xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5">
                <RefreshCw className="w-4 h-4" />
                Atualizar
              </button>
              {isAdmin ? (
                <>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      importExcel(f);
                    }}
                  />
                  <button
                    onClick={() => importInputRef.current?.click()}
                    disabled={importing}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-slate-200/70 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Upload className="w-4 h-4" />
                    {importing ? 'Importando...' : 'Importar Excel'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Somente administrador"
                  className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-slate-200/70 dark:border-white/10 opacity-50 cursor-not-allowed"
                >
                  <Upload className="w-4 h-4" />
                  Importar Excel
                </button>
              )}
              <button onClick={downloadExcel} className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-slate-200/70 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5">
                <Download className="w-4 h-4" />
                Exportar Excel
              </button>
              <button onClick={() => setDarkMode(v => !v)} className="flex items-center justify-center w-11 h-11 rounded-2xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5">
                {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
              <button onClick={logout} className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                <LogOut className="w-4 h-4" />
                Sair
              </button>
            </div>
          </div>

          <div className="pb-4">
            <div className="flex flex-wrap gap-2">
              <TabButton active={tab==='overview'} onClick={()=>setTab('overview')} icon={FileText} label="Visão geral" />
              <TabButton active={tab==='sales'} onClick={()=>setTab('sales')} icon={BarChart3} label="Vendas" />
              {isAdmin && <TabButton active={tab==='consultants'} onClick={()=>setTab('consultants')} icon={Users} label="Consultores" />}
              {isAdmin && <TabButton active={tab==='settings'} onClick={()=>setTab('settings')} icon={Settings2} label="Configurações" />}
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="text-slate-600 dark:text-slate-300 animate-pulse">Carregando...</div>
        ) : (
          <>
            {tab === 'overview' && (
              <div className="space-y-8">
                {summary && (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Resumo rápido
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <Pill icon={FileText} label="Vendas hoje" value={`${summary.today?.sales_count || 0}`} tone="cyan" />
                      <Pill icon={BarChart3} label="Comissão hoje" value={fmtBRL(summary.today?.commission_total || 0)} tone="emerald" />
                      <Pill icon={FileText} label="Vendas (7 dias)" value={`${summary.last7?.sales_count || 0}`} tone="violet" />
                      <Pill icon={BarChart3} label="Comissão (mês)" value={fmtBRL(summary.month?.commission_total || 0)} tone="violet" />
                      <Pill icon={BarChart3} label="Parcelas pendentes" value={`${summary.installments?.pending || 0}`} tone="amber" />
                      <Pill icon={BarChart3} label="Parcelas atrasadas" value={`${summary.installments?.overdue || 0}`} tone="rose" />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Pill icon={BarChart3} label="Comissão total" value={fmtBRL(kpis.total)} tone="violet" />
                  <Pill icon={BarChart3} label="Pago" value={fmtBRL(kpis.paid)} tone="emerald" />
                  <Pill icon={BarChart3} label="Pendente/Atrasado" value={fmtBRL(kpis.pending + kpis.overdue)} tone="amber" />
                </div>

                <div className="rounded-3xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 backdrop-blur-xl p-6 shadow-xl">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <SectionTitle icon={FileText} title="Recebimentos do mês" subtitle="Parcelas que vencem no mês selecionado" />
                    <div className="flex items-center gap-3">
                      {isAdmin && (
                        <>
                          <div className="text-sm text-slate-500 dark:text-slate-400">Consultor</div>
                          <select
                            value={cashConsultantId}
                            onChange={(e) => setCashConsultantId(e.target.value)}
                            className="rounded-2xl bg-slate-50 dark:bg-white/5 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-white/10 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                          >
                            <option value="" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Todos</option>
                            {(consultants || []).map((c) => (
                              <option key={c.id} value={String(c.id)} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">{c.name}</option>
                            ))}
                          </select>
                        </>
                      )}
                      <div className="text-sm text-slate-500 dark:text-slate-400">Mês</div>
                      <input
                        type="month"
                        value={cashMonth}
                        onChange={(e) => setCashMonth(e.target.value)}
                        className="rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-4">
                      <div className="text-xs text-slate-500 dark:text-slate-400">Total no mês</div>
                      <div className="text-xl font-bold text-slate-900 dark:text-white">{fmtBRL(cashflow?.total || 0)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-4">
                      <div className="text-xs text-slate-500 dark:text-slate-400">Qtd. de parcelas</div>
                      <div className="text-xl font-bold text-slate-900 dark:text-white">{cashflow?.count ?? 0}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-4">
                      <div className="text-xs text-slate-500 dark:text-slate-400">Período</div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        {cashflow?.range ? `${fmtDate(cashflow.range.start)} -> ${fmtDate(cashflow.range.end)}` : '-'}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">(fim exclusivo)</div>
                    </div>
                  </div>

                  {cashflowError && (
                    <div className="mt-4 text-sm text-rose-500">{cashflowError}</div>
                  )}

                  <div className="mt-4 overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-500 dark:text-slate-400">
                          <th className="py-2 pr-4">Vencimento</th>
                          {isAdmin && !cashConsultantId && <th className="py-2 pr-4">Consultor</th>}
                          <th className="py-2 pr-4">Cliente</th>
                          <th className="py-2 pr-4">Produto</th>
                          <th className="py-2 pr-4">Parcela</th>
                          <th className="py-2 pr-4">Status</th>
                          <th className="py-2 text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(cashflow?.installments || []).map((it) => {
                          const dispStatus = (it.status === 'paid' || it.paid_date) ? 'paid' : (Number(it.bill_overdue || 0) ? 'bill_overdue' : (it.status || 'pending'));
                          const sl = statusLabel(dispStatus);
                          return (
                            <tr key={`${it.sale_id}-${it.installment_number}`} className="border-t border-slate-200/60 dark:border-white/10">
                              <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(it.due_date)}</td>
                              {isAdmin && !cashConsultantId && (
                                <td className="py-2 pr-4 whitespace-nowrap">{it.consultant_name || '?'}</td>
                              )}
                              <td className="py-2 pr-4 max-w-[240px] truncate">
                                {it.client_name}
                                {it.client_number ? <span className="ml-2 text-xs text-slate-400">({it.client_number})</span> : null}
                              </td>
                              <td className="py-2 pr-4 whitespace-nowrap">{it.product}</td>
                              <td className="py-2 pr-4 whitespace-nowrap">{it.installment_number}ª</td>
                              <td className="py-2 pr-4 whitespace-nowrap">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full border ${sl.cls}`}>{sl.text}</span>
                                  {dispStatus === 'bill_overdue' && Number(it.cancellation_phase || 0) === 1 && (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full border bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25 text-[11px] font-semibold">
                                      Fase de cancelamento
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 text-right font-semibold text-slate-900 dark:text-white">{fmtBRL(it.value)}</td>
                            </tr>
                          );
                        })}

                        {(!cashflow?.installments || cashflow.installments.length === 0) && (
                          <tr className="border-t border-slate-200/60 dark:border-white/10">
                            <td colSpan={(isAdmin && !cashConsultantId) ? 7 : 6} className="py-4 text-center text-slate-500 dark:text-slate-400">Nenhuma parcela vence nesse mês.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="rounded-3xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 backdrop-blur-xl p-6 shadow-xl">
                    <SectionTitle icon={BarChart3} title="Ranking (Jogo de Vendas)" subtitle="Todos veem o ranking - Mostra somente o total de vendas" />
                    <div className="mt-4">
                      <Bar data={chartBar.data} options={chartBar.options} />
                    </div>
                    <div className="mt-4 space-y-2">
                      {ranking.slice(0, 6).map((r, idx) => {
                        const tier = getRankTier(r.totalSales);
                        return (
                          <div key={r.name} className="flex items-center justify-between gap-3 text-sm">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 shrink-0 text-slate-700 dark:text-slate-200 font-semibold">#{idx+1}</div>
                              <div className="min-w-0">
                                <div className="text-slate-900 dark:text-white font-semibold truncate">{r.name}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <span
                                    className="text-[11px] px-2.5 py-1 rounded-full border"
                                    style={{ borderColor: tier.color.replace('0.90','0.45'), backgroundColor: tier.color.replace('0.90','0.14'), color: darkMode ? '#e2e8f0' : '#0f172a' }}
                                    title={`Tier: ${tier.label}`}
                                  >
                                    {tier.label}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="shrink-0 text-right">
                              <div className="font-semibold text-slate-900 dark:text-white">{fmtBRL(r.totalSales)}</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">Total de vendas</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 backdrop-blur-xl p-6 shadow-xl">
                    <SectionTitle icon={BarChart3} title="Status das parcelas" subtitle="Pago x Pendente x Atrasado" />
                    <div className="mt-4 max-w-md">
                      <Doughnut data={chartDonut.data} options={chartDonut.options} />
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-3">
                        <div className="font-semibold">Pago</div>
                        <div className="text-base font-bold text-slate-900 dark:text-white">{fmtBRL(kpis.paid)}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-3">
                        <div className="font-semibold">Pendente</div>
                        <div className="text-base font-bold text-slate-900 dark:text-white">{fmtBRL(kpis.pending)}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-3">
                        <div className="font-semibold">Atrasado</div>
                        <div className="text-base font-bold text-slate-900 dark:text-white">{fmtBRL(kpis.overdue)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'sales' && (
              <SalesView
                sales={sales}
                isAdmin={isAdmin}
                onNew={() => { setEditing(null); setSaleFormOpen(true); }}
                onDetails={(s) => setDetails(s)}
              />
            )}

            {tab === 'consultants' && isAdmin && (
              <ConsultantsView consultants={consultants} onReload={load} />
            )}

            {tab === 'settings' && isAdmin && (
              <SettingsView consultants={consultants} onReload={load} />
            )}
          </>
        )}
      </main>

      <SaleForm
        open={saleFormOpen}
        onClose={() => { setSaleFormOpen(false); setEditing(null); }}
        onSave={saveSale}
        consultants={consultants}
        user={user}
        editing={editing}
      />

      <Modal open={!!details} onClose={() => setDetails(null)} title="Detalhes da venda" widthClass="max-w-5xl">
        {details && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <InfoBox label="Consultor" value={details.consultant_name} />
              <InfoBox label="Cliente" value={details.client_name} />
              <InfoBox label="Nº do cliente" value={details.client_number} />
              <InfoBox label="Produto" value={details.product} />
              <InfoBox label="Data" value={fmtDate(details.sale_date)} />
              <InfoBox label="Base" value={fmtBRL(details.base_value)} />
              <InfoBox label="%" value={`${details.commission_percentage}%`} />
              <InfoBox label="Comissão total" value={fmtBRL(details.total_commission)} />
              <InfoBox label="Crédito gerado" value={fmtBRL(details.credit_generated)} />
              <InfoBox label="Seguro" value={details.insurance ? 'Sim' : 'Não'} />
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setDetailsTab('installments')}
                  className={`px-4 py-2 rounded-2xl border transition ${detailsTab==='installments'
                    ? 'border-violet-400/40 bg-violet-500/10 text-violet-700 dark:text-violet-200'
                    : 'border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200'
                  }`}
                >Parcelas</button>
                <button
                  onClick={() => setDetailsTab('quotas')}
                  className={`px-4 py-2 rounded-2xl border transition ${detailsTab==='quotas'
                    ? 'border-violet-400/40 bg-violet-500/10 text-violet-700 dark:text-violet-200'
                    : 'border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200'
                  }`}
                >Cotas</button>
              </div>

              {detailsTab === 'installments' && (
                <div className="rounded-3xl border border-slate-200/60 dark:border-white/10 overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200/60 dark:border-white/10 font-semibold flex items-center justify-between">
                    <div>Parcelas ({(editingInstallments || []).length || 0})</div>

                    <button
                      onClick={saveInstallments}
                      disabled={savingInstallments}
                      className="px-4 py-2 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold shadow-lg shadow-violet-600/20 disabled:opacity-60"
                    >
                      {savingInstallments ? 'Salvando...' : 'Salvar parcelas'}
                    </button>
                  </div>

                  {installmentsMsg && (
                    <div className="px-4 py-3 text-sm border-b border-slate-200/60 dark:border-white/10 bg-slate-50/60 dark:bg-white/5">
                      {installmentsMsg}
                    </div>
                  )}

                  <div className="divide-y divide-slate-200/60 dark:divide-white/10">
                    {(editingInstallments || []).map((it) => {
                      const dispStatus = displayInstallmentStatus(it);
                      const st = statusLabel(dispStatus);
                      const isPaid = dispStatus === 'paid';
                      const isBillOverdue = dispStatus === 'bill_overdue';
                      const isAutoOverdue = it.status === 'overdue' && !it.paid_date;

                      return (
                        <div key={it.number} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                          <div className="text-sm font-medium">Parcela {it.number}</div>
                          <div className="text-sm">Venc.: {fmtDate(it.due_date)}</div>
                          <div className="text-sm font-semibold">{fmtBRL(it.value)}</div>

                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-3 py-1 rounded-full border ${st.cls}`}>{st.text}</span>

                            {isBillOverdue && Number(it.cancellation_phase || 0) === 1 && (
                              <span className="text-xs px-3 py-1 rounded-full border bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25">
                                Fase de cancelamento
                              </span>
                            )}

                            <select
                              value={isPaid ? 'paid' : (isBillOverdue ? 'bill_overdue' : 'pending')}
                              onChange={(e) => setInstallmentUiStatus(it.number, e.target.value)}
                              className="rounded-2xl bg-slate-50 dark:bg-white/5 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                              title={isBillOverdue
                                ? 'Cliente está com boleto atrasado.'
                                : (isAutoOverdue ? 'Está atrasada automaticamente (vencida e não paga).' : 'Alterar status')}
                            >
                              <option value="pending" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Pendente</option>
                              <option value="bill_overdue" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Boleto atrasado</option>
                              <option value="paid" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Paga</option>
                            </select>

                            {isPaid && (
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                Pago em: {fmtDate(it.paid_date || todayIso())}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {detailsTab === 'quotas' && (
                <div className="rounded-3xl border border-slate-200/60 dark:border-white/10 overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200/60 dark:border-white/10 font-semibold flex items-center justify-between">
                    <div>Cotas ({editingQuotas.length}) - Total: {fmtBRL(editingQuotas.reduce((a,v)=>a+(Number(v)||0),0))}</div>

                    <button
                      onClick={saveQuotas}
                      disabled={savingQuotas}
                      className="px-4 py-2 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold shadow-lg shadow-violet-600/20 disabled:opacity-60"
                    >
                      {savingQuotas ? 'Salvando...' : 'Salvar cotas'}
                    </button>
                  </div>

                  {quotasMsg && (
                    <div className="px-4 py-3 text-sm border-b border-slate-200/60 dark:border-white/10 bg-slate-50/60 dark:bg-white/5">
                      {quotasMsg}
                    </div>
                  )}

                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <TextInput label="Qtd cotas" type="number" value={editingQuotas.length} onChange={setDetailQuotaCount} />
                      <div className="space-y-2 md:col-span-2">
                        <div className="text-sm font-medium text-slate-600 dark:text-slate-300">Total das cotas (Base)</div>
                        <input
                          type="text"
                          value={fmtBRL(editingQuotas.reduce((a,v)=>a+(Number(v)||0),0))}
                          readOnly
                          className="w-full rounded-2xl bg-slate-100/70 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-3 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {editingQuotas.map((v, idx) => (
                        <div key={idx} className="space-y-2">
                          <div className="text-xs font-medium text-slate-600 dark:text-slate-300">Cota {idx + 1}</div>
                          <input
                            type="number"
                            value={v}
                            onChange={(e) => setDetailQuotaValue(idx, e.target.value)}
                            className="w-full rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setEditing(details);
                  setDetails(null);
                  setSaleFormOpen(true);
                }}
                className="px-4 py-2 rounded-2xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-2"
              >
                <Pencil className="w-4 h-4" />
                Editar
              </button>
              <button
                onClick={() => deleteSale(details.id)}
                className="px-4 py-2 rounded-2xl bg-rose-600 text-white hover:bg-rose-700 flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Excluir
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Shell>
  );
}

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl border transition ${active
        ? 'border-violet-400/40 bg-violet-500/10 text-violet-700 dark:text-violet-200'
        : 'border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function InfoBox({ label, value }) {
  return (
    <div className="rounded-3xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 font-semibold text-slate-900 dark:text-white">{value || '-'}</div>
    </div>
  );
}

function SalesView({ sales, isAdmin, onNew, onDetails }) {
  const [q, setQ] = useState('');
  const salesIndex = useMemo(
    () => sales.map((sale) => ({ sale, searchDoc: buildSaleSearchDoc(sale) })),
    [sales]
  );

  const filtered = useMemo(() => {
    const query = normalizeSearchText(q);
    if (!query) return sales;
    return salesIndex
      .filter(({ searchDoc }) => matchesSaleQuery(searchDoc, query))
      .map(({ sale }) => sale);
  }, [q, sales, salesIndex]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xl font-semibold">Vendas</div>
          <div className="text-sm text-slate-600 dark:text-slate-400">Clique em uma linha para ver detalhes.</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e)=>setQ(e.target.value)}
            placeholder="Busca livre: nome, produto, valor, data, status, número..."
            className="w-72 max-w-full rounded-2xl bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          <button onClick={onNew} className="px-4 py-3 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold shadow-lg shadow-violet-600/20 flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Nova venda
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 backdrop-blur-xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300">
              <tr>
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-left px-4 py-3">Cliente</th>
                {isAdmin && <th className="text-left px-4 py-3">Consultor</th>}
                <th className="text-left px-4 py-3">Produto</th>
                <th className="text-left px-4 py-3">Cotas</th>
                <th className="text-right px-4 py-3">Base</th>
                <th className="text-right px-4 py-3">Comissão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 dark:divide-white/10">
              {filtered.map(s => (
                <tr
                  key={s.id}
                  onClick={() => onDetails(s)}
                  className="cursor-pointer hover:bg-slate-100/70 dark:hover:bg-white/5"
                >
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDate(s.sale_date)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span>{s.client_name}</span>
                      {s.client_number ? (
                        <span className="text-xs text-slate-500 dark:text-slate-400">({s.client_number})</span>
                      ) : null}
                      {(() => {
                        const list = Array.isArray(s.installments) ? s.installments : [];
                        const hasBillOverdue = list.some(it => Number(it.bill_overdue || 0) === 1 && !it.paid_date && String(it.status || '') !== 'paid');
                        const hasCancelPhase = list.some(it => Number(it.cancellation_phase || 0) === 1 && Number(it.bill_overdue || 0) === 1 && !it.paid_date && String(it.status || '') !== 'paid');
                        if (!hasBillOverdue) return null;
                        return (
                          <>
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/25">
                              Boleto atrasado
                            </span>
                            {hasCancelPhase && (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/25">
                                Fase de cancelamento
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </td>
                  {isAdmin && <td className="px-4 py-3">{s.consultant_name}</td>}
                  <td className="px-4 py-3">{s.product}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {Array.isArray(s.quotas_values) && s.quotas_values.length
                      ? (
                        <div className="max-w-[420px] truncate" title={s.quotas_values.map(fmtBRL).join(' | ')}>
                          {s.quotas_values.map(fmtBRL).join(' | ')}
                        </div>
                      )
                      : `${Math.max(1, Number(s.quotas || 1))}x ${fmtBRL(s.unit_value || 0)}`}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{fmtBRL(s.base_value)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{fmtBRL(s.total_commission)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={isAdmin ? 7 : 6} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">Nenhuma venda encontrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ConsultantsView({ consultants, onReload }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.createConsultant({ name, email, active: true });
      setName('');
      setEmail('');
      await onReload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionTitle icon={Users} title="Consultores" subtitle="Cadastre e mantenha sua equipe organizada." />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-3xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 p-6 shadow-xl">
          <div className="font-semibold mb-4">Novo consultor</div>
          <form onSubmit={add} className="space-y-4">
            <TextInput label="Nome" required value={name} onChange={setName} />
            <TextInput label="Email" value={email} onChange={setEmail} />
            <button disabled={saving} className="w-full px-5 py-3 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold shadow-lg shadow-violet-600/20 disabled:opacity-60">
              {saving ? 'Salvando...' : 'Adicionar'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 rounded-3xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 shadow-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200/60 dark:border-white/10 font-semibold">Lista</div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="text-left px-4 py-3">Nome</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 dark:divide-white/10">
                {consultants.map(c => (
                  <tr key={c.id} className="hover:bg-slate-100/70 dark:hover:bg-white/5">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3">{c.email || '-'}</td>
                    <td className="px-4 py-3">
                      {c.active ? <span className="text-xs px-3 py-1 rounded-full border bg-emerald-500/15 text-emerald-200 border-emerald-400/20">Ativo</span>
                        : <span className="text-xs px-3 py-1 rounded-full border bg-slate-500/10 text-slate-400 border-white/10">Inativo</span>}
                    </td>
                  </tr>
                ))}
                {consultants.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">Nenhum consultor cadastrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsView({ consultants, onReload }) {
  const [selected, setSelected] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedConsultant = useMemo(
    () => consultants.find((c) => String(c.id) === String(selected)) || null,
    [consultants, selected]
  );

  useEffect(() => {
    setMsg('');
    setPassword('');
    setUsername(selectedConsultant?.login_username || '');
  }, [selectedConsultant]);

  const createLogin = async (e) => {
    e.preventDefault();
    setMsg('');
    if (!selected || !username || !password) return;
    setLoading(true);
    try {
      await api.createConsultantLogin(Number(selected), { username, password });
      setMsg('Sucesso: Login salvo com sucesso.');
      setPassword('');
      await onReload();
    } catch (err) {
      setMsg(err.payload?.error === 'username_taken' ? 'Erro: Usuario ja existe.' : 'Erro: Nao foi possivel salvar o login.');
    } finally {
      setLoading(false);
    }
  };

  const deleteLogin = async () => {
    if (!selected) return;
    const name = selectedConsultant?.name || 'este consultor';
    if (!window.confirm(`Deseja realmente excluir o login de ${name}?`)) return;

    setMsg('');
    setLoading(true);
    try {
      await api.deleteConsultantLogin(Number(selected));
      setMsg('Sucesso: Login excluido.');
      setUsername('');
      setPassword('');
      await onReload();
    } catch (err) {
      setMsg(
        err.payload?.error === 'login_not_found'
          ? 'Aviso: Este consultor nao possui login cadastrado.'
          : 'Erro: Nao foi possivel excluir o login.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionTitle icon={KeyRound} title="Configuracoes" subtitle="Crie e mantenha logins dos consultores." />

      <div className="rounded-3xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 p-6 shadow-xl max-w-3xl">
        <form onSubmit={createLogin} className="space-y-4">
          <SelectInput
            label="Consultor"
            required
            value={selected}
            onChange={setSelected}
            options={consultants.map(c => ({ value: String(c.id), label: c.name }))}
          />
          <TextInput label="Usuario" required value={username} onChange={setUsername} placeholder="Ex: pedro" />
          <TextInput label="Senha" required value={password} onChange={setPassword} type="password" />

          {selectedConsultant && (
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Login atual: <span className="font-mono">{selectedConsultant.login_username || 'nao cadastrado'}</span>
            </div>
          )}

          {msg && (
            <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-4 py-3 text-sm">
              {msg}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button disabled={loading} className="px-5 py-3 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold shadow-lg shadow-violet-600/20 disabled:opacity-60">
              {loading ? 'Salvando...' : 'Salvar login'}
            </button>
            <button
              type="button"
              onClick={deleteLogin}
              disabled={loading || !selected}
              className="px-5 py-3 rounded-2xl bg-rose-600 text-white font-semibold hover:bg-rose-700 disabled:opacity-60"
            >
              Excluir login
            </button>
          </div>

          <div className="text-xs text-slate-600 dark:text-slate-300">
            Depois, o consultor entra pela tela de login com esse usuario e senha.
          </div>
        </form>
      </div>
    </div>
  );
}

