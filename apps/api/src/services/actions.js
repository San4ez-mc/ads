// Дії в рекламному кабінеті. УСЯ зміна проходить через цю точку: людина, правило чи ШІ — запобіжники однакові й обійти їх не можна.
// Запобіжники з розділу 5 проєкту (номери в дужках). Дві дії: вимкнути/увімкнути оголошення, змінити денний бюджет групи.
// Порядок: перевірка → (проба? тоді лише запис у журнал) → виклик Meta → перечитування з кабінету → журнал до/після.
const { db } = require('@ads/db');
const meta = require('../channels/meta');
const { decrypt, scrub } = require('../lib/secrets');
const { logAction } = require('./journal');
const { toUah, round2 } = require('../lib/money');

const KINDS = ['pause_ad', 'resume_ad', 'set_adset_budget'];
const DAY = 86400000;
const MAX_BUDGET_STEP = 0.2; // (7) не більше 20% за раз
const BUDGET_COOLDOWN_DAYS = 3; // (7) і не частіше раз на 3 дні для групи
const FRESH_DAYS = 3; // (8) свіжі зміни й «навчання» не чіпаємо, крім аварійного вимкнення

/** Рівень самостійності, потрібний, щоб актор без людини (правило, ШІ) виконав дію (15). Людина з підтвердженням — завжди. */
const NEEDED_LEVEL = { pause_ad: 2, resume_ad: 3, set_adset_budget: 3 };

const money = (n) => `${Math.round(n)} грн`;

