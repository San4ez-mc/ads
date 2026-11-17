// Зв'язки (аудиторія × обіцянка × шлях × креативи), аудиторії та елементи шляху.
// Оголошення належать зв'язці, якщо в назві їхньої кампанії є «[код зв'язки]».
const express = require('express');
const { db } = require('@ads/db');
const { NotFoundError, ValidationError } = require('@ads/errors');
const asyncHandler = require('../middleware/asyncHandler');
const { adRows, period } = require('./ads');
const { verdict, LABEL } = require('../lib/verdict');
const { round2 } = require('../lib/money');
const { logAction } = require('../services/journal');
const c2 = require('../channels/content2');
const { decrypt } = require('../lib/secrets');

const router = express.Router();
const STATUSES = ['draft', 'test', 'works', 'fails', 'scale'];
const ELEMENT_TYPES = ['site', 'flows', 'calendar', 'instagram', 'manual'];
const str = (v, max) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const codeOf = (v) => { const c = String(v || '').trim().toUpperCase(); if (c && !/^[A-ZА-ЯІЇЄҐ0-9-]{1,12}$/.test(c)) throw new ValidationError('Код зв\'язки: до 12 літер, цифр або дефісів, без пробілів'); return c || null; };
/** Чи належить кампанія зв'язці: «[A1]» у назві, без урахування регістру. */
const inBundle = (campaignName, code) => !!code && String(campaignName || '').toUpperCase().includes(`[${String(code).toUpperCase()}]`);

// ── Аудиторії ──
router.get('/audiences', asyncHandler(async (req, res) => {
  const rows = await db.audience.findMany({ where: { projectId: req.project.id }, orderBy: { createdAt: 'asc' } });
  res.json({ ok: true, data: { audiences: rows } });
}));

router.post('/audiences', asyncHandler(async (req, res) => {
  const name = str(req.body?.name, 160);
  if (!name) throw new ValidationError('Назва аудиторії обовʼязкова');
  const a = await db.audience.create({ data: { projectId: req.project.id, name, description: str(req.body?.description, 4000), content2PersonaId: str(req.body?.content2PersonaId, 80), targeting: req.body?.targeting && typeof req.body.targeting === 'object' ? req.body.targeting : {} } });
  res.status(201).json({ ok: true, data: a });
}));

router.patch('/audiences/:id', asyncHandler(async (req, res) => {
  const cur = await db.audience.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
  if (!cur) throw new NotFoundError('Audience', req.params.id);
  const b = req.body || {}; const data = {};
  if (b.name !== undefined) { const n = str(b.name, 160); if (!n) throw new ValidationError('Назва не може бути порожня'); data.name = n; }
  if (b.description !== undefined) data.description = str(b.description, 4000);
  if (b.content2PersonaId !== undefined) data.content2PersonaId = str(b.content2PersonaId, 80);
  if (b.targeting !== undefined && b.targeting && typeof b.targeting === 'object') data.targeting = b.targeting;
  res.json({ ok: true, data: await db.audience.update({ where: { id: cur.id }, data }) });
}));

// ── Елементи шляху ──
router.get('/elements', asyncHandler(async (req, res) => {
  const rows = await db.element.findMany({ where: { projectId: req.project.id }, include: { steps: { orderBy: { order: 'asc' } } }, orderBy: { createdAt: 'asc' } });
  res.json({ ok: true, data: { elements: rows.map((e) => ({ id: e.id, key: `${e.type}:${e.ref}`, type: e.type, ref: e.ref, name: e.name, steps: e.steps.map((s) => ({ key: s.key, title: s.title, order: s.order, branch: s.branch, isSale: s.isSale, leadsTo: s.leadsTo, defaultAmount: s.defaultAmount === null ? null : Number(s.defaultAmount) })) })) } });
}));

