// Ручні позначки власника: клієнт, консультація відбулась, продаж дорожчого продукту, етапи Instagram-повідомлень.
// Кожна позначка стає ПОДІЄЮ кроку (step_events) з тим самим номером оголошення — тож карта, ціна продажу, звіти й рекомендації
// порахують її без окремого коду. Імена й телефони сюди не потрапляють: подія несе лише ключ клієнта.
const { db } = require('@ads/db');

const IG_STAGES = ['wrote', 'answered', 'offer', 'paid'];
const MANUAL = [
  // [тип, код, назва, кроки: ключ, назва, порядок, продаж?, сума за замовчуванням]
  ['manual', 'consult', 'Консультація і продаж далі (позначаєте вручну)', [['done', 'Консультація відбулась', 1, false, null], ['upsell', 'Купив дорожчий продукт', 2, false, null], ['no_show', 'Не було на зустрічі', 3, false, null], ['refused', 'Відмова після зустрічі', 4, false, null]]],
  ['instagram', 'direct', 'Повідомлення в Instagram (вручну)', [['wrote', 'Написав у дірект', 1, false, null], ['answered', 'Отримав відповідь', 2, false, null], ['offer', 'Отримав пропозицію консультації', 3, false, null], ['paid', 'Оплатив', 4, true, null]]],
];

/** Гарантує, що ручні елементи й кроки існують. «Дорожчий продукт» — НЕ продаж для ціни продажу (рахується окремо як дохід). */
async function ensureManual(projectId) {
  for (const [type, ref, name, steps] of MANUAL) {
    const el = (await db.element.findUnique({ where: { projectId_type_ref: { projectId, type, ref } } })) || (await db.element.create({ data: { projectId, type, ref, name } }));
    for (const [key, title, order, isSale, defaultAmount] of steps) {
      const cur = await db.step.findUnique({ where: { elementId_key: { elementId: el.id, key } } });
      if (!cur) await db.step.create({ data: { elementId: el.id, key, title, order, isSale, defaultAmount } });
      else if (type === 'manual' && key === 'upsell' && cur.isSale) await db.step.update({ where: { id: cur.id }, data: { isSale: false } });
    }
  }
}

const evKey = (projectId, type, ref, sourceId) => ({ projectId_elementType_elementRef_sourceId: { projectId, elementType: type, elementRef: ref, sourceId } });

async function putEvent(client, type, ref, step, sourceId, ts, amount) {
  const data = { stepKey: step, ts, personKey: client.personKey || `client:${client.id}`, clickId: client.clickId || null, adExtId: client.adExtId || null, amount: amount ?? null, currency: amount ? 'UAH' : null, isTest: false };
  await db.stepEvent.upsert({ where: evKey(client.projectId, type, ref, sourceId), update: data, create: { ...data, projectId: client.projectId, elementType: type, elementRef: ref, sourceId } });
}
const dropEvent = (client, type, ref, sourceId) => db.stepEvent.deleteMany({ where: { projectId: client.projectId, elementType: type, elementRef: ref, sourceId } });

/** Приводить події у відповідність до стану клієнта (ідемпотентно: можна викликати скільки завгодно). */
async function syncClientEvents(clientId) {
  const c = await db.client.findUnique({ where: { id: clientId }, include: { sales: true } });
  if (!c) return;
  await ensureManual(c.projectId);
  // Консультація
  if (c.consultDone) await putEvent(c, 'manual', 'consult', 'done', `client:${c.id}:done`, c.consultAt || new Date(), null);
  else await dropEvent(c, 'manual', 'consult', `client:${c.id}:done`);
  // Чим закінчилась зустріч: «не було» й «відмова» — окремі кроки, щоб їх було видно на карті.
  for (const k of ['no_show', 'refused']) {
    if (c.outcome === k) await putEvent(c, 'manual', 'consult', k, `client:${c.id}:${k}`, c.consultAt || new Date(), null);
    else await dropEvent(c, 'manual', 'consult', `client:${c.id}:${k}`);
  }
  // Дорожчі продажі: по події на кожен продаж із сумою
  const keep = new Set(c.sales.map((s) => `client:${c.id}:sale:${s.id}`));
  for (const s of c.sales) await putEvent(c, 'manual', 'consult', 'upsell', `client:${c.id}:sale:${s.id}`, s.soldAt, Number(s.amount));
  const old = await db.stepEvent.findMany({ where: { projectId: c.projectId, elementType: 'manual', elementRef: 'consult', stepKey: 'upsell', sourceId: { startsWith: `client:${c.id}:sale:` } }, select: { id: true, sourceId: true } });
  const gone = old.filter((e) => !keep.has(e.sourceId)).map((e) => e.id);
  if (gone.length) await db.stepEvent.deleteMany({ where: { id: { in: gone } } });
  // Instagram-повідомлення: події всіх кроків до поточного етапу
  if (c.source === 'instagram') {
    const upto = Math.max(0, IG_STAGES.indexOf(c.stage || 'wrote'));
    for (let i = 0; i < IG_STAGES.length; i += 1) {
      const sid = `client:${c.id}:ig:${IG_STAGES[i]}`;
      if (i <= upto) await putEvent(c, 'instagram', 'direct', IG_STAGES[i], sid, c.createdAt, null);
      else await dropEvent(c, 'instagram', 'direct', sid);
    }
  }
}

async function removeClientEvents(client) {
  await db.stepEvent.deleteMany({ where: { projectId: client.projectId, sourceId: { startsWith: `client:${client.id}:` }, elementType: { in: ['manual', 'instagram'] } } });
}

module.exports = { ensureManual, syncClientEvents, removeClientEvents, IG_STAGES };
