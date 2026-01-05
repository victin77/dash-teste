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
  updateInstallments: (id, installments) => request(`/api/sales/${id}/installments`, { method: 'PUT', body: { installments } }),
  summary: () => request('/api/summary')
};
