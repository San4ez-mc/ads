// «Запуск»: створення кампаній із платформи. Читати — хто бачить оголошення; змінювати — лише з правом затверджувати.
// Ключ проєкту (воронки Flows) сюди не допускається (pageAccess.keyAllowed). Уся перевірка й робота з Meta — services/launch.js.
const express = require('express');
const { db } = require('@ads/db');
const { NotFoundError, ValidationError } = require('@ads/errors');
const asyncHandler = require('../middleware/asyncHandler');
const launch = require('../services/launch');
const meta = require('../channels/meta');
const { decrypt, scrub } = require('../lib/secrets');
const { logAction } = require('../services/journal');

const router = express.Router();

const view = (l) => {
  const stale = l.status === 'creating' && Date.now() - new Date(l.updatedAt).getTime() > launch.STALE_MS;
  const items = Object.values(l.ids?.items || {});
  return {
    id: l.id, name: l.name, status: stale ? 'failed' : l.status, error: stale ? 'Створення перервалось. Натисніть «Продовжити».' : l.error,
    spec: l.spec, campaignId: l.ids?.campaign || null, adsCreated: items.filter((i) => i.linked).length, adIds: items.map((i) => i.ad).filter(Boolean),
    createdAt: l.createdAt, launchedAt: l.launchedAt,
  };
};

async function find(req) {
  const l = await db.launch.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
  if (!l) throw new NotFoundError('Launch', req.params.id);
  return l;
}
const confirmed = (req) => { if (req.body?.confirm !== true) throw new ValidationError('Потрібне явне підтвердження (confirm: true)'); };
const outcome = ({ job, ...r }) => r; // фонову задачу назовні не віддаємо

router.get('/launches', asyncHandler(async (req, res) => {
  const rows = await db.launch.findMany({ where: { projectId: req.project.id, status: { not: 'archived' } }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ ok: true, data: { launches: rows.map(view), dryRun: !!req.project.dryRun, dailyLimitUsd: Number(req.project.dailyLimitUsd), goals: Object.entries(launch.GOALS).map(([id, g]) => ({ id, label: g.label })), pixelEvents: launch.PIXEL_EVENTS } });
}));

// Кабінети з ключем керування і сторінки Facebook, які цей ключ бачить.
router.get('/launches/accounts', asyncHandler(async (req, res) => {
  const rows = await db.connection.findMany({ where: { projectId: req.project.id, channel: 'meta' }, orderBy: { createdAt: 'asc' } });
  const accounts = [];
  for (const c of rows) {
    let pages = []; let pagesError = null;
    if (c.secretWrite) { try { pages = await meta.pages(decrypt(c.secretWrite)); } catch (e) { pagesError = scrub(e.message); } }
    accounts.push({ id: c.id, name: c.name, status: c.status, canWrite: !!c.secretWrite, currency: c.config?.check?.currency || null, pages, pagesError, defaults: c.config?.launchDefaults || {} });
  }
  res.json({ ok: true, data: { accounts } });
}));

router.post('/launches', asyncHandler(async (req, res) => {
  const spec = launch.parseSpec(req.body || {});
  const [conn, bundle] = await Promise.all([
    db.connection.findFirst({ where: { id: spec.connectionId, projectId: req.project.id, channel: 'meta' } }),
    db.bundle.findFirst({ where: { id: spec.bundleId, projectId: req.project.id } }),
  ]);
  if (!conn) throw new ValidationError('Кабінет не знайдено');
  if (!bundle) throw new ValidationError('Зв\'язку не знайдено');
  const l = await db.launch.create({ data: { projectId: req.project.id, connectionId: conn.id, name: `${bundle.code ? `[${bundle.code}] ` : ''}${spec.name || bundle.name}`.slice(0, 240), spec, createdBy: req.actor } });
  // Щоб наступного разу не вводити те саме.
  const { pageId, instagramId, pixelId, destination } = spec;
  await db.connection.update({ where: { id: conn.id }, data: { config: { ...(conn.config || {}), launchDefaults: { ...(conn.config?.launchDefaults || {}), pageId, ...(instagramId ? { instagramId } : {}), ...(pixelId ? { pixelId } : {}), ...(destination.type === 'telegram' ? { bot: destination.bot } : { url: destination.url }) } } } });
  await logAction(req.project.id, req.actor, 'launch_draft', { target: l.name });
  res.status(201).json({ ok: true, data: view(l) });
}));

router.post('/launches/:id/check', asyncHandler(async (req, res) => {
  const v = await launch.check(req.project, await find(req), { actor: req.actor });
  res.json({ ok: true, data: { ok: v.ok, reasons: v.reasons, notes: v.notes, dryRun: v.dryRun, creatives: v.creatives.map((c) => ({ number: c.number, headline: c.headline, primary: c.primary })) } });
}));

router.post('/launches/:id/create', asyncHandler(async (req, res) => {
  confirmed(req);
  res.json({ ok: true, data: outcome(await launch.create(req.project, await find(req), { actor: req.actor })) });
}));

router.post('/launches/:id/start', asyncHandler(async (req, res) => {
  confirmed(req);
  res.json({ ok: true, data: await launch.start(req.project, await find(req), { actor: req.actor }) });
}));

router.post('/launches/:id/stop', asyncHandler(async (req, res) => {
  confirmed(req);
  res.json({ ok: true, data: await launch.stop(req.project, await find(req), { actor: req.actor }) });
}));

// Прибрати зі списку: чернетку або невдалу спробу. Створене в кабінеті лишається там вимкненим; запис, що вже щось
// створив, не стирається, а ховається — інакше зникне облік «скільки створено за добу» (запобіжник 5).
router.delete('/launches/:id', asyncHandler(async (req, res) => {
  const l = await find(req);
  if (!['draft', 'failed'].includes(view(l).status)) throw new ValidationError('Прибрати можна лише чернетку або невдалу спробу: створену кампанію тут зупиняють');
  if (l.ids?.campaign) await db.launch.update({ where: { id: l.id }, data: { status: 'archived' } });
  else await db.launch.delete({ where: { id: l.id } });
  await logAction(req.project.id, req.actor, 'launch_deleted', { target: l.name, after: { campaignLeftInAccount: l.ids?.campaign || null } });
  res.json({ ok: true, data: { deleted: true, campaignId: l.ids?.campaign || null } });
}));

module.exports = router;