// Ручний елемент (повідомлення в Instagram, консультація) — кроки задає людина.
router.post('/elements', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!ELEMENT_TYPES.includes(b.type)) throw new ValidationError(`Тип елемента: ${ELEMENT_TYPES.join(', ')}`);
  const name = str(b.name, 160); const ref = str(b.ref, 80);
  if (!name || !ref || !/^[a-z0-9][a-z0-9_-]*$/i.test(ref)) throw new ValidationError('Потрібні назва і короткий код елемента латиницею');
  const steps = Array.isArray(b.steps) ? b.steps.slice(0, 30) : [];
  const el = await db.element.create({ data: { projectId: req.project.id, type: b.type, ref, name, steps: { create: steps.map((s, i) => ({ key: str(s.key, 80) || `step${i + 1}`, title: str(s.title, 160) || `Крок ${i + 1}`, order: Number(s.order) || i + 1, branch: str(s.branch, 40), isSale: !!s.isSale, leadsTo: str(s.leadsTo, 120), defaultAmount: s.defaultAmount ? Number(s.defaultAmount) : null })) } } });
  res.status(201).json({ ok: true, data: { id: el.id, key: `${el.type}:${el.ref}` } });
}));

router.patch('/elements/:id/steps/:key', asyncHandler(async (req, res) => {
  const el = await db.element.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
  if (!el) throw new NotFoundError('Element', req.params.id);
  const b = req.body || {}; const data = {};
  if (b.isSale !== undefined) data.isSale = !!b.isSale;
  if (b.defaultAmount !== undefined) { const n = b.defaultAmount === null || b.defaultAmount === '' ? null : Number(b.defaultAmount); if (n !== null && !(n >= 0)) throw new ValidationError('Сума — число від 0'); data.defaultAmount = n; }
  if (b.leadsTo !== undefined) data.leadsTo = str(b.leadsTo, 120);
  const step = await db.step.update({ where: { elementId_key: { elementId: el.id, key: req.params.key } }, data }).catch(() => null);
  if (!step) throw new NotFoundError('Step', req.params.key);
  await logAction(req.project.id, req.actor, 'step_changed', { target: `${el.type}:${el.ref}|${step.key}`, after: data });
  res.json({ ok: true, data: { key: step.key, isSale: step.isSale, defaultAmount: step.defaultAmount === null ? null : Number(step.defaultAmount), leadsTo: step.leadsTo } });
}));

// ── Зв'язки ──
function bundleData(b, { partial } = {}) {
  const data = {};
  if (!partial || b.name !== undefined) { const n = str(b.name, 200); if (!n) throw new ValidationError('Назва зв\'язки обовʼязкова'); data.name = n; }
  if (b.code !== undefined) data.code = codeOf(b.code);
  for (const [k, max] of [['hypothesis', 2000], ['product', 200], ['promise', 2000], ['angle', 2000], ['verdict', 4000]]) if (b[k] !== undefined) data[k] = str(b[k], max);
  if (b.audienceId !== undefined) data.audienceId = b.audienceId || null;
  if (b.path !== undefined) data.path = (Array.isArray(b.path) ? b.path : []).slice(0, 12).map((p) => ({ key: str(p.key, 120), note: str(p.note, 300) })).filter((p) => p.key || p.note);
  if (b.testBudgetUsd !== undefined) { const n = b.testBudgetUsd === null || b.testBudgetUsd === '' ? null : Number(b.testBudgetUsd); if (n !== null && !(n >= 0 && n <= 100000)) throw new ValidationError('Бюджет тесту — число від 0'); data.testBudgetUsd = n; }
  if (b.stopRule !== undefined) data.stopRule = { text: str(b.stopRule?.text ?? b.stopRule, 600) };
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw new ValidationError(`Стан: ${STATUSES.join(', ')}`); data.status = b.status; }
  return data;
}

