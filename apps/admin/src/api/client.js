// Тонкий fetch-wrapper. projectId підставляється автоматично з authStore.
import { useAuthStore } from '../stores/authStore';

function withProject(path) {
  const id = useAuthStore.getState().currentProjectId;
  if (!id) return path;
  return `${path}${path.includes('?') ? '&' : '?'}projectId=${encodeURIComponent(id)}`;
}

async function req(method, path, body, { noProject } = {}) {
  const res = await fetch(`/api${noProject ? path : withProject(path)}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ ok: false, error: { message: 'Некоректна відповідь сервера' } }));
  if (!json.ok) {
    const err = new Error(json.error?.message || `HTTP ${res.status}`);
    err.code = json.error?.code; err.status = res.status;
    throw err;
  }
  return json.data;
}

const get = (p) => req('GET', p);
const post = (p, b) => req('POST', p, b ?? {});
const patch = (p, b) => req('PATCH', p, b);
const del = (p) => req('DELETE', p);
const qs = (o) => { const s = new URLSearchParams(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString(); return s ? `?${s}` : ''; };

export const api = {
  createProject: (d) => req('POST', '/projects', d, { noProject: true }),
  project: () => get('/project'),
  patchProject: (d) => patch('/project', d),
  rotateKey: () => post('/project/rotate-key'),

  connections: () => get('/connections'),
  testConnection: (d) => post('/connections/test', d),
  createConnection: (d) => post('/connections', d),
  patchConnection: (id, d) => patch(`/connections/${id}`, d),
  checkConnection: (id) => post(`/connections/${id}/check`),
  deleteConnection: (id) => del(`/connections/${id}`),

  overview: (p) => get(`/overview${qs(p)}`),
  ads: (p) => get(`/ads${qs(p)}`),
  map: (p) => get(`/map${qs(p)}`),
  advice: () => get('/advice'),
  bundles: () => get('/bundles'),
  createBundle: (d) => post('/bundles', d),
  patchBundle: (id, d) => patch(`/bundles/${id}`, d),
  deleteBundle: (id) => del(`/bundles/${id}`),
  audiences: () => get('/audiences'),
  createAudience: (d) => post('/audiences', d),
  elements: () => get('/elements'),
  patchStep: (elId, key, d) => patch(`/elements/${elId}/steps/${encodeURIComponent(key)}`, d),
  syncRun: (d) => post('/sync/run', d),
  syncRuns: () => get('/sync/runs'),
  journal: () => get('/journal'),
};

export const fmt = {
  money: (n) => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('uk-UA', { maximumFractionDigits: 0 })} грн`),
  money2: (n) => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} грн`),
  int: (n) => Number(n || 0).toLocaleString('uk-UA'),
  dt: (s) => (s ? new Date(s).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'),
};
