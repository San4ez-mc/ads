// Оголошення зі статистикою, зведення, запуск синхронізації, журнал.
const express = require('express');
const { db } = require('@ads/db');
const { ValidationError } = require('@ads/errors');
const asyncHandler = require('../middleware/asyncHandler');
const { runProjectSync } = require('../services/sync');
const { logAction } = require('../services/journal');
const { toUah, round2 } = require('../lib/money');
const { saleSteps, isPayment, countClients } = require('../lib/sales');
const describe = require('../lib/describe');
const { localDate, eventRange } = require('../lib/days');

const router = express.Router();

/** Період із запиту: from/to YYYY-MM-DD включно; за замовчуванням останні 7 днів. Колонка-дата — порівнюємо датами, не моментами. */
function period(q) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const today = localDate();
  const to = re.test(q.to || '') ? q.to : today;
  const from = re.test(q.from || '') ? q.from : new Date(new Date(`${to}T00:00:00Z`).getTime() - 6 * 86400000).toISOString().slice(0, 10);
  if (from > to) throw new ValidationError('Початок періоду пізніше за кінець');
  return { from, to, gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
}

const running = (s) => s === 'ACTIVE';

async function adRows(project, p, { onlyActive } = {}) {
  // Один агрегований запит на всі оголошення (не запит у циклі).
  const sums = await db.insightDaily.groupBy({ by: ['adId', 'currency'], where: { date: { gte: p.gte, lte: p.lte }, ad: { projectId: project.id } }, _sum: { spend: true, impressions: true, clicks: true, linkClicks: true, reach: true } });
  const byAd = new Map();
  for (const s of sums) {
    const cur = byAd.get(s.adId) || { spendUah: 0, impressions: 0, clicks: 0, linkClicks: 0 };
    cur.spendUah += toUah(Number(s._sum.spend || 0), s.currency, project);
    cur.impressions += s._sum.impressions || 0; cur.clicks += s._sum.clicks || 0; cur.linkClicks += s._sum.linkClicks || 0;
    byAd.set(s.adId, cur);
  }
  const ads = await db.ad.findMany({ where: { projectId: project.id }, include: { campaign: { select: { id: true, name: true, externalId: true } }, adSet: { select: { id: true, name: true, externalId: true, dailyBudget: true, learningStage: true, targeting: true } } }, orderBy: { extCreatedAt: 'desc' } });
  // Продажі й кроки з наших джерел (сайт тощо) за номером оголошення.
  const steps = await db.stepEvent.groupBy({ by: ['adExtId', 'stepKey', 'elementType', 'elementRef'], where: { projectId: project.id, isTest: false, adExtId: { not: null }, ts: eventRange(p.from, p.to, project.timezone) }, _count: { _all: true }, _sum: { amount: true } });
  const sale = await saleSteps(project.id);
  const byExt = new Map();
  for (const s of steps) {
    const cur = byExt.get(s.adExtId) || { steps: {}, sales: 0, revenue: 0, upsellRevenue: 0, upsellCount: 0 };
    if (s.elementType === 'manual' && s.stepKey === 'upsell') { cur.upsellRevenue += Number(s._sum.amount || 0); cur.upsellCount += s._count._all; }
    cur.steps[s.stepKey] = (cur.steps[s.stepKey] || 0) + s._count._all;
    if (sale.has(s.elementType, s.elementRef, s.stepKey)) cur.revenue += sale.amountOf(s.elementType, s.elementRef, s.stepKey, s._count._all, s._sum.amount);
    byExt.set(s.adExtId, cur);
  }
  // sales = клієнти (люди, які заплатили), а не кількість подій: оплат мало, тож читаємо їх поіменно ключами.
  const payKeys = [...new Set(steps.filter((s) => isPayment(sale, s)).map((s) => s.stepKey))];
  const paid = payKeys.length ? await db.stepEvent.findMany({ where: { projectId: project.id, isTest: false, adExtId: { not: null }, stepKey: { in: payKeys }, ts: eventRange(p.from, p.to, project.timezone) }, select: { adExtId: true, personKey: true, sourceId: true, stepKey: true, elementType: true, elementRef: true } }) : [];
  for (const [adExtId, f] of byExt) f.sales = countClients(sale, paid.filter((e) => e.adExtId === adExtId));
  return ads.map((a) => {
    const m = byAd.get(a.id) || { spendUah: 0, impressions: 0, clicks: 0, linkClicks: 0 };
    const f = byExt.get(a.externalId) || { steps: {}, sales: 0, revenue: 0, upsellRevenue: 0, upsellCount: 0 };
    return {
      id: a.id, externalId: a.externalId, name: a.name, channel: a.channel, status: a.status, effectiveStatus: a.effectiveStatus, running: running(a.effectiveStatus),
      campaign: a.campaign, adSet: { id: a.adSet.id, name: a.adSet.name, externalId: a.adSet.externalId, dailyBudget: a.adSet.dailyBudget === null ? null : Number(a.adSet.dailyBudget), learningStage: a.adSet.learningStage, audience: describe.audience(a.adSet.targeting), placements: describe.placements(a.adSet.targeting) },
      creative: { title: a.title, body: a.body, imageUrl: a.imageUrl, thumbnailUrl: a.thumbnailUrl, videoId: a.videoId, linkUrl: a.linkUrl, cta: a.cta, previewUrl: a.previewUrl },
      createdAt: a.extCreatedAt,
      creativeKey: a.content2PostId || `ad:${a.externalId}`,
      spend: round2(m.spendUah), impressions: m.impressions, clicks: m.clicks, linkClicks: m.linkClicks,
      cpc: m.linkClicks ? round2(m.spendUah / m.linkClicks) : null, ctr: m.impressions ? round2((m.linkClicks / m.impressions) * 100) : null,
      steps: f.steps, sales: f.sales, revenue: round2(f.revenue), upsellRevenue: round2(f.upsellRevenue), upsellCount: f.upsellCount, saleCost: f.sales ? round2(m.spendUah / f.sales) : null,
    };
  }).filter((r) => !onlyActive || r.running || r.spend > 0);
}

