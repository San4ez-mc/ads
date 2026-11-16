// Які кроки вважаються продажем і скільки коштує продаж, якщо джерело не передало суму.
const { db } = require('@ads/db');

/** Map "тип:ref|ключ кроку" → { amount: сума за замовчуванням або null }. Якщо жодного кроку не позначено — продажем вважається pay_success сайту. */
async function saleSteps(projectId) {
  const rows = await db.step.findMany({ where: { isSale: true, element: { projectId } }, select: { key: true, defaultAmount: true, element: { select: { type: true, ref: true } } } });
  const m = new Map(rows.map((s) => [`${s.element.type}:${s.element.ref}|${s.key}`, { amount: s.defaultAmount === null ? null : Number(s.defaultAmount) }]));
  return { has: (type, ref, key) => (m.size ? m.has(`${type}:${ref}|${key}`) : key === 'pay_success'), amountOf: (type, ref, key, people, sum) => { const d = m.get(`${type}:${ref}|${key}`); return Number(sum) > 0 ? Number(sum) : (d && d.amount ? d.amount * people : 0); } };
}

module.exports = { saleSteps };
