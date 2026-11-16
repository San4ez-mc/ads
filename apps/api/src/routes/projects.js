// Проєкти: створення (лише суперадмін), налаштування, ліміти, ключ для воронок.
const express = require('express');
const crypto = require('node:crypto');
const { db } = require('@ads/db');
const { ForbiddenError, ValidationError } = require('@ads/errors');
const asyncHandler = require('../middleware/asyncHandler');
const { resolveProject, sessionIdentity } = require('../middleware/resolveProject');
const { logAction } = require('../services/journal');

const admin = express.Router(); // без projectId
const scoped = express.Router(); // у межах проєкту

const newApiKey = () => `ads_${crypto.randomBytes(24).toString('hex')}`;
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || `p-${crypto.randomBytes(3).toString('hex')}`;

const publicProject = (p, withKey) => ({
  id: p.id, name: p.name, slug: p.slug, timezone: p.timezone, currency: p.currency,
  dailyLimitUsd: Number(p.dailyLimitUsd), usdRate: Number(p.usdRate), autonomyLevel: p.autonomyLevel, dryRun: p.dryRun,
  targetSaleCost: p.targetSaleCost === null ? null : Number(p.targetSaleCost), content2ProjectId: p.content2ProjectId, reportChatId: p.reportChatId,
  ...(withKey ? { apiKey: p.apiKey } : {}),
});

admin.post('/projects', asyncHandler(async (req, res) => {
  const { perms } = await sessionIdentity(req);
  if (perms.role !== 'superadmin') throw new ForbiddenError('Лише суперадмін створює проєкти');
  const name = String(req.body?.name || '').trim().slice(0, 200);
  if (!name) throw new ValidationError('Назва проєкту обовʼязкова');
  let slug = slugify(req.body?.slug || name);
  if (await db.project.findUnique({ where: { slug } })) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
  const p = await db.project.create({ data: { name, slug, apiKey: newApiKey() } });
  await logAction(p.id, 'user', 'project_created', { after: { name } });
  res.status(201).json({ ok: true, data: publicProject(p, true) });
}));

scoped.get('/project', asyncHandler(async (req, res) => {
  // Ключ для воронок бачить лише людина з доступом до налаштувань; воронці він не повертається.
  const withKey = req.authMethod === 'sso-session' && (req.access.role === 'superadmin' || !req.access.pageIds.length || req.access.pageIds.includes('settings'));
  res.json({ ok: true, data: publicProject(req.project, withKey) });
}));

const num = (v, min, max, label) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${label}: число від ${min} до ${max}`); return n; };

scoped.patch('/project', asyncHandler(async (req, res) => {
  const b = req.body || {}; const data = {};
  if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 200); if (!n) throw new ValidationError('Назва не може бути порожня'); data.name = n; }
  if (b.dailyLimitUsd !== undefined) data.dailyLimitUsd = num(b.dailyLimitUsd, 0, 100000, 'Денний ліміт');
  if (b.usdRate !== undefined) data.usdRate = num(b.usdRate, 1, 1000, 'Курс долара');
  if (b.autonomyLevel !== undefined) data.autonomyLevel = Math.round(num(b.autonomyLevel, 0, 3, 'Рівень самостійності'));
  if (b.dryRun !== undefined) data.dryRun = !!b.dryRun;
  if (b.targetSaleCost !== undefined) data.targetSaleCost = b.targetSaleCost === null || b.targetSaleCost === '' ? null : num(b.targetSaleCost, 0, 10000000, 'Цільова ціна продажу');
  if (b.content2ProjectId !== undefined) data.content2ProjectId = b.content2ProjectId ? String(b.content2ProjectId).slice(0, 100) : null;
  if (b.reportChatId !== undefined) data.reportChatId = b.reportChatId ? String(b.reportChatId).slice(0, 40) : null;
  if (b.timezone !== undefined) { try { new Intl.DateTimeFormat('uk', { timeZone: String(b.timezone) }); } catch { throw new ValidationError('Невідомий часовий пояс'); } data.timezone = String(b.timezone); }
  // Підняти самостійність або вимкнути режим «проба» може лише суперадмін (власник), не будь-хто з доступом до налаштувань.
  const risky = (data.autonomyLevel !== undefined && data.autonomyLevel > req.project.autonomyLevel) || (data.dryRun === false && req.project.dryRun) || (data.dailyLimitUsd !== undefined && data.dailyLimitUsd > Number(req.project.dailyLimitUsd));
  if (risky && req.access.role !== 'superadmin') throw new ForbiddenError('Підняти ліміт, самостійність або вимкнути режим «проба» може лише власник');
  const before = publicProject(req.project);
  const p = await db.project.update({ where: { id: req.project.id }, data });
  await logAction(p.id, req.actor, 'project_settings', { before, after: publicProject(p) });
  res.json({ ok: true, data: publicProject(p, true) });
}));

scoped.post('/project/rotate-key', asyncHandler(async (req, res) => {
  const p = await db.project.update({ where: { id: req.project.id }, data: { apiKey: newApiKey() } });
  await logAction(p.id, req.actor, 'project_key_rotated', {});
  res.json({ ok: true, data: { apiKey: p.apiKey } });
}));

module.exports = { admin, scoped, resolveProject };
