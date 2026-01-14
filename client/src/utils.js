export const fmtBRL = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));

export const fmtDate = (iso) => {
  if (!iso) return '';
  const [y,m,d] = String(iso).slice(0,10).split('-');
  if (!y) return String(iso);
  return `${d}/${m}/${y}`;
};

export const todayIso = () => new Date().toISOString().slice(0,10);

export function statusLabel(s) {
  if (s === 'paid') return { text: 'Pago', cls: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/20' };
  if (s === 'overdue') return { text: 'Atrasado', cls: 'bg-rose-500/15 text-rose-200 border-rose-400/20' };
  return { text: 'Pendente', cls: 'bg-amber-500/15 text-amber-200 border-amber-400/20' };
}


export function boletoLabel(flag) {
  if (flag) return { text: 'Boleto não pago', cls: 'bg-cyan-500/15 text-cyan-200 border-cyan-400/20' };
  return null;
}

