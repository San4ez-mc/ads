// Сайти: версії для A/B і правки, які платформа надсилає власнику сайтів (АПІ: «API_сайтів_правки_та_AB_версії.md»).
// Правка нічого на сайті не змінює: вона записується в базі сайтів і чекає виконавця. Надсилає лише людина з підтвердженням.
const crypto = require('node:crypto');
const express = require('express');
const { db } = require('@ads/db');
const { ForbiddenError, ValidationError } = require('@ads/errors');
const asyncHandler = require('../middleware/asyncHandler');
const site = require('../channels/site');
const { decrypt, scrub } = require('../lib/secrets');
const { logAction } = require('../services/journal');

const router = express.Router();
const KINDS = ['edit', 'ab'];
const MAX_MESSAGE = 4000;

const connectionOf = (projectId) => db.connection.findFirst({ where: { projectId, channel: 'site', secretRead: { not: null } }, orderBy: { createdAt: 'asc' } });

/** Те саме прохання для того самого сайту отримує той самий номер: повторне натискання не створює дубль. */
const externalId = (siteId, kind, message) => `ads-${crypto.createHash('sha1').update(`${siteId}|${kind}|${message}`).digest('hex').slice(0, 20)}`;

router.get('/sites', asyncHandler(async (req, res) => {
  const conn = await connectionOf(req.project.id);
  const [elements, log] = await Promise.all([
    db.element.findMany({ where: { projectId: req.project.id, type: 'site' }, orderBy: { createdAt: 'asc' } }),
    db.actionLog.findMany({ where: { projectId: req.project.id, kind: 'site_edit', status: 'done' }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  let versions = []; let error = null;
  if (conn) {
    try { versions = await site.fetchVersions(conn.externalId, decrypt(conn.secretRead)); } catch (e) { error = scrub(e.message); }
  }
  res.json({ ok: true, data: {
    connected: !!conn, error,
    sites: elements.map((e) => ({ id: e.ref, name: e.name, domain: e.config?.domain || null })),
    versions,
    edits: log.map((l) => ({ at: l.createdAt, id: l.after?.id ?? null, site: l.after?.site, kind: l.after?.kind, message: l.after?.message })),
  } });
}));

router.post('/sites/edits', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!String(req.actor).startsWith('user:')) throw new ForbiddenError('Правки на сайти надсилає лише людина');
  if (b.confirm !== true) throw new ValidationError('Потрібне підтвердження');
  const siteId = String(b.site || '').trim().slice(0, 80);
  const kind = String(b.kind || 'edit');
  const message = String(b.message || '').trim();
  if (!siteId) throw new ValidationError('Оберіть сайт');
  if (!KINDS.includes(kind)) throw new ValidationError('Вид правки: змінити сайт або перевірити варіант');
  if (!message) throw new ValidationError('Напишіть, що змінити');
  if (message.length > MAX_MESSAGE) throw new ValidationError(`Не довше ${MAX_MESSAGE} знаків: зараз ${message.length}`);
  const conn = await connectionOf(req.project.id);
  if (!conn) throw new ValidationError('Сайти не підключені: додайте їх у «Підключеннях»');
  let sent;
  try {
    // Окремий ключ для запису, якщо заданий; інакше той самий, що на читання (дозвіл писати вмикається в адмінці сайтів).
    sent = await site.sendEdit(conn.externalId, decrypt(conn.secretWrite || conn.secretRead), { site: siteId, kind, message, external_id: externalId(siteId, kind, message), author: 'FINEKO Ads' });
  } catch (e) {
    const text = e.status === 403 ? 'Ключ сайтів лише на читання. В адмінці сайтів відкрийте «API реклами» й увімкніть біля ключа «Дозволити писати».' : scrub(e.message);
    await logAction(req.project.id, req.actor, 'site_edit', { target: siteId, reason: text.slice(0, 500), status: 'failed' });
    return void res.json({ ok: true, data: { status: 'failed', message: text } });
  }
  if (!sent.duplicate) await logAction(req.project.id, req.actor, 'site_edit', { target: siteId, after: { id: sent.id, site: siteId, kind, message } });
  res.json({ ok: true, data: { status: 'done', id: sent.id, duplicate: !!sent.duplicate, message: sent.duplicate ? `Таку правку вже надсилали: №${sent.id}.` : `Надіслано: правка №${sent.id}. На сайті ще нічого не змінено.` } });
}));

module.exports = router;
