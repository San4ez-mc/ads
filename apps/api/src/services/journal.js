// Журнал дій (запобіжник 18). Запис ніколи не ламає саму дію.
const { db } = require('@ads/db');
const logger = require('@ads/logger');

async function logAction(projectId, actor, kind, { target, before, after, reason, status } = {}) {
  try {
    await db.actionLog.create({ data: { projectId, actor: String(actor || 'system'), kind, target: target || null, before: before ?? undefined, after: after ?? undefined, reason: reason || null, status: status || 'done' } });
  } catch (e) { logger.warn(`[journal] ${kind}: ${e.message}`); }
}

module.exports = { logAction };
