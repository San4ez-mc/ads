// Канал «сайт»: читає кроки людей із АПІ сайтів (контракт — ../../../../АПІ-сайтів-для-платформи-реклами.md).
const { scrub } = require('../lib/secrets');

async function call(baseUrl, key, path) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) }).catch((e) => { throw new Error(`Сайт недоступний: ${e.message}`); });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) throw new Error(scrub(json?.error?.message || `АПІ сайту відповів HTTP ${res.status}`));
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

module.exports = { check, fetchSites, fetchEvents };
