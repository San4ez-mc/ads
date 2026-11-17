// Дії в кабінеті: перевірка (що дозволять запобіжники) і виконання. Доступ — лише людям із правом затверджувати (сторінка «approve»).
// Ключ проєкту для воронок сюди не допускається (pageAccess.keyAllowed): воронка не може міняти рекламу.
const express = require('express');
const { ValidationError } = require('@ads/errors');
const asyncHandler = require('../middleware/asyncHandler');
const actions = require('../services/actions');

const router = express.Router();

function input(b) {
  const o = { kind: String(b?.kind || ''), reason: b?.reason };
  if (!actions.KINDS.includes(o.kind)) throw new ValidationError(`Дія: ${actions.KINDS.join(', ')}`);
  if (o.kind === 'set_adset_budget') { o.adSetId = String(b.adSetId || ''); o.dailyBudget = Number(b.dailyBudget); if (!o.adSetId) throw new ValidationError('adSetId обовʼязковий'); }
  else { o.adId = String(b.adId || ''); if (!o.adId) throw new ValidationError('adId обовʼязковий'); }
  return o;
}

router.post('/actions/check', asyncHandler(async (req, res) => {
  const r = await actions.check(req.project, input(req.body), { actor: req.actor });
  res.json({ ok: true, data: r });
}));

router.post('/actions', asyncHandler(async (req, res) => {
  // Підтвердження людини обовʼязкове: без явного confirm:true нічого не виконується.
  if (req.body?.confirm !== true) throw new ValidationError('Потрібне явне підтвердження (confirm: true)');
  const r = await actions.perform(req.project, input(req.body), { actor: req.actor });
  res.json({ ok: true, data: r });
}));

module.exports = router;