router.get('/bundles', asyncHandler(async (req, res) => {
  const p = period({ from: req.query.from || '2000-01-01', to: req.query.to });
  const [bundles, rows] = await Promise.all([
    db.bundle.findMany({ where: { projectId: req.project.id }, include: { audience: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
    adRows(req.project, p, {}),
  ]);
  const target = req.project.targetSaleCost === null ? null : Number(req.project.targetSaleCost);
  const rate = Number(req.project.usdRate) || 42;
  const out = bundles.map((b) => {
    const ads = rows.filter((a) => inBundle(a.campaign.name, b.code));
    const spend = ads.reduce((s, a) => s + a.spend, 0); const sales = ads.reduce((s, a) => s + a.sales, 0); const revenue = ads.reduce((s, a) => s + a.revenue, 0); const clicks = ads.reduce((s, a) => s + a.linkClicks, 0);
    const budget = b.testBudgetUsd === null ? null : Number(b.testBudgetUsd);
    const v = verdict({ spend, sales, target });
    return {
      id: b.id, name: b.name, code: b.code, hypothesis: b.hypothesis, product: b.product, promise: b.promise, angle: b.angle, path: b.path, status: b.status,
      testBudgetUsd: budget, stopRule: b.stopRule, verdict: b.verdict, audience: b.audience, startedAt: b.startedAt, endedAt: b.endedAt,
      metrics: { ads: ads.length, running: ads.filter((a) => a.running).length, spend: round2(spend), spendUsd: round2(spend / rate), linkClicks: clicks, sales, revenue: round2(revenue), saleCost: sales ? round2(spend / sales) : null, budgetUsedPct: budget ? Math.round((spend / rate / budget) * 100) : null, state: v, stateLabel: LABEL[v] },
    };
  });
  res.json({ ok: true, data: { bundles: out, statuses: STATUSES, target } });
}));

router.post('/bundles', asyncHandler(async (req, res) => {
  const data = bundleData(req.body || {});
  const b = await db.bundle.create({ data: { ...data, projectId: req.project.id } });
  await logAction(req.project.id, req.actor, 'bundle_created', { target: b.name });
  res.status(201).json({ ok: true, data: { id: b.id } });
}));

router.patch('/bundles/:id', asyncHandler(async (req, res) => {
  const cur = await db.bundle.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
  if (!cur) throw new NotFoundError('Bundle', req.params.id);
  const data = bundleData(req.body || {}, { partial: true });
  if (data.status && data.status !== cur.status) {
    if (data.status === 'test' && !cur.startedAt) data.startedAt = new Date();
    if (['works', 'fails'].includes(data.status)) {
      // Правило 12.2.5: тест не закривається без підсумку — інакше знання губиться.
      if (!(data.verdict ?? cur.verdict)) throw new ValidationError('Перед тим як закрити тест, запишіть підсумок: що дізнались');
      data.endedAt = new Date();
    }
  }
  const b = await db.bundle.update({ where: { id: cur.id }, data });
  if (data.status && data.status !== cur.status) await logAction(req.project.id, req.actor, 'bundle_status', { target: b.name, before: { status: cur.status }, after: { status: b.status } });
  if (data.status && data.status !== cur.status && ['works', 'fails'].includes(data.status)) {
    // Найкращі зусилля: якщо контент-платформа недоступна, закриття тесту не страждає.
    try {
      const conn = await db.connection.findFirst({ where: { projectId: req.project.id, channel: 'content2', secretRead: { not: null } } });
      const pid = conn && (conn.config?.projectId || req.project.content2ProjectId);
      if (conn && pid) {
        const full = await db.bundle.findUnique({ where: { id: b.id }, include: { audience: true } });
        const m = [full.audience && `Аудиторія: ${full.audience.name}`, full.product && `Продукт: ${full.product}`, full.angle && `Біль / кут: ${full.angle}`, full.promise && `Обіцянка: ${full.promise}`].filter(Boolean).join('. ');
        await c2.learning(conn.externalId, decrypt(conn.secretRead), pid, full.name, `${data.status === 'works' ? 'ПРАЦЮЄ' : 'НЕ ПРАЦЮЄ'}. ${m}. Підсумок: ${full.verdict}`);
      }
    } catch (e) { await logAction(req.project.id, 'system', 'learning_not_saved', { target: b.name, reason: String(e.message).slice(0, 200), status: 'failed' }); }
  }
  res.json({ ok: true, data: { id: b.id, status: b.status } });
}));

router.delete('/bundles/:id', asyncHandler(async (req, res) => {
  const cur = await db.bundle.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
  if (!cur) throw new NotFoundError('Bundle', req.params.id);
  await db.bundle.delete({ where: { id: cur.id } });
  await logAction(req.project.id, req.actor, 'bundle_deleted', { target: cur.name });
  res.json({ ok: true, data: { deleted: true } });
}));

module.exports = router;
module.exports.inBundle = inBundle;
