// Підключення рекламних кабінетів і сайтів. Ключі приймаються, шифруються і більше НІКОЛИ не віддаються назад.
const express = require('express');
const { db } = require('@ads/db');
const { NotFoundError, ValidationError } = require('@ads/errors');
const asyncHandler = require('../middleware/asyncHandler');
const meta = require('../channels/meta');
const site = require('../channels/site');
const flows = require('../channels/flows');
const content2 = require('../channels/content2');
const { encrypt, decrypt, mask, scrub } = require('../lib/secrets');
const { logAction } = require('../services/journal');

const router = express.Router();
const CHANNELS = { meta: 'Meta (Facebook / Instagram)', site: 'Сайти (АПІ кроків)', flows: 'Flows (етапи ботів)', content2: 'Контент-платформа (креативи, аудиторії)' };
const slugList = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[s,]+/)).map((s) => String(s).trim()).filter((s) => /^[a-z0-9][a-z0-9_-]{0,80}$/i.test(s)))].slice(0, 50);

const view = (c) => ({
  id: c.id, channel: c.channel, channelLabel: CHANNELS[c.channel] || c.channel, name: c.name, externalId: c.externalId,
  config: c.config, status: c.status, lastCheckAt: c.lastCheckAt, lastSyncAt: c.lastSyncAt, lastError: c.lastError,
  readKey: mask(c.secretRead), writeKey: mask(c.secretWrite),
});

function normalize(channel, externalId) {
  if (channel === 'meta') {
    const id = String(externalId || '').trim().replace(/^act_/, '');
    if (!/^\d{5,25}$/.test(id)) throw new ValidationError('Номер рекламного кабінету — лише цифри (можна з «act_» на початку)');
    return id;
  }
  if (channel === 'site' || channel === 'flows' || channel === 'content2') {
    let u; try { u = new URL(String(externalId || '').trim()); } catch { throw new ValidationError('Адреса АПІ сайтів має бути повною, наприклад https://leads.fineko.space/api/ads/v1'); }
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new ValidationError('Адреса АПІ сайтів має починатись з https://');
    return u.toString().replace(/\/+$/, '');
  }
  throw new ValidationError('Невідомий канал. Доступні: meta, site, flows, content2');
}

/** Живий виклик у канал. Нічого не зберігає. */
async function probe(channel, externalId, readKey, slugs, c2project) {
  if (channel === 'content2') return content2.check(externalId, readKey, c2project);
  if (channel === 'meta') return meta.check(readKey, externalId);
  if (channel === 'flows') return flows.check(externalId, readKey, slugs);
  return site.check(externalId, readKey);
}

async function runCheck(conn) {
  try {
    const info = await probe(conn.channel, conn.externalId, decrypt(conn.secretRead), conn.config?.slugs, conn.config?.projectId);
    // Запобіжник 13: кабінет не в порядку → статус blocked, автоматика по ньому не працює.
    const status = conn.channel === 'meta' && info.healthy === false ? 'blocked' : 'ok';
    return db.connection.update({ where: { id: conn.id }, data: { status, lastCheckAt: new Date(), lastError: status === 'blocked' ? `Кабінет: ${info.accountStatusText}` : null, config: { ...(conn.config || {}), check: info } } });
  } catch (e) {
    return db.connection.update({ where: { id: conn.id }, data: { status: 'error', lastCheckAt: new Date(), lastError: scrub(e.message) } });
  }
}

router.get('/connections', asyncHandler(async (req, res) => {
  const rows = await db.connection.findMany({ where: { projectId: req.project.id }, orderBy: { createdAt: 'asc' } });
  res.json({ ok: true, data: { connections: rows.map(view), channels: CHANNELS, metaApiVersion: meta.VERSION } });
}));

// Перевірка ключа ДО збереження — крок майстра «Перевірити».
router.post('/connections/test', asyncHandler(async (req, res) => {
  const { channel, externalId, readKey, slugs, c2project } = req.body || {};
  const ext = normalize(channel, externalId);
  if (!String(readKey || '').trim()) throw new ValidationError('Вставте ключ');
  try { res.json({ ok: true, data: { ok: true, info: await probe(channel, ext, String(readKey).trim(), slugList(slugs), String(c2project || '').trim()) } }); }
  catch (e) { res.json({ ok: true, data: { ok: false, message: scrub(e.message) } }); }
}));

router.post('/connections', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const externalId = normalize(b.channel, b.externalId);
  const readKey = String(b.readKey || '').trim();
  if (!readKey) throw new ValidationError('Ключ на читання обовʼязковий');
  const name = String(b.name || '').trim().slice(0, 120) || (b.channel === 'meta' ? `Кабінет ${externalId}` : b.channel === 'flows' ? 'Боти Flows' : b.channel === 'content2' ? 'Контент-платформа' : 'Сайти');
  const created = await db.connection.create({ data: { projectId: req.project.id, channel: b.channel, name, externalId, secretRead: encrypt(readKey), secretWrite: b.writeKey ? encrypt(String(b.writeKey).trim()) : null, config: b.channel === 'flows' ? { slugs: slugList(b.slugs) } : b.channel === 'content2' ? { projectId: String(b.c2project || '').trim().slice(0, 80) } : {} } });
  const conn = await runCheck(created);
  await logAction(req.project.id, req.actor, 'connection_added', { target: `${conn.channel}:${conn.externalId}`, after: { name, status: conn.status } });
  res.status(201).json({ ok: true, data: view(conn) });
}));

async function own(req) {
  const c = await db.connection.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
  if (!c) throw new NotFoundError('Connection', req.params.id);
  return c;
}

router.patch('/connections/:id', asyncHandler(async (req, res) => {
  const c = await own(req); const b = req.body || {}; const data = {};
  if (b.name !== undefined) data.name = String(b.name).trim().slice(0, 120) || c.name;
  if (b.readKey) data.secretRead = encrypt(String(b.readKey).trim());
  if (b.writeKey !== undefined) data.secretWrite = b.writeKey ? encrypt(String(b.writeKey).trim()) : null;
  if (b.slugs !== undefined && c.channel === 'flows') data.config = { ...(c.config || {}), slugs: slugList(b.slugs) };
  const updated = await db.connection.update({ where: { id: c.id }, data });
  const conn = b.readKey || b.slugs !== undefined ? await runCheck(updated) : updated;
  await logAction(req.project.id, req.actor, 'connection_changed', { target: `${c.channel}:${c.externalId}`, after: { name: conn.name, readKeyChanged: !!b.readKey, writeKeyChanged: b.writeKey !== undefined } });
  res.json({ ok: true, data: view(conn) });
}));

router.post('/connections/:id/check', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: view(await runCheck(await own(req))) });
}));

router.delete('/connections/:id', asyncHandler(async (req, res) => {
  const c = await own(req);
  await db.connection.delete({ where: { id: c.id } });
  await logAction(req.project.id, req.actor, 'connection_removed', { target: `${c.channel}:${c.externalId}`, before: { name: c.name } });
  res.json({ ok: true, data: { deleted: true } });
}));

module.exports = router;