/** Чиста перевірка без запису в Meta. Повертає { ok, reasons[], notes[], ... }. */
async function check(project, input, { actor = 'user:' } = {}) {
  const reasons = []; const notes = [];
  const kind = input.kind;
  if (!KINDS.includes(kind)) return { ok: false, reasons: [`Невідома дія. Доступні: ${KINDS.join(', ')}`], notes };

  const human = String(actor).startsWith('user:');
  if (!human && project.autonomyLevel < NEEDED_LEVEL[kind]) reasons.push(`(15) Рівень самостійності ${project.autonomyLevel} менший за потрібний ${NEEDED_LEVEL[kind]}: без підтвердження людини ця дія не виконується`);

  const ad = kind === 'set_adset_budget' ? null : await db.ad.findFirst({ where: { projectId: project.id, id: String(input.adId || '') }, include: { adSet: true, campaign: true } });
  const adSet = kind === 'set_adset_budget' ? await db.adSet.findFirst({ where: { projectId: project.id, id: String(input.adSetId || '') }, include: { campaign: true } }) : ad?.adSet;
  if (!adSet) return { ok: false, reasons: ['Об\'єкт не знайдено в синхронізованих даних. Оновіть дані й спробуйте ще раз.'], notes };

  const campaign = ad ? ad.campaign : adSet.campaign; // оголошення тягне кампанію зі свого рівня, група — зі свого
  const conn = await db.connection.findFirst({ where: { projectId: project.id, channel: 'meta', id: campaign.connectionId } });
  if (!conn) reasons.push('Підключення кабінету не знайдено');
  else {
    if (conn.status === 'blocked' || conn.status === 'error') reasons.push(`(13) Підключення «${conn.name}» не в порядку (${conn.status === 'blocked' ? 'кабінет обмежено' : 'помилка ключа'}): автоматика зупинена, доки це не вирішено`);
    if (!conn.secretWrite) reasons.push('Не додано ключ керування (ads_management) у «Підключення». Поточний ключ лише читає.');
  }

  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const spentRows = await db.insightDaily.groupBy({ by: ['currency'], where: { date: today, ad: { projectId: project.id } }, _sum: { spend: true } });
  const spentToday = spentRows.reduce((a, r) => a + toUah(Number(r._sum.spend || 0), r.currency, project), 0);
  const limit = Number(project.dailyLimitUsd) * Number(project.usdRate);

  if (kind === 'pause_ad') {
    // Вимкнення зупиняє витрати — безпечний напрямок, тому без обмежень за даними і «навчанням» (8: аварійне вимкнення).
    if (ad.effectiveStatus === 'PAUSED' || ad.status === 'PAUSED') notes.push('Оголошення вже вимкнене');
  }

  if (kind === 'resume_ad') {
    if (limit > 0 && spentToday >= limit) reasons.push(`(10) Денний ліміт вичерпано: витрачено ${money(spentToday)} з ${money(limit)}. Увімкнути можна завтра або після підняття ліміту власником`);
    if (ad.status === 'ACTIVE') notes.push('Оголошення вже активне');
  }

  if (kind === 'set_adset_budget') {
    const to = Number(input.dailyBudget);
    const from = adSet.dailyBudget === null ? null : Number(adSet.dailyBudget);
    if (!(to > 0)) reasons.push('Бюджет має бути більшим за нуль');
    else if (from === null) reasons.push('Бюджет групи не заданий на рівні групи (можливо, бюджет на рівні кампанії): міняти його платформа не буде');
    else {
      const change = (to - from) / from;
      if (Math.abs(change) > MAX_BUDGET_STEP + 1e-9) reasons.push(`(7) Бюджет можна міняти не більше ніж на 20% за раз: було ${from}, хочете ${to} (${Math.round(change * 100)}%). Дозволений діапазон ${round2(from * (1 - MAX_BUDGET_STEP))}–${round2(from * (1 + MAX_BUDGET_STEP))}`);
      const since = new Date(Date.now() - BUDGET_COOLDOWN_DAYS * DAY);
      const recent = await db.actionLog.findFirst({ where: { projectId: project.id, kind: 'set_adset_budget', target: adSet.externalId, status: { in: ['done', 'dry_run'] }, createdAt: { gte: since } } });
      if (recent) reasons.push(`(7) Бюджет цієї групи вже міняли ${recent.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. Не частіше ніж раз на ${BUDGET_COOLDOWN_DAYS} дні`);
      if (adSet.learningStage === 'LEARNING') reasons.push('(8) Група ще навчається: бюджет у цей час не чіпаємо');
      if (adSet.extUpdatedAt && Date.now() - new Date(adSet.extUpdatedAt).getTime() < FRESH_DAYS * DAY) reasons.push(`(8) Групу змінювали менше ${FRESH_DAYS} днів тому: зачекайте, щоб Meta не скинула навчання`);
      if (to > from) {
        if (limit > 0 && spentToday >= limit) reasons.push(`(10) Денний ліміт вичерпано (${money(spentToday)} з ${money(limit)}): підняти бюджет не можна`);
        // (9) Підняти бюджет можна лише коли оголошення групи справді окупаються.
        const ads = await db.ad.findMany({ where: { adSetId: adSet.id }, select: { externalId: true } });
        const evidence = await salesEvidence(project, ads.map((a) => a.externalId));
        const target = project.targetSaleCost === null ? null : Number(project.targetSaleCost);
        if (!target) reasons.push('(9) Не задано цільову ціну продажу: без неї не можна визначити, що група окупається');
        else if (evidence.sales < 2) reasons.push(`(9) Продажів по групі ${evidence.sales}: потрібно щонайменше 2, щоб довіряти цифрі`);
        else if (evidence.spend / evidence.sales > target) reasons.push(`(9) Ціна продажу по групі ${money(evidence.spend / evidence.sales)} вища за ціль ${money(target)}: піднімати бюджет рано`);
      }
      notes.push(`Бюджет групи: ${from} → ${to}`);
    }
  }

  return { ok: reasons.length === 0, reasons, notes, ad: ad && { id: ad.id, name: ad.name, status: ad.status }, adSet: { id: adSet.id, name: adSet.name, externalId: adSet.externalId }, connectionId: conn?.id, spentToday: round2(spentToday), limit: round2(limit), dryRun: !!project.dryRun };
}

/** Продажі й витрати по списку оголошень за останні 14 днів (для правила 9). */
async function salesEvidence(project, adExtIds) {
  if (!adExtIds.length) return { sales: 0, spend: 0 };
  const from = new Date(Date.now() - 14 * DAY);
  const { saleSteps } = require('../lib/sales');
  const sale = await saleSteps(project.id);
  const events = await db.stepEvent.groupBy({ by: ['elementType', 'elementRef', 'stepKey'], where: { projectId: project.id, isTest: false, adExtId: { in: adExtIds }, ts: { gte: from } }, _count: { _all: true } });
  const sales = events.filter((e) => sale.has(e.elementType, e.elementRef, e.stepKey)).reduce((a, e) => a + e._count._all, 0);
  const ads = await db.ad.findMany({ where: { projectId: project.id, externalId: { in: adExtIds } }, select: { id: true } });
  const sums = await db.insightDaily.groupBy({ by: ['currency'], where: { adId: { in: ads.map((a) => a.id) }, date: { gte: new Date(`${from.toISOString().slice(0, 10)}T00:00:00Z`) } }, _sum: { spend: true } });
  return { sales, spend: sums.reduce((a, r) => a + toUah(Number(r._sum.spend || 0), r.currency, project), 0) };
}

