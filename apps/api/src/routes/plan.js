// План воронок: працює БЕЗ рекламного кабінету. Для кожної зв'язки віддає креативи (підібрані з контент-платформи і вже запущені),
// шлях із кроків (сайти, боти, календар, ручні) і підсумок. Цифри з реклами з'являються, коли підключено кабінет і є оголошення.
const express = require('express');
const { db } = require('@ads/db');
const asyncHandler = require('../middleware/asyncHandler');
const { period } = require('./ads');
const { buildMapData } = require('./map');
const { inBundle } = require('./bundles');
const { link } = require('./creatives');
const c2 = require('../channels/content2');
const { verdict, LABEL } = require('../lib/verdict');
const { round2 } = require('../lib/money');

const router = express.Router();

router.get('/map/plan', asyncHandler(async (req, res) => {
  const p = period(req.query);
  const project = req.project;
  const data = await buildMapData(project, p, { all: true });
  const where = { projectId: project.id, ...(req.query.bundle ? { id: String(req.query.bundle) } : {}) };
  const bundles = await db.bundle.findMany({ where, include: { audience: true }, orderBy: { createdAt: 'asc' } });
  const meta = await db.connection.count({ where: { projectId: project.id, channel: 'meta', secretRead: { not: null } } });

  // Креативи з контент-платформи: якщо вона не підключена, план усе одно працює (без картинок).
  let creatives = []; let contentConnected = false; let contentError = null;
  try { const l = await link(project); creatives = await c2.creatives(l.url, l.key, l.pid, 200); contentConnected = true; } catch (e) { contentError = e.message; }
  const byId = new Map(creatives.map((c) => [c.id, c]));

  const elByKey = new Map(data.elements.map((e) => [e.key, e]));
  const allAds = data.campaigns.flatMap((c) => c.adSets.flatMap((s) => s.ads.map((a) => ({ ...a, campaign: c.name }))));
  const target = data.target;

  const lanes = bundles.map((b) => {
    const ads = allAds.filter((a) => inBundle(a.campaign, b.code));
    const adIds = ads.map((a) => a.externalId);
    const hasAds = ads.length > 0;
    const path = (Array.isArray(b.path) ? b.path : []).map((x) => {
      const el = x.key && elByKey.get(x.key);
      if (!el) return { kind: 'note', key: x.key || null, note: x.note || '' };
      return {
        kind: 'element', note: x.note || '',
        element: { key: el.key, type: el.type, name: el.name, domain: el.domain, steps: el.steps.map((s) => ({ key: s.key, title: s.title, order: s.order, branch: s.branch, isSale: s.isSale, leadsTo: s.leadsTo, people: hasAds ? adIds.reduce((n, id) => n + (s.byAd[id] || 0), 0) : null })) },
      };
    });
    const ids = Array.isArray(b.creativeIds) ? b.creativeIds : [];
    const planned = ids.map((id) => byId.get(id)).filter(Boolean);
    const spend = ads.reduce((s, a) => s + a.spend, 0); const sales = ads.reduce((s, a) => s + a.sales, 0);
    const revenue = ads.reduce((s, a) => s + a.revenue, 0); const upsell = ads.reduce((s, a) => s + (a.upsellRevenue || 0), 0);
    const state = hasAds ? verdict({ spend, sales, target }) : 'none';
    return {
      bundle: { id: b.id, name: b.name, code: b.code, status: b.status, promise: b.promise, angle: b.angle, hypothesis: b.hypothesis, audience: b.audience ? { id: b.audience.id, name: b.audience.name } : null, testBudgetUsd: b.testBudgetUsd === null ? null : Number(b.testBudgetUsd) },
      creatives: planned, creativeIds: ids, missingCreatives: ids.length - planned.length,
      ads, path,
      metrics: { hasAds, spend: round2(spend), sales, revenue: round2(revenue), upsellRevenue: round2(upsell), saleCost: sales ? round2(spend / sales) : null, state, stateLabel: hasAds ? LABEL[state] : 'ще нема даних з реклами' },
    };
  });
  res.json({ ok: true, data: { from: p.from, to: p.to, target, metaConnected: meta > 0, contentConnected, contentError, lanes } });
}));

module.exports = router;
