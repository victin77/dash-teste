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
  if (s === 'paid') {
    return {
      text: 'Pago',
      cls: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/25 dark:text-emerald-200 dark:border-emerald-400/20'
    };
  }
  if (s === 'bill_overdue') {
    return {
      text: 'Boleto atrasado',
      cls: 'bg-orange-500/15 text-orange-700 border-orange-500/25 dark:text-orange-200 dark:border-orange-400/20'
    };
  }
  if (s === 'overdue') {
    return {
      text: 'Atrasado',
      cls: 'bg-rose-500/15 text-rose-700 border-rose-500/25 dark:text-rose-200 dark:border-rose-400/20'
    };
  }
  return {
    text: 'Pendente',
    cls: 'bg-amber-500/15 text-amber-700 border-amber-500/25 dark:text-amber-200 dark:border-amber-400/20'
  };
}
