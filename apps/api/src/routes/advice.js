// Рекомендації і щоденний звіт. Лише читання: нічого в рекламному кабінеті не змінюють.
const express = require('express');
const { db } = require('@ads/db');
const asyncHandler = require('../middleware/asyncHandler');
const { period } = require('./ads');
const { buildMapData } = require('./map');
const { inBundle } = require('./bundles');
const { buildAdvice, dailyReportText } = require('../lib/advice');
const { toUah, round2 } = require('../lib/money');

const router = express.Router();

async function gather(project, q) {
  const p = period(q);
  const map = await buildMapData(project, p, { all: false });
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const [todayRows, connections] = await Promise.all([
    db.insightDaily.groupBy({ by: ['currency'], where: { date: today, ad: { projectId: project.id } }, _sum: { spend: true } }),
    db.connection.findMany({ where: { projectId: project.id }, select: { name: true, status: true, lastError: true } }),
  ]);
  const todaySpend = round2(todayRows.reduce((a, r) => a + toUah(Number(r._sum.spend || 0), r.currency, project), 0));
  const limit = round2(Number(project.dailyLimitUsd) * Number(project.usdRate));
  const advice = buildAdvice(map, { project, overview: { todaySpend, limit }, connections });
  return { p, map, advice, todaySpend, limit };
}

router.get('/advice', asyncHandler(async (req, res) => {
  const { p, advice } = await gather(req.project, req.query);
  res.json({ ok: true, data: { from: p.from, to: p.to, items: advice } });
}));

// Готовий текст для Telegram: воронка Flows лише забирає його й надсилає. Параметр days — за скільки днів зведення (за замовчуванням 1 = вчора).
router.get('/report/daily', asyncHandler(async (req, res) => {
  const days = Math.max(1, Math.min(14, Number(req.query.days) || 1));
  const end = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { map, advice, todaySpend, limit } = await gather(req.project, { from: start, to: end });
  const camps = map.campaigns;
  const spend = camps.reduce((s, c) => s + c.spend, 0); const sales = camps.reduce((s, c) => s + c.sales, 0); const revenue = camps.reduce((s, c) => s + c.revenue, 0);
  const linkClicks = camps.reduce((s, c) => s + c.adSets.reduce((b, st) => b + st.ads.reduce((q, a) => q + a.linkClicks, 0), 0), 0);
  const rate = Number(req.project.usdRate) || 42;
  const bundles = (await db.bundle.findMany({ where: { projectId: req.project.id, status: { in: ['test', 'works', 'scale'] } } })).map((b) => {
    const mine = camps.filter((c) => inBundle(c.name, b.code));
    const bs = mine.reduce((q, c) => q + c.spend, 0); const bn = mine.reduce((q, c) => q + c.sales, 0);
    const budget = b.testBudgetUsd === null ? null : Number(b.testBudgetUsd);
    return { name: b.name, code: b.code, status: b.status, metrics: { spend: bs, sales: bn, budgetUsedPct: budget ? Math.round((bs / rate / budget) * 100) : null } };
  });
  const totals = { spend, linkClicks, sales, revenue, saleCost: sales ? round2(spend / sales) : null, target: map.target, todaySpend, todayLimit: limit };
  const label = start === end ? end : `${start} — ${end}`;
  res.json({ ok: true, data: { empty: camps.length === 0, text: dailyReportText(req.project, label, totals, advice, bundles), adviceCount: advice.filter((i) => i.severity !== 'info').length, chatId: req.project.reportChatId || null } });
}));

module.exports = router;
