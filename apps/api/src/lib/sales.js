// Які кроки вважаються продажем і скільки коштує продаж, якщо джерело не передало суму.
const { db } = require('@ads/db');

/** Map "тип:ref|ключ кроку" → { amount: сума за замовчуванням або null }. Якщо жодного кроку не позначено — продажем вважається pay_success сайту. */
async function saleSteps(projectId) {
  const rows = await db.step.findMany({ where: { isSale: true, element: { projectId } }, select: { key: true, defaultAmount: true, element: { select: { type: true, ref: true } } } });
  const m = new Map(rows.map((s) => [`${s.element.type}:${s.element.ref}|${s.key}`, { amount: s.defaultAmount === null ? null : Number(s.defaultAmount) }]));
  return { has: (type, ref, key) => (m.size ? m.has(`${type}:${ref}|${key}`) : key === 'pay_success'), amountOf: (type, ref, key, people, sum) => { const d = m.get(`${type}:${ref}|${key}`); return Number(sum) > 0 ? Number(sum) : (d && d.amount ? d.amount * people : 0); } };
}

// ПРАВИЛО ВЛАСНИКА (26.11): переможця визначає ціна КЛІЄНТА, а не дешевих заходів. Клієнт = людина, яка заплатила:
// крок-продаж або дорожчий продукт. Та сама людина рахується один раз, скільки б разів і де б не платила.
const isPayment = (sale, e) => sale.has(e.elementType, e.elementRef, e.stepKey) || (e.elementType === 'manual' && e.stepKey === 'upsell');
const payer = (e) => e.personKey || e.sourceId;
const countClients = (sale, events) => new Set(events.filter((e) => isPayment(sale, e)).map(payer)).size;

module.exports = { saleSteps, isPayment, countClients };
