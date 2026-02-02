async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include'
  });

  if (!res.ok) {
    let payload;
    try { payload = await res.json(); } catch { payload = { error: 'unknown' }; }
    const err = new Error(payload.error || 'request_failed');
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  me: () => request('/api/auth/me'),
  login: (username, password) => request('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  publicConsultants: () => request('/api/public/consultants'),

  listConsultants: () => request('/api/consultants'),
  createConsultant: (data) => request('/api/consultants', { method: 'POST', body: data }),
  updateConsultant: (id, data) => request(`/api/consultants/${id}`, { method: 'PUT', body: data }),
  createConsultantLogin: (id, data) => request(`/api/consultants/${id}/create-login`, { method: 'POST', body: data }),

  listSales: () => request('/api/sales'),
  createSale: (data) => request('/api/sales', { method: 'POST', body: data }),
  updateSale: (id, data) => request(`/api/sales/${id}`, { method: 'PUT', body: data }),
  deleteSale: (id) => request(`/api/sales/${id}`, { method: 'DELETE' }),
  updateQuotas: (id, quotas_values) => request(`/api/sales/${id}/quotas`, { method: 'PUT', body: { quotas_values } }),
  updateInstallments: (id, installments) => request(`/api/sales/${id}/installments`, { method: 'PUT', body: { installments } }),
  ranking: () => request('/api/ranking?start=2026-01-01&end=2026-03-31'),
  summary: () => request('/api/summary'),
  recebimentos: (month, consultant_id) => {
    const params = new URLSearchParams();
    params.set('month', month);
    if (consultant_id != null && String(consultant_id).trim() !== '') {
      params.set('consultant_id', String(consultant_id));
    }
    return request(`/api/recebimentos?${params.toString()}`);
  },

  importXlsx: async (file, { mode = 'insert' } = {}) => {
    const params = new URLSearchParams();
    params.set('mode', mode);

    const res = await fetch(`/api/import/xlsx?${params.toString()}`, {
      method: 'POST',
      // Send the File directly (streaming) to avoid ArrayBuffer-related issues in some environments.
      // The server accepts any Content-Type for this endpoint.
      body: file,
      credentials: 'include'
    });

    if (!res.ok) {
      let payload;
      try { payload = await res.json(); } catch { payload = { error: `http_${res.status}` }; }
      const err = new Error(payload.error || 'request_failed');
      err.status = res.status;
      err.payload = payload;
      throw err;
    }
    return res.json();
  }
};
