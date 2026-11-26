// Канал Meta (Facebook/Instagram) — ЛИШЕ офіційний Marketing API (запобіжник 1).
// Читання — вільно. Функції запису й створення внизу файлу викликаються ЛИШЕ зі services/actions.js та
// services/launch.js, де стоять запобіжники; маршрути напряму їх не викликають.
const { scrub } = require('../lib/secrets');

const VERSION = process.env.META_API_VERSION || 'v26.0';
const BASE = `https://graph.facebook.com/${VERSION}`;
const PAGE_CAP = 60; // стеля сторінок на один запит-список: захист від нескінченного гортання

class MetaError extends Error {
  constructor(message, { code, subcode, status, rateLimited } = {}) {
    super(scrub(message));
    this.name = 'MetaError'; this.code = code; this.subcode = subcode; this.status = status; this.rateLimited = !!rateLimited;
  }
}

const RATE_CODES = new Set([4, 17, 32, 613, 80000, 80003, 80004, 80014]);

async function call(token, path, params = {}) {
  const url = path.startsWith('http') ? new URL(path) : new URL(`${BASE}/${path.replace(/^\//, '')}`);
  if (!path.startsWith('http')) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  // Ключ — у заголовку, не в адресі: адреси потрапляють у журнали.
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(45_000) }).catch((e) => { throw new MetaError(`Meta недоступна: ${e.message}`); });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error) {
    const e = json?.error || {};
    throw new MetaError(e.error_user_msg || e.message || `Meta HTTP ${res.status}`, { code: e.code, subcode: e.error_subcode, status: res.status, rateLimited: RATE_CODES.has(e.code) || res.status === 429 });
  }
  return json;
}

/** Гортає список до кінця (або до стелі). При обмеженні частоти НЕ повторює в циклі (запобіжник 14) — кидає помилку. */
async function list(token, path, params) {
  const out = [];
  let page = await call(token, path, params);
  for (let i = 0; i < PAGE_CAP; i += 1) {
    out.push(...(page.data || []));
    const next = page.paging?.next;
    if (!next) break;
    const u = new URL(next); u.searchParams.delete('access_token');
    page = await call(token, u.toString());
  }
  return out;
}

const actId = (id) => `act_${String(id).replace(/^act_/, '')}`;
const ACCOUNT_STATUS = { 1: 'активний', 2: 'вимкнений', 3: 'борг за оплату', 7: 'на перевірці ризиків', 8: 'очікує розрахунку', 9: 'пільговий період', 100: 'очікує закриття', 101: 'закритий' };

/** Перевірка підключення: чи ключ живий, чи бачить кабінет, які права має. Повертає людський підсумок. */
async function check(token, accountId) {
  const acc = await call(token, actId(accountId), { fields: 'name,account_status,disable_reason,currency,timezone_name,amount_spent,spend_cap' });
  // Назва бізнес-портфеля — лише довідка і вимагає окремого дозволу business_management: без нього підключення теж працює.
  acc.business = await call(token, actId(accountId), { fields: 'business{id,name}' }).then((r) => r.business, () => null);
  let scopes = []; let tokenType = null; let expiresAt = null;
  try {
    const dbg = await call(token, 'debug_token', { input_token: token });
    scopes = dbg.data?.scopes || []; tokenType = dbg.data?.type || null;
    expiresAt = dbg.data?.expires_at ? new Date(dbg.data.expires_at * 1000).toISOString() : null;
  } catch { /* debug_token доступний не всім ключам — не причина вважати підключення зламаним */ }
  return {
    accountName: acc.name, currency: acc.currency, timezone: acc.timezone_name,
    accountStatus: acc.account_status, accountStatusText: ACCOUNT_STATUS[acc.account_status] || `стан ${acc.account_status}`,
    disableReason: acc.disable_reason || 0, healthy: acc.account_status === 1,
    spendCap: acc.spend_cap && acc.spend_cap !== '0' ? Number(acc.spend_cap) / 100 : null,
    business: acc.business ? { id: acc.business.id, name: acc.business.name } : null,
    scopes, canRead: !scopes.length || scopes.includes('ads_read') || scopes.includes('ads_management'), canManage: scopes.includes('ads_management'),
    tokenType, expiresAt,
  };
}

const money = (minor) => (minor === undefined || minor === null || minor === '' ? null : Number(minor) / 100);

