// Дії в рекламному кабінеті. УСЯ зміна проходить через цю точку: людина, правило чи ШІ — запобіжники однакові й обійти їх не можна.
// Запобіжники з розділу 5 проєкту (номери в дужках). Дві дії: вимкнути/увімкнути оголошення, змінити денний бюджет групи.
// Порядок: перевірка → (проба? тоді лише запис у журнал) → виклик Meta → перечитування з кабінету → журнал до/після.
const { db } = require('@ads/db');
const meta = require('../channels/meta');
const { decrypt, scrub } = require('../lib/secrets');
const { logAction } = require('./journal');
const { toUah, round2 } = require('../lib/money');
const launch = require('./launch');
const { PLATFORM } = require('../lib/describe');

const KINDS = ['pause_ad', 'resume_ad', 'set_adset_budget', 'set_placements', 'replace_creative', 'add_ad'];
const ON_ADSET = ['set_adset_budget', 'set_placements', 'add_ad']; // дії над групою; решта — над оголошенням
const CHANGES = ['set_placements', 'replace_creative', 'add_ad']; // виконуються у change()
const MAX_ADS_DAY = 10; // (5)
const PLACEMENTS = ['facebook', 'instagram', 'messenger', 'threads', 'audience_network'];
const DAY = 86400000;
const MAX_BUDGET_STEP = 0.2; // (7) не більше 20% за раз
const BUDGET_COOLDOWN_DAYS = 3; // (7) і не частіше раз на 3 дні для групи
const FRESH_DAYS = 3; // (8) свіжі зміни й «навчання» не чіпаємо, крім аварійного вимкнення

/** Рівень самостійності, потрібний, щоб актор без людини (правило, ШІ) виконав дію (15). Людина з підтвердженням — завжди. */
const NEEDED_LEVEL = { pause_ad: 2, resume_ad: 3, set_adset_budget: 3, set_placements: 4, replace_creative: 4, add_ad: 4 }; // 4 = лише людина

const money = (n) => `${Math.round(n)} грн`;

