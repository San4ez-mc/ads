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
const { rulesOf } = require('../lib/rules');
const { round2 } = require('../lib/money');
const { withPain, PAINS } = require('../lib/pains');

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
    const state = hasAds ? verdict({ spend, sales, target, rules: rulesOf(req.project) }) : 'none';
    return {
      bundle: { id: b.id, name: b.name, code: b.code, status: b.status, promise: b.promise, angle: b.angle, hypothesis: b.hypothesis, audience: b.audience ? { id: b.audience.id, name: b.audience.name } : null, testBudgetUsd: b.testBudgetUsd === null ? null : Number(b.testBudgetUsd) },
      creatives: planned, creativeIds: ids, missingCreatives: ids.length - planned.length,
      ads, path,
      metrics: { hasAds, spend: round2(spend), sales, revenue: round2(revenue), upsellRevenue: round2(upsell), saleCost: sales ? round2(spend / sales) : null, state, stateLabel: hasAds ? LABEL[state] : 'ще нема даних з реклами' },
    };
  });
  res.json({ ok: true, data: { from: p.from, to: p.to, target, metaConnected: meta > 0, contentConnected, contentError, lanes } });
}));

/** Карта креативів: усі креативи контент-платформи, згруповані за аудиторією (персоною) і болем, з позначкою, у яких воронках вони вже стоять. */
router.get('/map/creatives', asyncHandler(async (req, res) => {
  const project = req.project;
  const l = await link(project);
  const [creatives, bundles, audiences] = await Promise.all([
    c2.creatives(l.url, l.key, l.pid, 200),
    db.bundle.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } }),
    db.audience.findMany({ where: { projectId: project.id } }),
  ]);
  const usage = new Map();
  for (const b of bundles) for (const id of (Array.isArray(b.creativeIds) ? b.creativeIds : [])) usage.set(id, [...(usage.get(id) || []), { id: b.id, code: b.code, name: b.name }]);
  const audByName = new Map(audiences.map((a) => [a.name.trim().toLowerCase(), a]));
  const groups = new Map(); // «персона|код болю» → блок
  for (const raw of creatives) {
    const c = withPain(raw);
    const pain = c.pain; const personaName = pain ? pain.persona : null;
    const aud = personaName ? audByName.get(personaName.trim().toLowerCase()) : null;
    const key = `${personaName || ''}|${pain ? pain.code : ''}`;
    if (!groups.has(key)) groups.set(key, { audience: personaName ? { id: aud ? aud.id : null, name: personaName } : null, pain: pain ? { code: pain.code, title: pain.title } : null, creatives: [] });
    groups.get(key).creatives.push({ id: c.id, number: c.number, status: c.status, mediaType: c.mediaType, mediaUrl: c.mediaUrl, hook: c.hook, topic: c.topic, text: (c.text || '').replace(/^Основний текст:\s*/i, '').slice(0, 140), bundles: usage.get(c.id) || [] });
  }
  // Заплановані болі без креативів: порожні блоки на карті з готовим текстом для замовлення.
  for (const [code, p] of Object.entries(PAINS)) {
    if (!p.planned) continue;
    const key = `${p.persona}|${code}`;
    if (groups.has(key)) continue; // на цей біль креативи вже є
    const aud = audByName.get(p.persona.trim().toLowerCase());
    groups.set(key, { audience: { id: aud ? aud.id : null, name: p.persona }, pain: { code, title: p.title, planned: true, orderNote: `Біль: «${p.title}». Аудиторія: ${p.persona}. Креативів на цей біль ще нема.` }, creatives: [] });
  }
  const list = [...groups.values()].sort((a, b) => (a.audience ? 0 : 1) - (b.audience ? 0 : 1) || String(a.audience?.name).localeCompare(String(b.audience?.name), 'uk') || String(a.pain?.code).localeCompare(String(b.pain?.code)));
  for (const g of list) g.creatives.sort((a, b) => b.number - a.number);
  res.json({ ok: true, data: { groups: list, total: creatives.length, inFunnels: creatives.filter((c) => usage.has(c.id)).length } });
}));

module.exports = router;