async function fetchStructure(token, accountId) {
  const act = actId(accountId);
  const live = { filtering: [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'WITH_ISSUES', 'IN_PROCESS', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'PREAPPROVED', 'PENDING_BILLING_INFO'] }] };
  const [campaigns, adsets, ads] = await Promise.all([
    list(token, `${act}/campaigns`, { ...live, limit: 200, fields: 'id,name,status,effective_status,objective,daily_budget,created_time' }),
    list(token, `${act}/adsets`, { ...live, limit: 200, fields: 'id,name,campaign_id,status,effective_status,daily_budget,optimization_goal,learning_stage_info,targeting,created_time,updated_time' }),
    list(token, `${act}/ads`, { ...live, limit: 100, fields: 'id,name,campaign_id,adset_id,status,effective_status,created_time,updated_time,preview_shareable_link,creative{id,title,body,image_url,thumbnail_url,video_id,call_to_action_type,object_story_spec,link_url}' }),
  ]);
  return {
    campaigns: campaigns.map((c) => ({ externalId: c.id, name: c.name, status: c.status, effectiveStatus: c.effective_status, objective: c.objective, dailyBudget: money(c.daily_budget), extCreatedAt: c.created_time })),
    adSets: adsets.map((s) => ({ externalId: s.id, campaignExternalId: s.campaign_id, name: s.name, status: s.status, effectiveStatus: s.effective_status, dailyBudget: money(s.daily_budget), optimizationGoal: s.optimization_goal, learningStage: s.learning_stage_info?.status || null, targeting: s.targeting || {}, extCreatedAt: s.created_time, extUpdatedAt: s.updated_time })),
    ads: ads.map((a) => {
      const cr = a.creative || {}; const spec = cr.object_story_spec || {}; const link = spec.link_data || {}; const video = spec.video_data || {};
      return {
        externalId: a.id, campaignExternalId: a.campaign_id, adSetExternalId: a.adset_id, name: a.name, status: a.status, effectiveStatus: a.effective_status,
        creativeId: cr.id || null, title: cr.title || link.name || video.title || null, body: cr.body || link.message || video.message || null,
        imageUrl: cr.image_url || link.picture || video.image_url || null, thumbnailUrl: cr.thumbnail_url || null, videoId: cr.video_id || video.video_id || null,
        linkUrl: cr.link_url || link.link || video.call_to_action?.value?.link || null, cta: cr.call_to_action_type || link.call_to_action?.type || video.call_to_action?.type || null,
        previewUrl: a.preview_shareable_link || null, extCreatedAt: a.created_time, extUpdatedAt: a.updated_time,
      };
    }),
  };
}

const ACTION_KEYS = { lead: 'leads', 'onsite_conversion.lead_grouped': 'leads', 'offsite_conversion.fb_pixel_lead': 'pixelLeads', 'onsite_conversion.messaging_conversation_started_7d': 'conversations', purchase: 'purchases', 'offsite_conversion.fb_pixel_purchase': 'pixelPurchases', landing_page_view: 'landingViews', link_click: 'linkClicks' };

/** Статистика по оголошеннях по днях (дні — за часом кабінету). since/until: YYYY-MM-DD включно. */
async function fetchInsights(token, accountId, since, until) {
  const rows = await list(token, `${actId(accountId)}/insights`, { level: 'ad', time_increment: 1, time_range: { since, until }, limit: 500, fields: 'ad_id,date_start,spend,account_currency,impressions,reach,clicks,inline_link_clicks,frequency,actions' });
  return rows.map((r) => {
    const actions = {};
    for (const a of r.actions || []) { const k = ACTION_KEYS[a.action_type]; if (k) actions[k] = (actions[k] || 0) + Number(a.value || 0); }
    return { adExternalId: r.ad_id, date: r.date_start, spend: Number(r.spend || 0), currency: r.account_currency || 'USD', impressions: Number(r.impressions || 0), reach: Number(r.reach || 0), clicks: Number(r.clicks || 0), linkClicks: Number(r.inline_link_clicks || 0), frequency: r.frequency ? Number(r.frequency) : null, actions };
  });
}

/** Витрати оголошень у розрізі площадок за період: для кнопки «Аналізувати». */
async function fetchPlacements(token, accountId, since, until) {
  const rows = await list(token, `${actId(accountId)}/insights`, { level: 'ad', breakdowns: 'publisher_platform', time_range: { since, until }, limit: 500, fields: 'ad_id,spend,account_currency,impressions,inline_link_clicks,actions' });
  return rows.map((r) => ({ adExternalId: r.ad_id, platform: r.publisher_platform, spend: Number(r.spend || 0), currency: r.account_currency || 'USD', impressions: Number(r.impressions || 0), linkClicks: Number(r.inline_link_clicks || 0), landingViews: Number((r.actions || []).find((a) => a.action_type === 'landing_page_view')?.value || 0) }));
}

