import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, UserRound, Sparkles, ArrowRight } from 'lucide-react';
import { api } from '../api.js';
import { useLocation, useNavigate } from 'react-router-dom';

function Label({ children }) {
  return <div className="text-sm font-medium text-slate-600 dark:text-slate-300">{children}</div>;
}

export default function Login({ onLogin }) {
  const nav = useNavigate();
  const loc = useLocation();
  const from = loc.state?.from?.pathname || '/';

  const [mode, setMode] = useState('admin');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [consultants, setConsultants] = useState([]);
  const [consultantId, setConsultantId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (mode !== 'consultant') return;
      setConsultantId('');
      setUsername('');
      setPassword('');
      try {
        const list = await api.publicConsultants();
        if (!alive) return;
        setConsultants(list);
        if (list?.length) {
          const first = list[0];
          setConsultantId(String(first.id));
          setUsername(String(first.login_username || '').trim().toLowerCase());
          setPassword('');
        }
      } catch {
        // ignore; UI will still allow manual login
      }
    })();
    return () => { alive = false; };
  }, [mode]);

  useEffect(() => {
    if (mode === 'admin') {
      setUsername('admin');
      setPassword('admin');
    }
  }, [mode]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (mode === 'consultant' && !username) {
      setError('Esse consultor ainda nao possui login configurado.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.login(username, password);
      onLogin(res.user);
      nav(from, { replace: true });
    } catch (err) {
      setError(err.payload?.error === 'invalid_credentials'
        ? 'Usuario ou senha invalidos.'
        : 'Nao foi possivel entrar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-slate-950 flex items-center justify-center p-6">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-grid-slate-dark opacity-100" />
        <div className="absolute inset-0 opacity-80 bg-[radial-gradient(900px_circle_at_15%_10%,rgba(59,130,246,0.18),transparent_45%),radial-gradient(1000px_circle_at_85%_20%,rgba(99,102,241,0.16),transparent_55%)]" />
        <div className="absolute -top-24 -left-24 w-[520px] h-[520px] bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-[520px] h-[520px] bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="rounded-3xl border border-white/10 bg-white/10 backdrop-blur-2xl shadow-2xl shadow-black/30 overflow-hidden">
          <div className="p-7 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-sky-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="text-xl font-bold text-white">Dashboard de Comissoes</div>
                <div className="text-sm text-white/70">Acesso seguro - RACON</div>
              </div>
            </div>
          </div>

          <div className="p-7">
            <div className="grid grid-cols-2 gap-3 mb-6">
              <button
                type="button"
                onClick={() => setMode('admin')}
                className={`rounded-2xl p-4 border transition ${
                  mode === 'admin' ? 'border-blue-400/60 bg-blue-500/15' : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <ShieldCheck className={`w-7 h-7 mx-auto ${mode === 'admin' ? 'text-blue-200' : 'text-white/60'}`} />
                <div className="mt-2 text-sm font-semibold text-white">Administrador</div>
                <div className="text-xs text-white/60">Visao completa</div>
              </button>
              <button
                type="button"
                onClick={() => setMode('consultant')}
                className={`rounded-2xl p-4 border transition ${
                  mode === 'consultant' ? 'border-cyan-400/60 bg-cyan-500/15' : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <UserRound className={`w-7 h-7 mx-auto ${mode === 'consultant' ? 'text-cyan-200' : 'text-white/60'}`} />
                <div className="mt-2 text-sm font-semibold text-white">Consultor</div>
                <div className="text-xs text-white/60">Acesso restrito</div>
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {mode === 'consultant' ? (
                <div className="space-y-2">
                  <Label>Consultor</Label>
                  <select
                    value={consultantId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setConsultantId(id);
                      const selected = consultants.find((c) => String(c.id) === String(id));
                      setUsername(String(selected?.login_username || '').trim().toLowerCase());
                    }}
                    className="w-full rounded-2xl bg-white/10 border border-white/10 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                  >
                    {consultants.length ? consultants.map((c) => (
                      <option key={c.id} value={String(c.id)} className="bg-slate-950">
                        {c.name}
                      </option>
                    )) : (
                      <option value="" className="bg-slate-950">Carregando...</option>
                    )}
                  </select>
                  <div className="text-xs text-white/60">
                    Usuario configurado: <span className="font-mono text-white/80">{username || 'nao configurado'}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Usuario</Label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-2xl bg-white/10 border border-white/10 px-4 py-3 text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400/60"
                    placeholder="admin"
                    autoComplete="username"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Senha</Label>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  className="w-full rounded-2xl bg-white/10 border border-white/10 px-4 py-3 text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400/60"
                  placeholder="********"
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {error}
                </div>
              )}

              <button
                disabled={loading}
                className="w-full rounded-2xl py-4 font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-600/25 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? 'Entrando...' : 'Entrar'}
                <ArrowRight className="w-5 h-5" />
              </button>

              <div className="text-xs text-white/60 leading-relaxed">
                <div className="font-semibold text-white/70 mb-1">Dica (ambiente novo):</div>
                <div>Admin padrao: <span className="font-mono text-white">admin</span> / <span className="font-mono text-white">admin</span> (mude no Render com <span className="font-mono">ADMIN_PASSWORD</span> e <span className="font-mono">SESSION_SECRET</span>).</div>
                <div className="mt-2">Consultores: use o usuario/senha definidos em <span className="font-mono">Configuracoes</span>.</div>
              </div>
            </form>
          </div>
        </div>

        <div className="text-center text-xs text-white/50 mt-6">
          Sistema interno - Seguranca por cookie HTTPOnly
        </div>
      </motion.div>
    </div>
  );
}
