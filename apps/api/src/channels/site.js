// Канал «сайт»: читає кроки людей із АПІ сайтів (контракт — ../../../../АПІ-сайтів-для-платформи-реклами.md).
const { scrub } = require('../lib/secrets');

async function call(baseUrl, key, path, body) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}${path}`;
  const send = body ? { method: 'POST', body: JSON.stringify(body) } : {};
  const res = await fetch(url, { ...send, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(30_000) }).catch((e) => { throw new Error(`Сайт недоступний: ${e.message}`); });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) throw Object.assign(new Error(scrub(json?.error?.message || `АПІ сайту відповів HTTP ${res.status}`)), { status: res.status });
  return json.data;
}

async function check(baseUrl, key) {
  const ping = await call(baseUrl, key, '/ping');
  const sites = await call(baseUrl, key, '/sites').catch(() => ({ sites: [] }));
  return { service: ping?.service || null, version: ping?.version || null, sites: (sites.sites || []).map((s) => ({ id: s.id, domain: s.domain, name: s.name, steps: (s.steps || []).length })) };
}

const fetchSites = async (baseUrl, key) => (await call(baseUrl, key, '/sites')).sites || [];

/** Одна порція стрічки подій після afterId. */
async function fetchEvents(baseUrl, key, afterId, limit = 1000) {
  const d = await call(baseUrl, key, `/events?after_id=${encodeURIComponent(afterId || 0)}&limit=${limit}`);
  return { events: d.events || [], lastId: d.last_id ?? afterId, hasMore: !!d.has_more };
}

/** Увімкнені версії сторінок (A/B): яке посилання і що в ній змінено. */
const fetchVersions = async (baseUrl, key) => (await call(baseUrl, key, '/versions')).sites || [];
/** Правка (прохання) для сайту. Нічого на сайті не змінює. Викликати ЛИШЕ з routes/sites.js після підтвердження людини. */
const sendEdit = (baseUrl, key, edit) => call(baseUrl, key, '/edits', edit);

module.exports = { check, fetchSites, fetchEvents, fetchVersions, sendEdit };
