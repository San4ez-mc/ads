// Полиця креативів: усе з контент-платформи плюс те, що є в кабінеті без пари (завантажене прямо в Ads Manager).
// Звʼязок «креатив ↔ оголошення»: записаний платформою (заміна, нове оголошення, «Запуск»), а для старих — за збігом тексту.
const { db } = require('@ads/db');
const { contentCreatives, parseCreativeText } = require('./launch');
const { scrub } = require('../lib/secrets');

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const SHOWN = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'PENDING_REVIEW', 'DISAPPROVED', 'WITH_ISSUES', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'];

async function library(project) {
  const [ads, launches, bundles] = await Promise.all([
    db.ad.findMany({ where: { projectId: project.id, effectiveStatus: { in: SHOWN }, campaign: { effectiveStatus: { in: ['ACTIVE', 'IN_PROCESS', 'WITH_ISSUES'] } } }, include: { campaign: { select: { name: true } }, adSet: { select: { name: true } } } }),
    db.launch.findMany({ where: { projectId: project.id } }),
    db.bundle.findMany({ where: { projectId: project.id } }),
  ]);
  let creatives = []; let error = null;
  try { creatives = (await contentCreatives(project)).creatives; } catch (e) { error = scrub(e.message); }
  const byLaunch = new Map(launches.flatMap((l) => Object.entries(l.ids?.items || {}).filter(([, i]) => i.ad).map(([creativeId, i]) => [i.ad, creativeId])));
  const parsed = creatives.map((c) => ({ c, t: parseCreativeText(c.text) }));
  const matchOf = (a) => {
    const direct = a.content2PostId || byLaunch.get(a.externalId);
    if (direct && creatives.some((c) => c.id === direct)) return direct;
    const body = norm(a.body).slice(0, 80);
    const same = parsed.find((x) => x.t && body.length >= 30 && norm(x.t.primary).startsWith(body));
    return same ? same.c.id : null;
  };
  const view = (a) => ({ id: a.id, externalId: a.externalId, name: a.name, status: a.effectiveStatus, campaign: a.campaign.name, adSet: a.adSet.name });
  const inAds = new Map(); const loose = [];
  for (const a of ads) { const id = matchOf(a); if (id) inAds.set(id, [...(inAds.get(id) || []), view(a)]); else loose.push(a); }
  const usage = new Map();
  for (const b of bundles) for (const id of (Array.isArray(b.creativeIds) ? b.creativeIds : [])) usage.set(id, [...(usage.get(id) || []), b.code || b.name]);
  const items = [
    ...loose.map((a) => ({ id: `ad:${a.externalId}`, number: null, fromCabinet: true, headline: a.title || a.name, mediaUrl: a.imageUrl || a.thumbnailUrl, mediaType: 'image', problem: null, usable: false, bundles: [], ads: [view(a)] })),
    ...parsed.map(({ c, t }) => {
      const problem = c.violations?.length ? c.violations.join('; ') : c.status === 'draft' ? 'чернетка в контент-платформі' : !c.mediaUrl ? 'нема картинки' : null;
      return { id: c.id, number: c.number, fromCabinet: false, headline: t?.headline || c.hook || c.topic || 'без заголовка', mediaUrl: c.mediaUrl, mediaType: c.mediaType, problem, usable: !problem && c.mediaType === 'image', bundles: usage.get(c.id) || [], ads: inAds.get(c.id) || [] };
    }),
  ];
  // Спершу те, що вже в рекламі, далі новіші.
  items.sort((x, y) => (y.ads.length ? 1 : 0) - (x.ads.length ? 1 : 0) || (y.number || 0) - (x.number || 0));
  const sets = await db.adSet.findMany({ where: { projectId: project.id, campaign: { effectiveStatus: 'ACTIVE' } }, include: { campaign: { select: { name: true, effectiveStatus: true, extCreatedAt: true } }, ads: { select: { linkUrl: true }, take: 1 } }, orderBy: { extCreatedAt: 'desc' }, take: 30 });
  return { items, error, adSets: sets.map((s) => ({ id: s.id, name: s.name, campaign: s.campaign.name, hasLink: !!s.ads[0]?.linkUrl })) };
}

module.exports = { library };
