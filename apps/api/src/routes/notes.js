// Коментарі біля креативів: що власник помітив про людей, яких приводить креатив. Порожній текст прибирає коментар.
const express = require('express');
const { db } = require('@ads/db');
const { ValidationError } = require('@ads/errors');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
const KEY = /^[A-Za-z0-9:_-]{3,80}$/;

router.get('/notes', asyncHandler(async (req, res) => {
  const rows = await db.creativeNote.findMany({ where: { projectId: req.project.id }, orderBy: { updatedAt: 'desc' }, take: 500 });
  res.json({ ok: true, data: { notes: Object.fromEntries(rows.map((n) => [n.key, n.text])) } });
}));

router.put('/notes', asyncHandler(async (req, res) => {
  const key = String(req.body?.key || '');
  if (!KEY.test(key)) throw new ValidationError('Невідомий креатив');
  const text = String(req.body?.text || '').trim();
  if (text.length > 2000) throw new ValidationError('Коментар — не довше 2000 знаків');
  if (!text) await db.creativeNote.deleteMany({ where: { projectId: req.project.id, key } });
  else await db.creativeNote.upsert({ where: { projectId_key: { projectId: req.project.id, key } }, update: { text }, create: { projectId: req.project.id, key, text } });
  res.json({ ok: true, data: { key, text } });
}));

module.exports = router;
