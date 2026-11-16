// Синхронізація на ЧИТАННЯ: структура й статистика кабінету, події сайтів. Нічого в кабінеті не змінює.
// Запускає воронка Flows за розкладом (POST /api/sync/run з ключем проєкту) або кнопка на платформі.
const { db } = require('@ads/db');
const logger = require('@ads/logger');
const meta = require('../channels/meta');
const site = require('../channels/site');
const flows = require('../channels/flows');
const { decrypt, scrub } = require('../lib/secrets');

const day = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`);
const dt = (s) => (s ? new Date(s) : null);
const ymd = (d) => d.toISOString().slice(0, 10);

async function withRun(projectId, connectionId, kind, fn) {
  const run = await db.syncRun.create({ data: { projectId, connectionId, kind } });
  try {
    const stats = await fn();
    await db.syncRun.update({ where: { id: run.id }, data: { status: 'ok', finishedAt: new Date(), stats } });
    await db.connection.update({ where: { id: connectionId }, data: { lastSyncAt: new Date(), lastError: null, status: 'ok' } });
    return { kind, connectionId, ok: true, stats };
  } catch (e) {
    const message = scrub(e.message);
    logger.warn(`[sync] ${kind} ${connectionId}: ${message}`);
    await db.syncRun.update({ where: { id: run.id }, data: { status: 'error', finishedAt: new Date(), error: message } });
    await db.connection.update({ where: { id: connectionId }, data: { lastError: message, status: 'error' } });
    return { kind, connectionId, ok: false, error: message, rateLimited: !!e.rateLimited };
  }
}

async function syncMetaStructure(conn) {
  return withRun(conn.projectId, conn.id, 'meta_structure', async () => {
    const token = decrypt(conn.secretRead);
    const s = await meta.fetchStructure(token, conn.externalId);
    const campId = new Map(); const setId = new Map();
    for (const c of s.campaigns) {
      const data = { name: c.name || '(без назви)', status: c.status, effectiveStatus: c.effectiveStatus, objective: c.objective, dailyBudget: c.dailyBudget, extCreatedAt: dt(c.extCreatedAt), syncedAt: new Date() };
      const row = await db.campaign.upsert({ where: { connectionId_externalId: { connectionId: conn.id, externalId: c.externalId } }, update: data, create: { ...data, projectId: conn.projectId, connectionId: conn.id, channel: 'meta', externalId: c.externalId } });
      campId.set(c.externalId, row.id);
    }
    let skipped = 0;
    for (const a of s.adSets) {
      const campaignId = campId.get(a.campaignExternalId);
      if (!campaignId) { skipped += 1; continue; }
      const data = { name: a.name || '(без назви)', status: a.status, effectiveStatus: a.effectiveStatus, dailyBudget: a.dailyBudget, optimizationGoal: a.optimizationGoal, learningStage: a.learningStage, targeting: a.targeting, extCreatedAt: dt(a.extCreatedAt), extUpdatedAt: dt(a.extUpdatedAt), syncedAt: new Date() };
      const row = await db.adSet.upsert({ where: { campaignId_externalId: { campaignId, externalId: a.externalId } }, update: data, create: { ...data, projectId: conn.projectId, campaignId, channel: 'meta', externalId: a.externalId } });
      setId.set(a.externalId, row.id);
    }
    for (const a of s.ads) {
      const campaignId = campId.get(a.campaignExternalId); const adSetId = setId.get(a.adSetExternalId);
      if (!campaignId || !adSetId) { skipped += 1; continue; }
      const data = { name: a.name || '(без назви)', status: a.status, effectiveStatus: a.effectiveStatus, creativeId: a.creativeId, title: a.title, body: a.body, imageUrl: a.imageUrl, thumbnailUrl: a.thumbnailUrl, videoId: a.videoId, linkUrl: a.linkUrl, cta: a.cta, previewUrl: a.previewUrl, extCreatedAt: dt(a.extCreatedAt), extUpdatedAt: dt(a.extUpdatedAt), syncedAt: new Date() };
      await db.ad.upsert({ where: { adSetId_externalId: { adSetId, externalId: a.externalId } }, update: data, create: { ...data, projectId: conn.projectId, campaignId, adSetId, channel: 'meta', externalId: a.externalId } });
    }
    return { campaigns: s.campaigns.length, adSets: s.adSets.length, ads: s.ads.length, skipped };
  });
}

/** Останні `days` днів перечитуються щоразу: Meta уточнює цифри заднім числом. */
async function syncMetaInsights(conn, days = 7) {
  return withRun(conn.projectId, conn.id, 'meta_insights', async () => {
    const token = decrypt(conn.secretRead);
    const until = new Date(); const since = new Date(until.getTime() - (Math.max(1, Math.min(90, days)) - 1) * 86400000);
    const rows = await meta.fetchInsights(token, conn.externalId, ymd(since), ymd(until));
    const ads = await db.ad.findMany({ where: { projectId: conn.projectId, channel: 'meta', externalId: { in: [...new Set(rows.map((r) => r.adExternalId))] } }, select: { id: true, externalId: true } });
    const byExt = new Map(ads.map((a) => [a.externalId, a.id]));
    let saved = 0; let unknown = 0; let spend = 0;
    for (const r of rows) {
      const adId = byExt.get(r.adExternalId);
      if (!adId) { unknown += 1; continue; }
      const data = { spend: r.spend, currency: r.currency, impressions: r.impressions, reach: r.reach, clicks: r.clicks, linkClicks: r.linkClicks, frequency: r.frequency, actions: r.actions };
      await db.insightDaily.upsert({ where: { adId_date: { adId, date: day(r.date) } }, update: data, create: { ...data, adId, date: day(r.date) } });
      saved += 1; spend += r.spend;
    }
    return { rows: rows.length, saved, unknownAds: unknown, spend: Math.round(spend * 100) / 100, since: ymd(since), until: ymd(until) };
  });
}

async function syncSiteEvents(conn) {
  return withRun(conn.projectId, conn.id, 'site_events', async () => {
    const key = decrypt(conn.secretRead);
    // Перелік кроків сайтів → елементи шляху (карта малює сайт із них).
    const sites = await site.fetchSites(conn.externalId, key).catch(() => []);
    for (const s of sites) {
      const el = await db.element.upsert({ where: { projectId_type_ref: { projectId: conn.projectId, type: 'site', ref: String(s.id) } }, update: { name: s.name || s.domain || String(s.id), config: { domain: s.domain, variants: s.variants || [] } }, create: { projectId: conn.projectId, type: 'site', ref: String(s.id), name: s.name || s.domain || String(s.id), config: { domain: s.domain, variants: s.variants || [] } } });
      for (const st of s.steps || []) {
        const data = { title: st.title || st.key, order: Number(st.order) || 0, branch: st.branch || null, isSale: !!st.is_sale, leadsTo: st.leads_to || null };
        await db.step.upsert({ where: { elementId_key: { elementId: el.id, key: String(st.key) } }, update: data, create: { ...data, elementId: el.id, key: String(st.key) } });
      }
    }
    let after = conn.cursor || '0'; let total = 0; let pages = 0;
    for (; pages < 20; pages += 1) {
      const { events, lastId, hasMore } = await site.fetchEvents(conn.externalId, key, after);
      for (const e of events) {
        const src = e.source || {}; const first = e.first_source || {};
        const adExtId = src.ad_id || first.ad_id || null;
        const base = { stepKey: String(e.step), ts: new Date(e.ts), personKey: e.visitor_id || null, clickId: e.click_id || null, variant: e.variant || null, adExtId, adSetExtId: src.adset_id || null, campaignExtId: src.campaign_id || null, utmSource: src.utm_source || first.utm_source || null, amount: e.amount ?? null, currency: e.currency || null, orderId: e.order_id ? String(e.order_id) : null, isTest: !!e.is_test };
        await db.stepEvent.upsert({ where: { projectId_elementType_elementRef_sourceId: { projectId: conn.projectId, elementType: 'site', elementRef: String(e.site), sourceId: String(e.id) } }, update: base, create: { ...base, projectId: conn.projectId, elementType: 'site', elementRef: String(e.site), sourceId: String(e.id) } });
        if (e.click_id && e.step === 'view') {
          const click = { personKey: e.visitor_id || null, ts: new Date(e.ts), adExtId: src.ad_id || null, adSetExtId: src.adset_id || null, campaignExtId: src.campaign_id || null, utmSource: src.utm_source || null, utmContent: src.utm_content || null, placement: src.placement || null, site: String(e.site), variant: e.variant || null };
          await db.click.upsert({ where: { projectId_clickId: { projectId: conn.projectId, clickId: String(e.click_id) } }, update: {}, create: { ...click, projectId: conn.projectId, clickId: String(e.click_id) } });
        }
      }
      total += events.length; after = String(lastId);
      await db.connection.update({ where: { id: conn.id }, data: { cursor: after } });
      if (!hasMore || !events.length) break;
    }
    return { sites: sites.length, events: total, cursor: after };
  });
}

/** Етапи ботів-воронок Flows: перелік етапів → елемент шляху, події → кроки з джерелом реклами. */
async function syncFlowsStages(conn) {
  return withRun(conn.projectId, conn.id, 'flows_stages', async () => {
    const key = decrypt(conn.secretRead);
    const slugs = Array.isArray(conn.config?.slugs) ? conn.config.slugs : [];
    if (!slugs.length) return { funnels: 0, events: 0, note: 'у підключенні не вказано воронок' };
    const funnels = await flows.fetchFunnels(conn.externalId, key, slugs);
    for (const f of funnels) {
      const el = await db.element.upsert({ where: { projectId_type_ref: { projectId: conn.projectId, type: 'flows', ref: f.slug } }, update: { name: f.name, config: { botId: f.botId } }, create: { projectId: conn.projectId, type: 'flows', ref: f.slug, name: f.name, config: { botId: f.botId } } });
      for (const st of f.stages) {
        // Чи є етап продажем і яка сума — задає власник на платформі; синхронізація цього не перезаписує.
        const data = { title: st.name, order: Number(st.order) || 0, branch: st.side ? 'side' : null };
        await db.step.upsert({ where: { elementId_key: { elementId: el.id, key: st.name } }, update: data, create: { ...data, elementId: el.id, key: st.name } });
      }
    }
    let after = conn.cursor || null; let total = 0;
    for (let page = 0; page < 20; page += 1) {
      const { events, next, hasMore } = await flows.fetchEvents(conn.externalId, key, slugs, after);
      for (const e of events) {
        const base = { stepKey: String(e.stage), ts: new Date(e.ts), personKey: String(e.sessionId), clickId: e.clickId || null, adExtId: e.adId || null, isTest: !!e.isTest, utmSource: e.clickId || e.adId ? 'meta' : null };
        const where = { projectId_elementType_elementRef_sourceId: { projectId: conn.projectId, elementType: 'flows', elementRef: String(e.slug), sourceId: `${e.sessionId}|${e.stage}` } };
        // Оголошення, вже визначене за кодом заходу, повторним читанням не затираємо.
        await db.stepEvent.upsert({ where, update: { ts: base.ts, isTest: base.isTest, clickId: base.clickId, ...(base.adExtId ? { adExtId: base.adExtId } : {}) }, create: { ...base, projectId: conn.projectId, elementType: 'flows', elementRef: String(e.slug), sourceId: `${e.sessionId}|${e.stage}` } });
      }
      total += events.length; after = next;
      await db.connection.update({ where: { id: conn.id }, data: { cursor: after } });
      if (!hasMore || !events.length) break;
    }
    return { funnels: funnels.length, events: total, cursor: after };
  });
}

/** Бот знає лише код заходу з лендінгу; оголошення за цим кодом знає сайт. Зводимо: подія з кодом, але без оголошення, отримує оголошення з таблиці заходів. */
async function resolveClicks(projectId) {
  return db.$executeRaw`
    UPDATE step_events se SET ad_ext_id = c.ad_ext_id, ad_set_ext_id = c.ad_set_ext_id, campaign_ext_id = c.campaign_ext_id
    FROM clicks c
    WHERE se.project_id = ${projectId} AND c.project_id = se.project_id AND c.click_id = se.click_id
      AND se.ad_ext_id IS NULL AND c.ad_ext_id IS NOT NULL`;
}

/** Повна синхронізація проєкту. Обмеження частоти в одному підключенні зупиняє лише його, не решту. */
async function runProjectSync(projectId, { kinds = ['structure', 'insights', 'site', 'flows'], days = 7 } = {}) {
  const conns = await db.connection.findMany({ where: { projectId, secretRead: { not: null } } });
  const results = [];
  for (const c of conns) {
    if (c.channel === 'meta') {
      if (kinds.includes('structure')) { const r = await syncMetaStructure(c); results.push(r); if (!r.ok) continue; }
      if (kinds.includes('insights')) results.push(await syncMetaInsights(c, days));
    } else if (c.channel === 'site' && kinds.includes('site')) {
      results.push(await syncSiteEvents(c));
    } else if (c.channel === 'flows' && kinds.includes('flows')) {
      results.push(await syncFlowsStages(c));
    }
  }
  const resolved = await resolveClicks(projectId).catch((e) => { logger.warn(`[sync] resolveClicks: ${e.message}`); return 0; });
  return { connections: conns.length, results, resolvedClicks: Number(resolved) || 0, ok: results.every((r) => r.ok) };
}

module.exports = { runProjectSync, syncMetaStructure, syncMetaInsights, syncSiteEvents, syncFlowsStages, resolveClicks };