/** Виконати дію. Повертає { status: 'done'|'dry_run'|'blocked'|'failed', ... }. Нічого не кидає назовні, окрім помилок вводу. */
async function perform(project, input, { actor }) {
  const verdict = await check(project, input, { actor });
  const target = verdict.ad ? verdict.ad.name : verdict.adSet?.name;
  const logTarget = input.kind === 'set_adset_budget' ? verdict.adSet?.externalId : (verdict.ad && (await db.ad.findUnique({ where: { id: verdict.ad.id }, select: { externalId: true } }))?.externalId);
  const reasonText = input.reason ? String(input.reason).slice(0, 500) : null;
  if (!verdict.ok) {
    await logAction(project.id, actor, input.kind, { target: logTarget || String(input.adId || input.adSetId || ''), reason: `${reasonText || ''}${reasonText ? ' | ' : ''}${verdict.reasons.join('; ')}`, status: 'blocked' });
    return { status: 'blocked', reasons: verdict.reasons, notes: verdict.notes };
  }
  const before = input.kind === 'set_adset_budget' ? { dailyBudget: (await db.adSet.findUnique({ where: { id: verdict.adSet.id } })).dailyBudget } : { status: verdict.ad.status };
  const after = input.kind === 'set_adset_budget' ? { dailyBudget: Number(input.dailyBudget) } : { status: input.kind === 'pause_ad' ? 'PAUSED' : 'ACTIVE' };
  // (16) Режим «проба»: нічого не міняємо, лише записуємо «зробив би».
  if (project.dryRun) {
    await logAction(project.id, actor, input.kind, { target: logTarget, before, after, reason: reasonText, status: 'dry_run' });
    return { status: 'dry_run', message: `Режим «проба»: ${target} — нічого не змінено, дію записано в журнал як «зробив би».`, before, after };
  }
  const conn = await db.connection.findUnique({ where: { id: verdict.connectionId } });
  let token;
  try { token = decrypt(conn.secretWrite); } catch { return { status: 'failed', message: 'Не вдалося розшифрувати ключ керування: введіть його знову в «Підключення».' }; }
  const objectId = input.kind === 'set_adset_budget' ? verdict.adSet.externalId : logTarget;
  try {
    if (input.kind === 'set_adset_budget') await meta.setDailyBudget(token, objectId, input.dailyBudget);
    else await meta.setStatus(token, objectId, after.status);
  } catch (e) {
    const message = scrub(e.message);
    // (14) Обмеження частоти: зупиняємося, не повторюємо в циклі.
    await logAction(project.id, actor, input.kind, { target: logTarget, before, after, reason: reasonText, status: 'failed' });
    await logAction(project.id, 'system', 'meta_error', { target: logTarget, reason: message.slice(0, 300), status: 'failed' });
    return { status: 'failed', message: e.rateLimited ? 'Meta просить зачекати (ліміт звернень). Спробуйте за кілька хвилин.' : `Meta не прийняла зміну: ${message}` };
  }
  // (17) Перечитуємо з кабінету, чи зміна справді застосувалась.
  let applied = null; let confirmed = false;
  try {
    const back = await meta.readBack(token, objectId);
    applied = { status: back.status, effectiveStatus: back.effective_status, dailyBudget: back.daily_budget ? Number(back.daily_budget) / 100 : null };
    confirmed = input.kind === 'set_adset_budget' ? Math.abs((applied.dailyBudget ?? -1) - Number(input.dailyBudget)) < 0.01 : applied.status === after.status;
  } catch { /* зміна пройшла, але підтвердити не вдалось — скажемо про це чесно */ }
  // Локальні дані одразу відображають зміну, не чекаючи наступної синхронізації.
  if (confirmed) {
    if (input.kind === 'set_adset_budget') await db.adSet.update({ where: { id: verdict.adSet.id }, data: { dailyBudget: Number(input.dailyBudget), extUpdatedAt: new Date() } });
    else await db.ad.update({ where: { id: verdict.ad.id }, data: { status: after.status, effectiveStatus: after.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE' } });
  }
  await logAction(project.id, actor, input.kind, { target: logTarget, before, after: { ...after, confirmedInAccount: confirmed, accountState: applied }, reason: reasonText, status: confirmed ? 'done' : 'failed' });
  if (!confirmed) return { status: 'failed', message: 'Meta прийняла запит, але зміну в кабінеті підтвердити не вдалося. Перевірте оголошення в Ads Manager.', applied };
  return { status: 'done', message: `Готово: ${target}.`, before, after, applied };
}

module.exports = { check, perform, KINDS, NEEDED_LEVEL };
