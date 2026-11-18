// Щогодинна синхронізація всіх проєктів: сайти, боти Flows, календар, реклама (що підключено).
// Запускає cron на сервері: 15 * * * * cd /var/www/ads.fineko.space && node scripts/sync-all.js >> /var/log/ads-sync.log 2>&1
// Лише читання з каналів; нічого в рекламному кабінеті не змінює. Одна помилка проєкту не зупиняє інші.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { db } = require('@ads/db');
const { runProjectSync } = require('../apps/api/src/services/sync');

(async () => {
  const projects = await db.project.findMany({ select: { id: true, slug: true } });
  for (const p of projects) {
    const t0 = Date.now();
    try {
      const r = await runProjectSync(p.id, { days: 3 });
      const bad = (r.results || []).filter((x) => !x.ok).map((x) => x.kind);
      console.log(`${new Date().toISOString()} ${p.slug} ok=${r.ok} ${Date.now() - t0}ms${bad.length ? ` помилки: ${bad.join(',')}` : ''}`);
    } catch (e) { console.log(`${new Date().toISOString()} ${p.slug} ПОМИЛКА ${String(e.message).slice(0, 200)}`); }
  }
  await db.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
