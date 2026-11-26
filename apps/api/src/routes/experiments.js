// «Історія»: кожен варіант воронки, який тестували або плануємо, що в ньому змінили, цифри й висновок.
// Щоб не тестувати те саме двічі: однаковий набір (аудиторія, біль, пропозиція, креатив, сайт, бот) платформа не дає завести
// без явної згоди. Тест не закривається без висновку; при закритті цифри «заморожуються» й лишаються, навіть коли оголошення зникнуть.
const express = require('express');
const { db } = require('@ads/db');
const { NotFoundError, ValidationError, ConflictError } = require('@ads/errors');
const asyncHandler = require('../middleware/asyncHandler');
const { logAction } = require('../services/journal');
const { toUah, round2 } = require('../lib/money');
const { saleSteps, isPayment, countClients } = require('../lib/sales');

const router = express.Router();
const STATUSES = ['planned', 'running', 'won', 'lost', 'stopped'];
const CLOSED = ['won', 'lost', 'stopped'];
const TEXT = { title: 200, hypothesis: 2000, changed: 600, audience: 300, pain: 300, offer: 300, creative: 600, site: 300, bot: 300, conclusion: 4000 };
const SAME = ['audience', 'pain', 'offer', 'creative', 'site', 'bot'];
const date = (s) => new Date(`${s}T00:00:00Z`);
const day = (d) => (d ? d.toISOString().slice(0, 10) : null);

