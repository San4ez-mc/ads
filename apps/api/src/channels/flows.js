// Канал «Flows»: читає етапи ботів-воронок із джерелом реклами (Flows: routes/ads-feed.js). Лише читання.
const { scrub } = require('../lib/secrets');

async function call(baseUrl, key, path) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) }).catch((e) => { throw new Error(`Flows недоступний: ${e.message}`); });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) throw new Error(scrub(json?.error?.message || `Flows відповів HTTP ${res.status}`));
  return json.data;
}

const q = (slugs) => encodeURIComponent((slugs || []).join(','));

async function check(baseUrl, key, slugs) {
  await call(baseUrl, key, '/ping');
  const funnels = slugs && slugs.length ? (await call(baseUrl, key, `/funnels?slugs=${q(slugs)}`)).funnels : [];
  const found = new Set(funnels.map((f) => f.slug));
  return { funnels: funnels.map((f) => ({ slug: f.slug, name: f.name, stages: f.stages.length })), missing: (slugs || []).filter((s) => !found.has(s)) };
}

const fetchFunnels = async (baseUrl, key, slugs) => (await call(baseUrl, key, `/funnels?slugs=${q(slugs)}`)).funnels || [];

async function fetchEvents(baseUrl, key, slugs, after, limit = 1000) {
  const d = await call(baseUrl, key, `/events?slugs=${q(slugs)}&limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ''}`);
  return { events: d.events || [], next: d.next || after || null, hasMore: !!d.hasMore };
}

module.exports = { check, fetchFunnels, fetchEvents };
