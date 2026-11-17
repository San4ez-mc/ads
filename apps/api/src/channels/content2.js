// Канал «контент-платформа» (content2): персони, рекламні креативи, замовлення контент-менеджеру, запис результатів.
// Контракт — content2: src/app/api/webhooks/ads-sync/route.ts. Вхід: Bearer ADS_SYNC_KEY (окремий ключ, не системний секрет).
const { scrub } = require('../lib/secrets');

async function call(baseUrl, key, projectId, action, body = {}, timeoutMs = 30000) {
  const res = await fetch(String(baseUrl).replace(/\/+$/, ''), {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, projectId, ...body }), signal: AbortSignal.timeout(timeoutMs),
  }).catch((e) => { throw new Error(`Контент-платформа недоступна: ${e.message}`); });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) throw new Error(scrub(json?.error?.message || `Контент-платформа відповіла HTTP ${res.status}`));
  return json.data;
}

module.exports = {
  check: (u, k, pid) => call(u, k, pid, 'ping'),
  personas: async (u, k, pid) => (await call(u, k, pid, 'personas')).personas || [],
  upsertPersona: (u, k, pid, p) => call(u, k, pid, 'upsert_persona', p),
  creatives: async (u, k, pid, limit) => (await call(u, k, pid, 'creatives', { limit })).creatives || [],
  order: (u, k, pid, text, dryRun) => call(u, k, pid, 'order', { text, dryRun: !!dryRun }, 20000),
  learning: (u, k, pid, title, content) => call(u, k, pid, 'learning', { title, content }),
};