/** Поточні налаштування групи й креативу оголошення — перед тим як їх міняти. */
const readTargeting = async (token, adSetId) => (await call(token, String(adSetId), { fields: 'targeting' })).targeting || {};
const readAdCreative = async (token, adId) => (await call(token, String(adId), { fields: 'creative{id,object_story_spec,url_tags}' })).creative || {};

// ── ЗАПИС. Єдине місце, де платформа щось міняє в кабінеті. Викликати ЛИШЕ з services/actions.js після запобіжників. ──
async function write(token, objectId, fields) {
  if (!/^\d{5,25}$/.test(String(objectId))) throw new MetaError('Некоректний номер об\'єкта');
  const body = new URLSearchParams(Object.entries(fields).map(([k, v]) => [k, String(v)]));
  // Ключ — у заголовку, не в тілі й не в адресі.
  const res = await fetch(`${BASE}/${objectId}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(45_000) }).catch((e) => { throw new MetaError(`Meta недоступна: ${e.message}`); });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error) {
    const e = json?.error || {};
    throw new MetaError(e.error_user_msg || e.message || `Meta HTTP ${res.status}`, { code: e.code, subcode: e.error_subcode, status: res.status, rateLimited: RATE_CODES.has(e.code) || res.status === 429 });
  }
  return json;
}

const readBack = (token, objectId) => call(token, String(objectId), { fields: 'status,effective_status,daily_budget' });
const setStatus = (token, objectId, status) => write(token, objectId, { status });
/** amount — у звичайних одиницях валюти кабінету; Meta чекає найменші одиниці (центи/копійки). */
const setDailyBudget = (token, adSetId, amount) => write(token, adSetId, { daily_budget: Math.round(Number(amount) * 100) });

// ── СТВОРЕННЯ. Викликати ЛИШЕ з services/launch.js після запобіжників. Усе нове створюється вимкненим (запобіжник 3). ──

/** POST на «ребро» кабінету або на об'єкт. Обʼєкти передаються як JSON; ключ — у заголовку. */
async function post(token, path, fields) {
  const body = new URLSearchParams(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]));
  const res = await fetch(`${BASE}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(90_000) }).catch((e) => { throw new MetaError(`Meta недоступна: ${e.message}`); });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error) {
    const e = json?.error || {};
    throw new MetaError(e.error_user_msg || e.message || `Meta HTTP ${res.status}`, { code: e.code, subcode: e.error_subcode, status: res.status, rateLimited: RATE_CODES.has(e.code) || res.status === 429 });
  }
  return json;
}

const newId = (json) => { if (!json?.id) throw new MetaError('Meta не повернула номер створеного обʼєкта'); return String(json.id); };

const createCampaign = async (token, accountId, fields) => newId(await post(token, `${actId(accountId)}/campaigns`, { ...fields, status: 'PAUSED' }));
const createAdSet = async (token, accountId, fields) => newId(await post(token, `${actId(accountId)}/adsets`, { ...fields, status: 'PAUSED' }));
const createCreative = async (token, accountId, fields) => newId(await post(token, `${actId(accountId)}/adcreatives`, fields));
const createAd = async (token, accountId, fields) => newId(await post(token, `${actId(accountId)}/ads`, { ...fields, status: 'PAUSED' }));
const setAdCreative = (token, adId, creativeId) => write(token, adId, { creative: JSON.stringify({ creative_id: creativeId }) });
const setTargeting = (token, adSetId, targeting) => write(token, adSetId, { targeting: JSON.stringify(targeting) });

/** Картинка (байти) → hash, на який посилається креатив. */
async function uploadImage(token, accountId, buffer) {
  const json = await post(token, `${actId(accountId)}/adimages`, { bytes: buffer.toString('base64') });
  const hash = Object.values(json.images || {})[0]?.hash;
  if (!hash) throw new MetaError('Meta не прийняла картинку');
  return hash;
}

/** Відео Meta забирає сама за адресою; готовність перевіряється окремо через videoState. */
const uploadVideo = async (token, accountId, fileUrl, name) => newId(await post(token, `${actId(accountId)}/advideos`, { file_url: fileUrl, name }));
const videoState = async (token, videoId) => { const v = await call(token, String(videoId), { fields: 'status,picture' }); return { state: v.status?.video_status || 'processing', picture: v.picture || null }; };

/** Facebook-сторінки, доступні ключу (щоб не вводити номер вручну). */
const pages = async (token) => (await list(token, 'me/accounts', { fields: 'id,name', limit: 100 })).map((p) => ({ id: p.id, name: p.name }));

module.exports = { check, fetchStructure, fetchInsights, setStatus, setDailyBudget, readBack, createCampaign, createAdSet, createCreative, createAd, setAdCreative, setTargeting, readTargeting, readAdCreative, fetchPlacements, uploadImage, uploadVideo, videoState, pages, MetaError, VERSION };