const fingerprint = (e) => SAME.map((k) => String(e[k] || '').toLowerCase().replace(/[«»"'.,;:!?()\s]+/g, ' ').trim()).join('|');

function parse(b, { partial } = {}) {
  const data = {};
  for (const [k, max] of Object.entries(TEXT)) if (b[k] !== undefined) data[k] = String(b[k] ?? '').trim().slice(0, max) || null;
  if (!partial || b.title !== undefined) { if (!data.title) throw new ValidationError('Назва тесту обовʼязкова'); }
  if (b.code !== undefined) { const c = String(b.code || '').trim().slice(0, 12); if (!c) throw new ValidationError('Короткий код варіанта, наприклад V1'); data.code = c; } else if (!partial) throw new ValidationError('Короткий код варіанта, наприклад V1');
  if (b.adExtIds !== undefined) data.adExtIds = [...new Set((Array.isArray(b.adExtIds) ? b.adExtIds : []).map(String).filter((x) => /^\d{3,30}$/.test(x)))].slice(0, 30);
  for (const k of ['dateFrom', 'dateTo']) if (b[k] !== undefined) { if (b[k] && !/^\d{4}-\d{2}-\d{2}$/.test(b[k])) throw new ValidationError('Дата у форматі РРРР-ММ-ДД'); data[k] = b[k] ? date(b[k]) : null; }
  if (b.budgetUah !== undefined) { const n = b.budgetUah === null || b.budgetUah === '' ? null : Number(b.budgetUah); if (n !== null && !(n >= 0)) throw new ValidationError('Бюджет — число від 0'); data.budgetUah = n; }
  if (b.parentId !== undefined) data.parentId = b.parentId ? String(b.parentId) : null;
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw new ValidationError(`Стан: ${STATUSES.join(', ')}`); data.status = b.status; }
  return data;
}

/** Цифри варіанта з наших даних: витрати його оголошень і люди на кроках, яких вони привели. */
async function measure(project, e) {
  const ids = Array.isArray(e.adExtIds) ? e.adExtIds : [];
  if (!ids.length || !e.dateFrom) return null;
  const to = e.dateTo || date(new Date().toISOString().slice(0, 10));
  const [sums, events, elements] = await Promise.all([
    db.insightDaily.groupBy({ by: ['currency'], where: { date: { gte: e.dateFrom, lte: to }, ad: { projectId: project.id, externalId: { in: ids } } }, _sum: { spend: true, impressions: true, linkClicks: true } }),
    db.stepEvent.findMany({ where: { projectId: project.id, isTest: false, adExtId: { in: ids }, ts: { gte: e.dateFrom, lt: new Date(to.getTime() + 86400000) } }, select: { elementType: true, elementRef: true, stepKey: true, personKey: true, sourceId: true, amount: true } }),
    db.element.findMany({ where: { projectId: project.id }, include: { steps: true } }),
  ]);
  const people = new Map();
  for (const x of events) { const k = `${x.elementType}:${x.elementRef}|${x.stepKey}`; if (!people.has(k)) people.set(k, new Set()); people.get(k).add(x.personKey || x.sourceId); }
  const steps = [];
  for (const el of elements) for (const s of [...el.steps].sort((a, b) => a.order - b.order)) { const set = people.get(`${el.type}:${el.ref}|${s.key}`); if (set) steps.push({ element: el.name, title: s.title, people: set.size }); }
  const spend = round2(sums.reduce((a, r) => a + toUah(Number(r._sum.spend || 0), r.currency, project), 0));
  const sale = await saleSteps(project.id);
  const clients = countClients(sale, events);
  const revenue = round2(events.filter((x) => isPayment(sale, x)).reduce((a, x) => a + sale.amountOf(x.elementType, x.elementRef, x.stepKey, 1, x.amount), 0));
  return {
    spend, clients, clientCost: clients ? round2(spend / clients) : null, revenue,
    impressions: sums.reduce((a, r) => a + (r._sum.impressions || 0), 0), linkClicks: sums.reduce((a, r) => a + (r._sum.linkClicks || 0), 0), steps,
  };
}

const view = (e, result) => ({
  id: e.id, code: e.code, title: e.title, status: e.status, hypothesis: e.hypothesis, changed: e.changed, audience: e.audience, pain: e.pain, offer: e.offer, creative: e.creative, site: e.site, bot: e.bot,
  adExtIds: e.adExtIds, dateFrom: day(e.dateFrom), dateTo: day(e.dateTo), budgetUah: e.budgetUah === null ? null : Number(e.budgetUah), conclusion: e.conclusion, parentId: e.parentId, result, frozen: !!e.result,
});

router.get('/experiments', asyncHandler(async (req, res) => {
  const rows = await db.experiment.findMany({ where: { projectId: req.project.id }, orderBy: [{ createdAt: 'asc' }, { code: 'asc' }] });
  const out = [];
  for (const e of rows) out.push(view(e, e.result || await measure(req.project, e))); // десятки записів, не тисячі: по черзі цілком досить
  res.json({ ok: true, data: { experiments: out } });
}));

async function guardDuplicate(projectId, next, selfId, force) {
  if (force || !SAME.some((k) => next[k])) return;
  const all = await db.experiment.findMany({ where: { projectId, id: { not: selfId || '' } } });
  const twin = all.find((e) => fingerprint(e) === fingerprint(next));
  if (twin) throw new ConflictError(`Такий самий варіант уже є: ${twin.code} «${twin.title}»${twin.conclusion ? `. Висновок тоді: ${twin.conclusion}` : ''}`);
}

router.post('/experiments', asyncHandler(async (req, res) => {
  const data = parse(req.body || {});
  if (CLOSED.includes(data.status)) throw new ValidationError('Новий тест не може бути вже закритим');
  if (await db.experiment.findFirst({ where: { projectId: req.project.id, code: data.code } })) throw new ConflictError(`Код ${data.code} уже зайнятий`);
  await guardDuplicate(req.project.id, data, null, req.body?.force === true);
  const e = await db.experiment.create({ data: { ...data, projectId: req.project.id } });
  await logAction(req.project.id, req.actor, 'experiment_added', { target: `${e.code} ${e.title}` });
  res.status(201).json({ ok: true, data: view(e, null) });
}));

router.patch('/experiments/:id', asyncHandler(async (req, res) => {
  const cur = await db.experiment.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
  if (!cur) throw new NotFoundError('Experiment', req.params.id);
  const data = parse(req.body || {}, { partial: true });
  // Те, що вже перевірили, не переписують: інакше історія бреше.
  if (CLOSED.includes(cur.status) && Object.keys(data).some((k) => !['conclusion', 'status', 'title'].includes(k))) throw new ValidationError('Закритий тест не редагується: можна лише уточнити висновок або створити новий варіант на його основі');
  const next = { ...cur, ...data };
  if (data.code && data.code !== cur.code && await db.experiment.findFirst({ where: { projectId: req.project.id, code: data.code } })) throw new ConflictError(`Код ${data.code} уже зайнятий`);
  if (SAME.some((k) => data[k] !== undefined)) await guardDuplicate(req.project.id, next, cur.id, req.body?.force === true);
  if (data.status && data.status !== cur.status) {
    if (data.status === 'running') { data.dateFrom ||= cur.dateFrom || date(new Date().toISOString().slice(0, 10)); data.dateTo = null; data.result = null; }
    if (CLOSED.includes(data.status) && !CLOSED.includes(cur.status)) {
      if (!next.conclusion) throw new ValidationError('Перед тим як закрити тест, запишіть висновок: що дізнались');
      data.dateTo ||= cur.dateTo || date(new Date().toISOString().slice(0, 10));
      data.result = await measure(req.project, { ...next, dateTo: data.dateTo }) ?? undefined;
    }
  }
  if (data.result === null) { const { Prisma } = require('@prisma/client'); data.result = Prisma.DbNull; }
  const e = await db.experiment.update({ where: { id: cur.id }, data });
  await logAction(req.project.id, req.actor, 'experiment_changed', { target: `${e.code} ${e.title}`, before: { status: cur.status }, after: { status: e.status } });
  res.json({ ok: true, data: view(e, e.result || await measure(req.project, e)) });
}));

// Видалити можна лише те, що ще не запускали.
router.delete('/experiments/:id', asyncHandler(async (req, res) => {
  const cur = await db.experiment.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
  if (!cur) throw new NotFoundError('Experiment', req.params.id);
  if (cur.status !== 'planned') throw new ValidationError('Видалити можна лише запланований тест: решта — це історія');
  await db.experiment.delete({ where: { id: cur.id } });
  await logAction(req.project.id, req.actor, 'experiment_deleted', { target: `${cur.code} ${cur.title}` });
  res.json({ ok: true, data: { deleted: true } });
}));

module.exports = router;
module.exports.fingerprint = fingerprint;