router.get('/ads', asyncHandler(async (req, res) => {
  const p = period(req.query);
  const rows = await adRows(req.project, p, { onlyActive: req.query.all !== '1' });
  res.json({ ok: true, data: { from: p.from, to: p.to, currency: 'UAH', ads: rows } });
}));

router.get('/overview', asyncHandler(async (req, res) => {
  const p = period(req.query);
  const rows = await adRows(req.project, p, {});
  const t = rows.reduce((a, r) => ({ spend: a.spend + r.spend, impressions: a.impressions + r.impressions, linkClicks: a.linkClicks + r.linkClicks, sales: a.sales + r.sales, revenue: a.revenue + r.revenue }), { spend: 0, impressions: 0, linkClicks: 0, sales: 0, revenue: 0 });
  const today = new Date(`${localDate(new Date(), req.project.timezone)}T00:00:00Z`);
  const todayRows = await db.insightDaily.groupBy({ by: ['currency'], where: { date: today, ad: { projectId: req.project.id } }, _sum: { spend: true } });
  const spentTodayUah = todayRows.reduce((a, r) => a + toUah(Number(r._sum.spend || 0), r.currency, req.project), 0);
  const limitUah = Number(req.project.dailyLimitUsd) * Number(req.project.usdRate);
  const [connections, lastRun] = await Promise.all([
    db.connection.findMany({ where: { projectId: req.project.id }, select: { id: true, channel: true, name: true, status: true, lastSyncAt: true, lastError: true, config: true } }),
    db.syncRun.findFirst({ where: { projectId: req.project.id }, orderBy: { startedAt: 'desc' } }),
  ]);
  res.json({ ok: true, data: {
    from: p.from, to: p.to, currency: 'UAH',
    totals: { spend: round2(t.spend), impressions: t.impressions, linkClicks: t.linkClicks, sales: t.sales, revenue: round2(t.revenue), saleCost: t.sales ? round2(t.spend / t.sales) : null, cpc: t.linkClicks ? round2(t.spend / t.linkClicks) : null },
    counts: { ads: rows.length, running: rows.filter((r) => r.running).length },
    today: { spend: round2(spentTodayUah), limit: round2(limitUah), limitUsd: Number(req.project.dailyLimitUsd), overLimit: limitUah > 0 && spentTodayUah > limitUah },
    target: req.project.targetSaleCost === null ? null : Number(req.project.targetSaleCost),
    // Налаштування підключень назовні не віддаємо: лише чи призупинені звернення.
    connections: connections.map(({ config, ...c }) => ({ ...c, paused: !!config?.paused })), lastSync: lastRun ? { kind: lastRun.kind, status: lastRun.status, at: lastRun.finishedAt || lastRun.startedAt, error: lastRun.error } : null,
  } });
}));

// Одна синхронізація на проєкт за раз: захист від подвійного запуску (крон + кнопка) і від зайвих звернень до Meta.
const inFlight = new Map();
router.post('/sync/run', asyncHandler(async (req, res) => {
  const id = req.project.id;
  if (inFlight.has(id)) return void res.status(409).json({ ok: false, error: { code: 'CONFLICT', message: 'Синхронізація вже йде, зачекайте' } });
  const kinds = Array.isArray(req.body?.kinds) && req.body.kinds.length ? req.body.kinds.filter((k) => ['structure', 'insights', 'site', 'flows', 'calendar'].includes(k)) : undefined;
  const days = Number(req.body?.days) || 7;
  const job = runProjectSync(id, { kinds, days }).finally(() => inFlight.delete(id));
  inFlight.set(id, job);
  const result = await job;
  await logAction(id, req.actor, 'sync_run', { after: { ok: result.ok, results: result.results.map((r) => ({ kind: r.kind, ok: r.ok, error: r.error })) } });
  res.json({ ok: true, data: result });
}));

router.get('/sync/runs', asyncHandler(async (req, res) => {
  const runs = await db.syncRun.findMany({ where: { projectId: req.project.id }, orderBy: { startedAt: 'desc' }, take: 30 });
  res.json({ ok: true, data: { runs } });
}));

router.get('/journal', asyncHandler(async (req, res) => {
  const rows = await db.actionLog.findMany({ where: { projectId: req.project.id }, orderBy: { createdAt: 'desc' }, take: Math.min(200, Number(req.query.limit) || 100) });
  res.json({ ok: true, data: { actions: rows } });
}));

module.exports = router;
module.exports.adRows = adRows;
module.exports.period = period;