/** Чиста перевірка без запису в Meta. Повертає { ok, reasons[], notes[], ... }. */
async function check(project, input, { actor = 'user:' } = {}) {
  const reasons = []; const notes = [];
  const kind = input.kind;
  if (!KINDS.includes(kind)) return { ok: false, reasons: [`Невідома дія. Доступні: ${KINDS.join(', ')}`], notes };

  const human = String(actor).startsWith('user:');
  if (!human && project.autonomyLevel < NEEDED_LEVEL[kind]) reasons.push(`(15) Рівень самостійності ${project.autonomyLevel} менший за потрібний ${NEEDED_LEVEL[kind]}: без підтвердження людини ця дія не виконується`);

  const onSet = ON_ADSET.includes(kind);
  const ad = onSet ? null : await db.ad.findFirst({ where: { projectId: project.id, id: String(input.adId || '') }, include: { adSet: true, campaign: true } });
  const adSet = onSet ? await db.adSet.findFirst({ where: { projectId: project.id, id: String(input.adSetId || '') }, include: { campaign: true } }) : ad?.adSet;
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

  let creative = null;
  if (kind === 'set_placements' || kind === 'replace_creative') {
    // (8) Зміна площадок чи креативу перезапускає навчання: свіжі й «навчальні» групи не чіпаємо.
    if (adSet.learningStage === 'LEARNING') reasons.push('(8) Група ще навчається: площадки й креатив зараз не чіпаємо');
    if (adSet.extUpdatedAt && Date.now() - new Date(adSet.extUpdatedAt).getTime() < FRESH_DAYS * DAY) reasons.push(`(8) Групу змінювали менше ${FRESH_DAYS} днів тому: зачекайте, щоб Meta не скинула навчання`);
    const since = new Date(Date.now() - FRESH_DAYS * DAY);
    const own = onSet ? adSet.externalId : ad.externalId;
    if (await db.actionLog.findFirst({ where: { projectId: project.id, kind, target: own, status: 'done', createdAt: { gte: since } } })) reasons.push(`(8) Тут уже міняли це менше ${FRESH_DAYS} днів тому`);
  }
  if (kind === 'set_placements') {
    const list = Array.isArray(input.placements) ? input.placements : [];
    if (!list.length || list.some((x) => !PLACEMENTS.includes(x))) reasons.push('Оберіть хоча б одну площадку зі списку');
    if (list.includes('threads') && !list.includes('instagram')) reasons.push('Threads працює лише разом з Instagram');
    notes.push(`Площадки: ${list.map((x) => PLATFORM[x] || x).join(', ')}`);
  }
  if (kind === 'replace_creative' || kind === 'add_ad') creative = await checkCreative(project, input.creativeId, reasons, notes);

  let place = null; // куди й від кого піде нове оголошення
  if (kind === 'add_ad') {
    if (adSet.learningStage === 'LEARNING') reasons.push('(8) Група ще навчається: нові оголошення додавайте, коли навчання закінчиться');
    const dayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const added = await db.actionLog.count({ where: { projectId: project.id, kind: 'add_ad', status: 'done', createdAt: { gte: dayStart } } });
    const launched = (await db.launch.findMany({ where: { projectId: project.id, createdInMetaAt: { gte: dayStart } } })).reduce((n, l) => n + Object.values(l.ids?.items || {}).filter((i) => i.ad).length, 0);
    if (added + launched >= MAX_ADS_DAY) reasons.push(`(5) Сьогодні вже ${added + launched} нових оголошень: більше ${MAX_ADS_DAY} на добу не можна`);
    const sibling = await db.ad.findFirst({ where: { adSetId: adSet.id, linkUrl: { not: null } }, orderBy: { extCreatedAt: 'desc' } });
    const defaults = conn?.config?.launchDefaults || {};
    const link = String(input.link || '').trim() || sibling?.linkUrl || null;
    let url = null; try { url = link ? new URL(link) : null; } catch { /* крива адреса */ }
    if (!url || url.protocol !== 'https:') reasons.push('Вкажіть, куди веде оголошення: адресу https://… (для бота https://t.me/імʼя?start=воронка)');
    else if (/(^|\.)t\.me$/i.test(url.hostname) && !url.searchParams.get('start')) reasons.push('У посиланні на бота має бути ?start=код_воронки');
    if (!sibling && !defaults.pageId) reasons.push('Невідома Facebook-сторінка: створіть перше оголошення зі сторінки «Запуск»');
    if (url) { notes.push(`Нове оголошення буде вимкненим. Веде на ${url.origin}${url.pathname}`); place = { link: url.toString(), siblingAd: sibling?.externalId || null, pageId: defaults.pageId || null, instagramId: defaults.instagramId || null }; }
  }

  return { ok: reasons.length === 0, reasons, notes, creative, place, adExtId: ad?.externalId, ad: ad && { id: ad.id, name: ad.name, status: ad.status }, adSet: { id: adSet.id, name: adSet.name, externalId: adSet.externalId }, connectionId: conn?.id, campaignId: campaign.id, spentToday: round2(spentToday), limit: round2(limit), dryRun: !!project.dryRun };
}

/** (4) Креатив із контент-платформи, придатний для кабінету; причини відмови дописує в reasons. */
async function checkCreative(project, creativeId, reasons, notes) {
  try {
    const got = await launch.contentCreatives(project);
    const c = got.creatives.find((x) => x.id === creativeId);
    if (!c) { reasons.push('Креатив не знайдено в контент-платформі'); return null; }
    if (c.violations?.length) reasons.push(`(4) Креатив №${c.number} не пройшов перевірку правил реклами: ${c.violations.join('; ')}`);
    else if (c.status === 'draft') reasons.push(`(4) Креатив №${c.number} ще чернетка`);
    const text = launch.parseCreativeText(c.text);
    if (!text) reasons.push(`Креатив №${c.number}: не вдалося прочитати текст і заголовок`);
    let media = null; try { media = new URL(c.mediaUrl); } catch { /* нема файла */ }
    if (!media || !got.origins.includes(media.origin)) reasons.push(`Креатив №${c.number}: нема картинки з контент-платформи`);
    else if (c.mediaType !== 'image') reasons.push('Звідси можна лише картинку; з відео створюйте кампанію на сторінці «Запуск»');
    if (!text) return null;
    notes.push(`Креатив №${c.number}: «${text.headline}»`);
    return { id: c.id, number: c.number, mediaUrl: c.mediaUrl, origins: got.origins, ...text };
  } catch (e) { reasons.push(`(4) Не вдалося перевірити креатив: ${scrub(e.message)}`); return null; }
}

