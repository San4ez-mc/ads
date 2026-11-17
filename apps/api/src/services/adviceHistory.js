// Історія порад: запам'ятовуємо, що радили, а через 7 днів дописуємо, що сталось. Так видно, чи порадам можна довіряти.
const { db } = require('@ads/db');
const { toUah, round2 } = require('../lib/money');
const { saleSteps } = require('../lib/sales');

const TRACKED = new Set(['pause', 'scale', 'watch', 'funnel', 'no_clicks']);
const DAY = 86400000;
const EVAL_AFTER_DAYS = 7;
const REPEAT_AFTER_DAYS = 14; // однакову пораду по тому ж оголошенню не записуємо частіше

const allAds = (map) => map.campaigns.flatMap((c) => c.adSets.flatMap((s) => s.ads));

/** Записує нові поради (по одній на оголошення і вид у межах 14 днів). Викликається при розрахунку порад і щоденного звіту. */
async function record(project, items, map) {
  const ads = new Map(allAds(map).map((a) => [a.externalId, a]));
  const since = new Date(Date.now() - REPEAT_AFTER_DAYS * DAY);
  const existing = await db.adviceLog.findMany({ where: { projectId: project.id, createdAt: { gte: since } }, select: { key: true } });
  const seen = new Set(existing.map((e) => e.key));
  let created = 0;
  for (const i of items) {
    if (!i.ad || !TRACKED.has(i.kind)) continue;
    const key = `${i.kind}:${i.ad}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = ads.get(i.ad);
    await db.adviceLog.create({ data: { projectId: project.id, key, kind: i.kind, adExtId: i.ad, adName: a?.name || null, title: i.title, preliminary: !!i.preliminary, snapshot: a ? { spend: a.spend, sales: a.sales, saleCost: a.saleCost, status: a.effectiveStatus, running: a.running } : {} } });
    created += 1;
  }
  return created;
}

/** Дописує підсумок до порад, яким минув тиждень. */
async function evaluate(project) {
  const due = await db.adviceLog.findMany({ where: { projectId: project.id, evaluatedAt: null, createdAt: { lte: new Date(Date.now() - EVAL_AFTER_DAYS * DAY) } }, take: 50 });
  if (!due.length) return 0;
  const sale = await saleSteps(project.id);
  let n = 0;
  for (const log of due) {
    const ad = await db.ad.findFirst({ where: { projectId: project.id, externalId: log.adExtId } });
    const from = new Date(`${log.createdAt.toISOString().slice(0, 10)}T00:00:00Z`);
    const sums = ad ? await db.insightDaily.groupBy({ by: ['currency'], where: { adId: ad.id, date: { gte: from } }, _sum: { spend: true } }) : [];
    const spendSince = round2(sums.reduce((a, r) => a + toUah(Number(r._sum.spend || 0), r.currency, project), 0));
    const ev = await db.stepEvent.groupBy({ by: ['elementType', 'elementRef', 'stepKey'], where: { projectId: project.id, isTest: false, adExtId: log.adExtId, ts: { gte: log.createdAt } }, _count: { _all: true } });
    const salesSince = ev.filter((e) => sale.has(e.elementType, e.elementRef, e.stepKey)).reduce((a, e) => a + e._count._all, 0);
    const paused = !!ad && (ad.status === 'PAUSED' || ad.effectiveStatus === 'PAUSED');
    const before = log.snapshot || {};
    const perWeekBefore = before.spend ? round2(before.spend) : null;
    let text; let followed = null;
    if (log.kind === 'pause') {
      followed = paused;
      text = paused ? `Вимкнули. Витрати зупинились${perWeekBefore ? ` (до поради за період було ${perWeekBefore} грн)` : ''}.` : `Не вимкнули: за тиждень витрачено ще ${spendSince} грн, продажів ${salesSince}${salesSince ? `, ціна продажу ${round2(spendSince / salesSince)} грн` : ''}.`;
    } else {
      const costNow = salesSince ? round2(spendSince / salesSince) : null;
      const trend = before.saleCost && costNow ? (costNow < before.saleCost * 0.9 ? 'ціна продажу знизилась' : costNow > before.saleCost * 1.1 ? 'ціна продажу зросла' : 'ціна продажу майже та сама') : 'порівняти нічого';
      text = `За тиждень: витрачено ${spendSince} грн, продажів ${salesSince}${costNow ? `, ціна продажу ${costNow} грн` : ''}${before.saleCost ? ` (було ${before.saleCost} грн)` : ''}: ${trend}.`;
    }
    await db.adviceLog.update({ where: { id: log.id }, data: { evaluatedAt: new Date(), outcome: { text, followed, spendSince, salesSince, paused } } });
    n += 1;
  }
  return n;
}

async function list(project, take = 40) {
  const rows = await db.adviceLog.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take });
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, adName: r.adName, preliminary: r.preliminary, createdAt: r.createdAt, evaluatedAt: r.evaluatedAt, outcome: r.outcome }));
}

module.exports = { record, evaluate, list };
