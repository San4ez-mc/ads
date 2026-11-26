// Розділ «Клієнти»: ручні позначки консультацій і продажів дорожчих продуктів, поки нема окремої CRM для експертного бізнесу.
// Без персональних даних із сайтів: «Клієнт» — це підпис, який дає власник (ім'я чи нік як йому зручно), плюс зв'язок із подією оплати.
const express = require('express');
const { Prisma } = require('@prisma/client');
const { db } = require('@ads/db');
const { NotFoundError, ValidationError } = require('@ads/errors');
const asyncHandler = require('../middleware/asyncHandler');
const { saleSteps } = require('../lib/sales');
const { round2 } = require('../lib/money');
const { logAction } = require('../services/journal');
const svc = require('../services/clients');

const router = express.Router();
const SOURCES = ['site', 'flows', 'calendar', 'instagram', 'manual'];
const OUTCOMES = ['came', 'no_show', 'thinking', 'refused'];
// Кроки «людина записалась на зустріч»: календар і етап бота.
const isBooking = (e) => (e.elementType === 'calendar' && e.stepKey === 'booking') || (e.elementType === 'flows' && e.stepKey === 'Обрав час консультації');
const str = (v, max) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);

async function own(req) {
  const c = await db.client.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
  if (!c) throw new NotFoundError('Client', req.params.id);
  return c;
}

const view = (c, adNames) => ({
  id: c.id, label: c.label, source: c.source, stage: c.stage, adExtId: c.adExtId, adName: c.adExtId ? adNames.get(c.adExtId) || null : null,
  consultDone: !!c.consultDone, consultAt: c.consultAt, outcome: c.outcome, refusalReason: c.refusalReason, note: c.note, createdAt: c.createdAt,
  sales: (c.sales || []).map((s) => ({ id: s.id, product: s.product, amount: Number(s.amount), currency: s.currency, soldAt: s.soldAt })),
  salesTotal: round2((c.sales || []).reduce((a, s) => a + Number(s.amount), 0)),
});