/** Мітка оголошення в посиланні: щоб візити й діалоги привʼязувались саме до нього. */
function tagLink(link, adId) {
  const u = new URL(link);
  if (/(^|\.)t\.me$/i.test(u.hostname)) { const start = (u.searchParams.get('start') || '').replace(/__[ac][A-Za-z0-9]+$/, ''); if (start) u.searchParams.set('start', `${start}__a${adId}`); } else u.searchParams.set('ad_id', adId);
  return u.toString();
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
  const logTarget = ON_ADSET.includes(input.kind) ? verdict.adSet?.externalId : verdict.adExtId;
  const reasonText = input.reason ? String(input.reason).slice(0, 500) : null;
  if (!verdict.ok) {
    await logAction(project.id, actor, input.kind, { target: logTarget || String(input.adId || input.adSetId || ''), reason: `${reasonText || ''}${reasonText ? ' | ' : ''}${verdict.reasons.join('; ')}`, status: 'blocked' });
    return { status: 'blocked', reasons: verdict.reasons, notes: verdict.notes };
  }
  if (CHANGES.includes(input.kind)) return change(project, input, verdict, { actor, target, logTarget, reasonText });
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

/** Зміна площадок групи або креативу оголошення (після запобіжників): читаємо з кабінету → міняємо → перечитуємо (17). */
async function change(project, input, verdict, { actor, target, logTarget, reasonText }) {
  const conn = await db.connection.findUnique({ where: { id: verdict.connectionId } });
  let before = null; let after = null;
  const fail = async (message) => { await logAction(project.id, actor, input.kind, { target: logTarget, before, after, reason: message.slice(0, 500), status: 'failed' }); return { status: 'failed', message }; };
  if (project.dryRun) {
    await logAction(project.id, actor, input.kind, { target: logTarget, after: input.kind === 'set_placements' ? { placements: input.placements } : { creative: verdict.creative.number }, reason: reasonText, status: 'dry_run' });
    return { status: 'dry_run', message: `Режим «проба»: ${target} — нічого не змінено, дію записано в журнал як «зробив би».` };
  }
  try {
    const token = decrypt(conn.secretWrite);
    if (input.kind === 'add_ad') {
      const { place, creative: c } = verdict;
      const story = place.siblingAd ? (await meta.readAdCreative(token, place.siblingAd)).object_story_spec || {} : {};
      const spec = { pageId: story.page_id || place.pageId, instagramId: story.instagram_user_id || place.instagramId, destination: { type: /\/\/t\.me\//i.test(place.link) ? 'telegram' : 'site' } };
      const bare = new URL(place.link); bare.searchParams.delete('ad_id');
      const name = `№${c.number} · ${c.headline}`.slice(0, 240);
      const imageHash = await meta.uploadImage(token, conn.externalId, await launch.download(c.mediaUrl, c.origins));
      const first = await meta.createCreative(token, conn.externalId, launch.creativeFields(spec, c, { imageHash }, bare.toString(), name));
      const adId = await meta.createAd(token, conn.externalId, { name, adset_id: logTarget, creative: { creative_id: first } });
      after = { ad: adId, creative: c.number, status: 'PAUSED' };
      const link = tagLink(place.link, adId);
      const finalId = await meta.createCreative(token, conn.externalId, launch.creativeFields(spec, c, { imageHash }, link, name));
      await meta.setAdCreative(token, adId, finalId);
      if ((await meta.readBack(token, adId)).status !== 'PAUSED') { await meta.setStatus(token, adId, 'PAUSED'); return fail('Нове оголошення виявилось не вимкненим: його вимкнено, перевірте в Ads Manager.'); }
      await db.ad.create({ data: { projectId: project.id, campaignId: verdict.campaignId, adSetId: verdict.adSet.id, channel: 'meta', externalId: adId, name, status: 'PAUSED', effectiveStatus: 'PAUSED', creativeId: finalId, title: c.headline, body: c.primary, linkUrl: link, imageUrl: c.mediaUrl, content2PostId: c.id, extCreatedAt: new Date() } });
    } else if (input.kind === 'set_placements') {
      const current = await meta.readTargeting(token, logTarget);
      const next = { ...current, publisher_platforms: input.placements };
      // Налаштування, привʼязані до вимкненої площадки, Meta не приймає.
      if (!input.placements.includes('audience_network')) { delete next.audience_network_positions; if (next.brand_safety_content_filter_levels) next.brand_safety_content_filter_levels = next.brand_safety_content_filter_levels.filter((x) => !x.startsWith('AN_')); }
      for (const p of ['facebook', 'instagram', 'messenger', 'threads']) if (!input.placements.includes(p)) delete next[`${p}_positions`];
      before = { placements: current.publisher_platforms || 'автоматичні' }; after = { placements: input.placements };
      await meta.setTargeting(token, logTarget, next);
      const back = (await meta.readTargeting(token, logTarget)).publisher_platforms || [];
      if ([...back].sort().join() !== [...input.placements].sort().join()) return fail('Meta прийняла запит, але площадки в кабінеті інші. Перевірте групу в Ads Manager.');
      await db.adSet.update({ where: { id: verdict.adSet.id }, data: { targeting: next, extUpdatedAt: new Date() } });
    } else {
      const old = await meta.readAdCreative(token, logTarget);
      const story = old.object_story_spec || {};
      const oldLink = story.link_data?.link || story.video_data?.call_to_action?.value?.link;
      if (!story.page_id || !oldLink) return fail('У цього оголошення креатив з готового допису: замінити його звідси не можна');
      const u = new URL(tagLink(oldLink, logTarget)); const telegram = /(^|\.)t\.me$/i.test(u.hostname);
      const c = verdict.creative; const name = `№${c.number} · ${c.headline}`.slice(0, 240);
      const imageHash = await meta.uploadImage(token, conn.externalId, await launch.download(c.mediaUrl, c.origins));
      const fields = launch.creativeFields({ pageId: story.page_id, instagramId: story.instagram_user_id, destination: { type: telegram ? 'telegram' : 'site' } }, c, { imageHash }, u.toString(), name);
      const newId = await meta.createCreative(token, conn.externalId, fields);
      before = { creative: old.id }; after = { creative: newId, number: c.number };
      await meta.setAdCreative(token, logTarget, newId);
      if (String((await meta.readAdCreative(token, logTarget)).id) !== String(newId)) return fail('Meta прийняла запит, але креатив в оголошенні не змінився. Перевірте в Ads Manager.');
      await db.ad.update({ where: { id: verdict.ad.id }, data: { creativeId: newId, title: c.headline, body: c.primary, linkUrl: u.toString(), content2PostId: c.id, imageUrl: c.mediaUrl, extUpdatedAt: new Date() } });
      await db.adSet.update({ where: { id: verdict.adSet.id }, data: { extUpdatedAt: new Date() } });
    }
  } catch (e) {
    return fail(e.name === 'MetaError' ? launch.explain(e) : scrub(e.message));
  }
  await logAction(project.id, actor, input.kind, { target: logTarget, before, after, reason: reasonText, status: 'done' });
  return { status: 'done', message: input.kind === 'add_ad' ? `Оголошення додано в групу «${target}» вимкненим. Увімкніть його, коли перевірите.` : `Готово: ${target}. Meta перевірить зміну, перші цифри будуть після синхронізації.` };
}

module.exports = { check, perform, KINDS, NEEDED_LEVEL };
