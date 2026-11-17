// Дані для карти: креативи (кампанія → група → оголошення) + елементи шляху з кроками й кількістю людей у розрізі оголошень.
// Розкладку малює сторінка; тут лише цифри. Один запит на все (жодних запитів у циклі).
const express = require('express');
const { Prisma } = require('@prisma/client');
const { db } = require('@ads/db');
const asyncHandler = require('../middleware/asyncHandler');
const { adRows, period } = require('./ads');
const { verdict, LABEL } = require('../lib/verdict');
const { round2 } = require('../lib/money');
const { saleSteps } = require('../lib/sales');
const { inBundle } = require('./bundles');

const router = express.Router();
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

/** Дані карти як функція: їх же читають рекомендації й звіти. */
async function buildMapData(project, p, { all = false, bundleId = null } = {}) {
  const target = project.targetSaleCost === null ? null : Number(project.targetSaleCost);
  const bundle = bundleId ? await db.bundle.findFirst({ where: { id: String(bundleId), projectId: project.id } }) : null;
  const [allRows, allElements, counts] = await Promise.all([
    adRows(project, p, { onlyActive: !all }),
    db.element.findMany({ where: { projectId: project.id }, include: { steps: true }, orderBy: { createdAt: 'asc' } }),
    // Унікальні люди на кроці в розрізі оголошення; без person_key — рахуємо подію як окрему людину.
    db.$queryRaw(Prisma.sql`
      SELECT element_type AS "type", element_ref AS "ref", step_key AS "step", ad_ext_id AS "ad",
             count(DISTINCT coalesce(person_key, source_id))::int AS "people", coalesce(sum(amount), 0)::float AS "amount"
      FROM step_events
      WHERE project_id = ${project.id} AND is_test = false AND ts >= ${p.gte} AND ts < ${new Date(p.lte.getTime() + 86400000)}
      GROUP BY 1, 2, 3, 4`),
  ]);

  const sale = await saleSteps(project.id);
  // Сума за замовчуванням для продажів без суми (етап бота «Оплатив»).
  for (const c of counts) if (sale.has(c.type, c.ref, c.step)) c.amount = sale.amountOf(c.type, c.ref, c.step, c.people, c.amount);
  const rows = bundle ? allRows.filter((a) => inBundle(a.campaign.name, bundle.code)) : allRows;
  const pathKeys = bundle && Array.isArray(bundle.path) ? bundle.path.map((x) => x.key).filter(Boolean) : [];
  const elements = pathKeys.length ? allElements.filter((e) => pathKeys.includes(`${e.type}:${e.ref}`)) : allElements;
  const byStep = new Map();
  const adsInElement = new Map();
  for (const c of counts) {
    const ek = `${c.type}:${c.ref}`; const k = `${ek}|${c.step}`;
    const cur = byStep.get(k) || { total: 0, unknown: 0, amount: 0, byAd: {}, amountByAd: {} };
    cur.total += c.people; cur.amount += c.amount;
    if (c.ad) { cur.byAd[c.ad] = (cur.byAd[c.ad] || 0) + c.people; cur.amountByAd[c.ad] = (cur.amountByAd[c.ad] || 0) + c.amount; if (!adsInElement.has(c.ad)) adsInElement.set(c.ad, new Map()); const m = adsInElement.get(c.ad); m.set(ek, (m.get(ek) || 0) + c.people); } else cur.unknown += c.people;
    byStep.set(k, cur);
  }

  const els = elements.map((e) => {
    const key = `${e.type}:${e.ref}`;
    return {
      key, type: e.type, name: e.name, domain: e.config?.domain || null,
      steps: e.steps.sort((a, b) => a.order - b.order || String(a.branch || '').localeCompare(String(b.branch || ''))).map((s) => {
        const c = byStep.get(`${key}|${s.key}`) || { total: 0, unknown: 0, amount: 0, byAd: {}, amountByAd: {} };
        return { key: s.key, title: s.title, order: s.order, branch: s.branch, isSale: s.isSale, leadsTo: s.leadsTo, total: c.total, unknown: c.unknown, amount: round2(c.amount), byAd: c.byAd, amountByAd: c.amountByAd };
      }),
    };
  });

  // Куди веде оголошення: 1) туди, де є його події; 2) за адресою посилання (домен сайту); 3) невідомо.
  const byDomain = new Map(els.filter((e) => e.domain).map((e) => [String(e.domain).replace(/^www\./, ''), e.key]));
  const entryOf = (a) => {
    const seen = adsInElement.get(a.externalId);
    if (seen && seen.size) return [...seen.entries()].sort((x, y) => y[1] - x[1])[0][0];
    return byDomain.get(host(a.creative.linkUrl)) || null;
  };

  const camps = new Map();
  for (const a of rows) {
    if (!camps.has(a.campaign.id)) camps.set(a.campaign.id, { id: a.campaign.id, name: a.campaign.name, spend: 0, sales: 0, revenue: 0, adSets: new Map() });
    const c = camps.get(a.campaign.id);
    if (!c.adSets.has(a.adSet.id)) c.adSets.set(a.adSet.id, { ...a.adSet, ads: [] });
    const v = verdict({ spend: a.spend, sales: a.sales, target });
    c.adSets.get(a.adSet.id).ads.push({ id: a.id, externalId: a.externalId, name: a.name, effectiveStatus: a.effectiveStatus, running: a.running, creative: a.creative, spend: a.spend, impressions: a.impressions, linkClicks: a.linkClicks, cpc: a.cpc, ctr: a.ctr, sales: a.sales, revenue: a.revenue, upsellRevenue: a.upsellRevenue, upsellCount: a.upsellCount, saleCost: a.saleCost, verdict: v, verdictLabel: LABEL[v], entry: entryOf(a) });
    c.spend += a.spend; c.sales += a.sales; c.revenue += a.revenue;
  }
  const campaigns = [...camps.values()].map((c) => ({ id: c.id, name: c.name, spend: round2(c.spend), sales: c.sales, revenue: round2(c.revenue), saleCost: c.sales ? round2(c.spend / c.sales) : null, verdict: verdict({ spend: c.spend, sales: c.sales, target }), adSets: [...c.adSets.values()] })).sort((a, b) => b.spend - a.spend);

  return { from: p.from, to: p.to, currency: 'UAH', target, bundle: bundle ? { id: bundle.id, name: bundle.name, code: bundle.code } : null, campaigns, elements: els };
}

router.get('/map', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await buildMapData(req.project, period(req.query), { all: req.query.all === '1', bundleId: req.query.bundle || null }) });
}));

module.exports = router;
module.exports.buildMapData = buildMapData;