router.get('/clients', asyncHandler(async (req, res) => {
  const rows = await db.client.findMany({ where: { projectId: req.project.id }, include: { sales: { orderBy: { soldAt: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 300 });
  const ads = await db.ad.findMany({ where: { projectId: req.project.id, externalId: { in: [...new Set(rows.map((r) => r.adExtId).filter(Boolean))] } }, select: { externalId: true, name: true } });
  const names = new Map(ads.map((a) => [a.externalId, a.name]));
  const list = rows.map((c) => view(c, names));
  res.json({ ok: true, data: { clients: list, totals: { clients: list.length, consults: list.filter((c) => c.consultDone).length, noShow: list.filter((c) => c.outcome === 'no_show').length, refused: list.filter((c) => c.outcome === 'refused').length, upsells: list.reduce((a, c) => a + c.sales.length, 0), upsellRevenue: round2(list.reduce((a, c) => a + c.salesTotal, 0)) }, stages: svc.IG_STAGES } });
}));

/** Оплати з сайту/бота/календаря, яким ще не призначено клієнта: власник пізнає їх за часом і сумою та дає підпис. */
router.get('/clients/candidates', asyncHandler(async (req, res) => {
  const sale = await saleSteps(req.project.id);
  const since = new Date(Date.now() - 60 * 86400000);
  const linked = await db.client.findMany({ where: { projectId: req.project.id, personKey: { not: null } }, select: { personKey: true } });
  const taken = new Set(linked.map((c) => c.personKey));
  const events = await db.stepEvent.findMany({ where: { projectId: req.project.id, isTest: false, ts: { gte: since }, elementType: { in: ['site', 'flows', 'calendar'] } }, orderBy: { ts: 'desc' }, take: 400 });
  const free = events.filter((e) => e.personKey && !taken.has(e.personKey));
  const paid = free.filter((e) => sale.has(e.elementType, e.elementRef, e.stepKey));
  // Запис із бота видно двічі (етап бота й календар): лишаємо подію бота.
  const booked = free.filter(isBooking);
  const twin = (e) => e.elementType === 'calendar' && e.adExtId && booked.some((x) => x.elementType === 'flows' && x.adExtId === e.adExtId && Math.abs(x.ts - e.ts) < 5 * 60000);
  const rows = [...paid.map((e) => ({ ...e, kind: 'payment' })), ...booked.filter((e) => !twin(e) && !paid.includes(e)).map((e) => ({ ...e, kind: 'booking' }))].sort((a, b) => b.ts - a.ts);
  const ads = await db.ad.findMany({ where: { projectId: req.project.id, externalId: { in: [...new Set(rows.map((r) => r.adExtId).filter(Boolean))] } }, select: { externalId: true, name: true } });
  const names = new Map(ads.map((a) => [a.externalId, a.name]));
  res.json({ ok: true, data: { candidates: rows.slice(0, 100).map((e) => ({ eventId: e.id, kind: e.kind, ts: e.ts, source: e.elementType, element: e.elementRef, step: e.stepKey, amount: e.amount === null ? null : Number(e.amount), adExtId: e.adExtId, adName: e.adExtId ? names.get(e.adExtId) || null : null, personKey: e.personKey })) } });
}));

router.post('/clients', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const label = str(b.label, 120);
  if (!label) throw new ValidationError('Введіть підпис клієнта (імʼя чи нік)');
  let { source, adExtId, clickId, personKey } = { source: SOURCES.includes(b.source) ? b.source : 'manual', adExtId: str(b.adExtId, 40), clickId: str(b.clickId, 40), personKey: str(b.personKey, 120) };
  if (b.fromEventId) { // клієнт із конкретної оплати: беремо звідти джерело, оголошення й ключ людини
    const e = await db.stepEvent.findFirst({ where: { id: String(b.fromEventId), projectId: req.project.id } });
    if (!e) throw new ValidationError('Подію оплати не знайдено');
    source = e.elementType; adExtId = e.adExtId || adExtId; clickId = e.clickId || clickId; personKey = e.personKey || personKey;
  }
  const c = await db.client.create({ data: { projectId: req.project.id, label, source, adExtId, clickId, personKey, stage: source === 'instagram' ? 'wrote' : null, note: str(b.note, 2000), consultDone: !!b.consultDone, consultAt: b.consultDone ? new Date() : null } });
  await svc.syncClientEvents(c.id);
  await logAction(req.project.id, req.actor, 'client_added', { target: label, after: { source } });
  res.status(201).json({ ok: true, data: { id: c.id } });
}));

router.patch('/clients/:id', asyncHandler(async (req, res) => {
  const c = await own(req); const b = req.body || {}; const data = {};
  if (b.label !== undefined) { const l = str(b.label, 120); if (!l) throw new ValidationError('Підпис не може бути порожній'); data.label = l; }
  if (b.note !== undefined) data.note = str(b.note, 2000);
  if (b.adExtId !== undefined) data.adExtId = str(b.adExtId, 40);
  if (b.consultDone !== undefined) { data.consultDone = !!b.consultDone; data.consultAt = b.consultDone ? (c.consultAt || new Date()) : null; }
  if (b.outcome !== undefined) {
    const o = b.outcome || null;
    if (o && !OUTCOMES.includes(o)) throw new ValidationError(`Результат зустрічі: ${OUTCOMES.join(', ')}`);
    data.outcome = o;
    const was = o === 'came' || o === 'thinking' || o === 'refused';
    data.consultDone = was; data.consultAt = o ? (c.consultAt || new Date()) : null;
    if (o !== 'refused') data.refusalReason = null;
  }
  if (b.refusalReason !== undefined) data.refusalReason = str(b.refusalReason, 1000);
  if (b.stage !== undefined) { if (!svc.IG_STAGES.includes(b.stage)) throw new ValidationError(`Етап: ${svc.IG_STAGES.join(', ')}`); data.stage = b.stage; }
  await db.client.update({ where: { id: c.id }, data });
  await svc.syncClientEvents(c.id);
  if (b.consultDone !== undefined && !!b.consultDone !== !!c.consultDone) await logAction(req.project.id, req.actor, 'client_consult', { target: c.label, after: { consultDone: !!b.consultDone } });
  if (b.outcome !== undefined && (b.outcome || null) !== c.outcome) await logAction(req.project.id, req.actor, 'client_outcome', { target: c.label, after: { outcome: b.outcome || null } });
  res.json({ ok: true, data: { id: c.id } });
}));

router.post('/clients/:id/sales', asyncHandler(async (req, res) => {
  const c = await own(req); const b = req.body || {};
  const product = str(b.product, 160); const amount = Number(b.amount);
  if (!product) throw new ValidationError('Вкажіть, що купив');
  if (!(amount > 0 && amount <= 100000000)) throw new ValidationError('Сума — число більше нуля');
  const when = b.soldAt ? new Date(b.soldAt) : new Date();
  if (Number.isNaN(when.getTime())) throw new ValidationError('Некоректна дата продажу');
  const s = await db.clientSale.create({ data: { clientId: c.id, product, amount, soldAt: when } });
  // Продаж дорожчого продукту означає, що консультація відбулась.
  if (!c.consultDone) await db.client.update({ where: { id: c.id }, data: { consultDone: true, consultAt: when, outcome: 'came' } });
  await svc.syncClientEvents(c.id);
  await logAction(req.project.id, req.actor, 'client_sale', { target: c.label, after: { product, amount } });
  res.status(201).json({ ok: true, data: { id: s.id } });
}));

router.delete('/clients/:id/sales/:saleId', asyncHandler(async (req, res) => {
  const c = await own(req);
  const s = await db.clientSale.findFirst({ where: { id: req.params.saleId, clientId: c.id } });
  if (!s) throw new NotFoundError('Sale', req.params.saleId);
  await db.clientSale.delete({ where: { id: s.id } });
  await svc.syncClientEvents(c.id);
  await logAction(req.project.id, req.actor, 'client_sale_removed', { target: c.label, before: { product: s.product, amount: Number(s.amount) } });
  res.json({ ok: true, data: { deleted: true } });
}));

router.delete('/clients/:id', asyncHandler(async (req, res) => {
  const c = await own(req);
  await svc.removeClientEvents(c);
  await db.client.delete({ where: { id: c.id } });
  await logAction(req.project.id, req.actor, 'client_removed', { target: c.label });
  res.json({ ok: true, data: { deleted: true } });
}));

module.exports = router;
