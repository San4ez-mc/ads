// Створення кампаній, груп і оголошень у кабінеті та запуск їх у показ. Єдина точка для цього — тут стоять запобіжники
// з розділу 5 проєкту (номери в дужках): усе нове вимкнене (3), тексти пройшли перевірку правил реклами в
// контент-платформі (4), не більше 3 кампаній і 10 оголошень на добу (5), стоп після двох відхилень (6), денний ліміт (10),
// стан кабінету (13), без повторів при відмові (14), лише людина з підтвердженням (15), режим «проба» (16),
// перечитування з кабінету (17), журнал (18).
// ПРАВИЛА META обовʼязкові для всього, що йде в кабінет: тексти й посилання проходять lib/metaPolicy.js, обхідного шляху нема.
const { db } = require('@ads/db');
const logger = require('@ads/logger');
const { ValidationError } = require('@ads/errors');
const meta = require('../channels/meta');
const policy = require('../lib/metaPolicy');
const c2 = require('../channels/content2');
const { decrypt, scrub } = require('../lib/secrets');
const { toUah, round2 } = require('../lib/money');
const { logAction } = require('./journal');

const MAX_CAMPAIGNS_DAY = 3;
const MAX_ADS_DAY = 10;
const STALE_MS = 15 * 60_000; // «створюється» довше цього без руху = процес перервано, можна продовжити
const VIDEO_POLL = { tries: 30, ms: Number(process.env.META_VIDEO_POLL_MS ?? 10_000) };
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

// Мета кампанії простими словами → поля Meta.
const GOALS = {
  clicks: { label: 'Трафік: кліки по посиланню', objective: 'OUTCOME_TRAFFIC', optimization: 'LINK_CLICKS' },
  landing: { label: 'Трафік: перегляди сторінки сайту (потрібен піксель на сайті)', objective: 'OUTCOME_TRAFFIC', optimization: 'LANDING_PAGE_VIEWS' },
  leads: { label: 'Ліди: подія пікселя', objective: 'OUTCOME_LEADS', optimization: 'OFFSITE_CONVERSIONS' },
};
const PIXEL_EVENTS = ['LEAD', 'CONTACT', 'SCHEDULE', 'COMPLETE_REGISTRATION', 'PURCHASE'];
// Кнопки з правил реклами контент-платформи → кнопки Meta.
const CTA = { 'Дізнатися більше': 'LEARN_MORE', "Зв'язатися з нами": 'CONTACT_US', 'Записатися': 'SIGN_UP', 'Надіслати повідомлення': 'CONTACT_US', 'Завантажити': 'DOWNLOAD', 'Отримати пропозицію': 'GET_OFFER' };

/** Текст креативу контент-платформи («Основний текст: … Заголовок: … Кнопка: …») → поля оголошення. Не вгадує: нема поля — null. */
function parseCreativeText(text) {
  const t = String(text || '').replace(/\r/g, '');
  const primary = /Основний текст:\n([\s\S]*?)\nЗаголовок:/.exec(t)?.[1]?.trim();
  const headline = /\nЗаголовок:[ \t]*(.+)/.exec(t)?.[1]?.trim();
  if (!primary || !headline) return null;
  const description = /\nОпис:[ \t]*(.+)/.exec(t)?.[1]?.trim() || null;
  const button = /\nКнопка:[ \t]*(.+)/.exec(t)?.[1]?.trim() || null;
  return { primary, headline, description, cta: CTA[button] || 'LEARN_MORE' };
}

const int = (v, d) => (v === undefined || v === null || v === '' ? d : Math.round(Number(v)));

/** Перевірка й нормалізація того, що прийшло з форми. Кидає ValidationError. */
function parseSpec(b = {}) {
  const s = {};
  s.connectionId = String(b.connectionId || '');
  if (!s.connectionId) throw new ValidationError('Оберіть рекламний кабінет');
  s.bundleId = String(b.bundleId || '');
  if (!s.bundleId) throw new ValidationError('Оберіть зв\'язку: за її кодом платформа привʼязує цифри');
  s.name = String(b.name || '').trim().slice(0, 180);
  s.goal = String(b.goal || '');
  if (!GOALS[s.goal]) throw new ValidationError(`Мета: ${Object.keys(GOALS).join(', ')}`);
  const d = b.destination || {};
  if (d.type === 'telegram') {
    const bot = String(d.bot || '').trim().replace(/^@|^https:\/\/t\.me\//i, '');
    const slug = String(d.slug || '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(bot)) throw new ValidationError('Імʼя бота — латиницею, без @ і пробілів');
    // Telegram приймає в start до 64 символів: воронка + «__a» + номер оголошення (до 20 цифр).
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(slug)) throw new ValidationError('Код воронки — латиницею, цифри, дефіс, до 40 символів');
    if (s.goal !== 'clicks') throw new ValidationError('Для Telegram-бота працює лише мета «кліки по посиланню»: пікселя на t.me немає');
    s.destination = { type: 'telegram', bot, slug };
  } else if (d.type === 'site') {
    let u; try { u = new URL(String(d.url || '').trim()); } catch { throw new ValidationError('Адреса сайту має бути повною: https://…'); }
    if (u.protocol !== 'https:') throw new ValidationError('Адреса сайту має починатися з https://');
    if (/(^|\.)t\.me$/i.test(u.hostname)) throw new ValidationError('Для посилання на бота оберіть «Telegram-бот»');
    s.destination = { type: 'site', url: u.toString() };
  } else throw new ValidationError('Куди вести: Telegram-бот або сайт');
  s.dailyBudget = Math.round(Number(b.dailyBudget) * 100) / 100;
  if (!(s.dailyBudget >= 1)) throw new ValidationError('Денний бюджет — число від 1');
  s.countries = [...new Set((Array.isArray(b.countries) ? b.countries : String(b.countries || 'UA').split(/[\s,]+/)).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  if (!s.countries.length || s.countries.some((c) => !/^[A-Z]{2}$/.test(c))) throw new ValidationError('Країни — дволітерні коди, наприклад UA');
  s.advantageAudience = !!b.advantageAudience;
  // Audience Network (сторонні додатки) вимкнена за замовчуванням: на першій кампанії забрала 79% грошей випадковими кліками.
  s.audienceNetwork = !!b.audienceNetwork;
  // Threads теж лише за галочкою: без пов'язаного профілю Meta відмовляє («Threads не має права керувати сторінкою»).
  s.threads = !!b.threads;
  s.ageMin = int(b.ageMin, 25); s.ageMax = int(b.ageMax, 55);
  if (!(s.ageMin >= 18 && s.ageMax <= 65 && s.ageMin <= s.ageMax)) throw new ValidationError('Вік — від 18 до 65');
  // Правило Meta: коли аудиторію можна розширювати, нижня межа не вища за 25, а верхньої нема.
  if (s.advantageAudience) { s.ageMin = Math.min(s.ageMin, 25); s.ageMax = 65; }
  s.pageId = String(b.pageId || '').trim();
  if (!/^\d{5,25}$/.test(s.pageId)) throw new ValidationError('Номер Facebook-сторінки — лише цифри');
  s.instagramId = String(b.instagramId || '').trim() || null;
  if (s.instagramId && !/^\d{5,25}$/.test(s.instagramId)) throw new ValidationError('Номер Instagram-акаунта — лише цифри');
  if (s.goal === 'leads') {
    s.pixelId = String(b.pixelId || '').trim(); s.pixelEvent = String(b.pixelEvent || 'LEAD');
    if (!/^\d{5,25}$/.test(s.pixelId)) throw new ValidationError('Для мети «Ліди» потрібен номер пікселя (набору даних)');
    if (!PIXEL_EVENTS.includes(s.pixelEvent)) throw new ValidationError(`Подія пікселя: ${PIXEL_EVENTS.join(', ')}`);
  }
  s.creativeIds = [...new Set((Array.isArray(b.creativeIds) ? b.creativeIds : []).map((x) => String(x).slice(0, 60)).filter(Boolean))];
  if (!s.creativeIds.length) throw new ValidationError('Оберіть хоча б один креатив');
  if (s.creativeIds.length > MAX_ADS_DAY) throw new ValidationError(`Не більше ${MAX_ADS_DAY} оголошень за раз`);
  return s;
}

async function contentCreatives(project) {
  const conn = await db.connection.findFirst({ where: { projectId: project.id, channel: 'content2', secretRead: { not: null } } });
  const pid = conn && (conn.config?.projectId || project.content2ProjectId);
  if (!conn || !pid) throw new Error('Контент-платформу не підключено');
  // Звертаємось до контент-платформи, можливо, по внутрішній адресі, а файли вона віддає з публічної: дозволені обидві, і лише вони.
  const origins = [new URL(conn.externalId).origin, new URL(process.env.CONTENT2_ORIGIN || 'https://content2.fineko.space').origin];
  return { origins, creatives: await c2.creatives(conn.externalId, decrypt(conn.secretRead), pid, 200) };
}

const currencyOf = (conn) => conn?.config?.check?.currency || null;
const limitUah = (project) => Number(project.dailyLimitUsd) * Number(project.usdRate);

/** Скільки на добу вже можуть витрачати увімкнені групи й кампанії проєкту (у гривні). */
async function activeDailyUah(project, exceptLaunchId) {
  const conns = await db.connection.findMany({ where: { projectId: project.id, channel: 'meta' } });
  const cur = new Map(conns.map((c) => [c.id, currencyOf(c)]));
  // Наші запущені кампанії рахуємо з власних записів: синхронізація могла ще не побачити, що їх увімкнули.
  const marked = await db.launch.findMany({ where: { projectId: project.id, status: 'live' } });
  // Кампанію могли вимкнути прямо в Ads Manager: якщо синхронізація після запуску бачить її вимкненою, у ліміт не беремо.
  const off = await db.campaign.findMany({ where: { projectId: project.id, externalId: { in: marked.map((l) => l.ids?.campaign).filter(Boolean) }, NOT: { effectiveStatus: 'ACTIVE' } } });
  const live = marked.filter((l) => !off.some((c) => c.externalId === l.ids?.campaign && c.syncedAt > l.launchedAt));
  const ours = new Set(live.map((l) => l.ids?.campaign).filter(Boolean));
  const campaigns = await db.campaign.findMany({ where: { projectId: project.id, effectiveStatus: 'ACTIVE' }, include: { adSets: { where: { effectiveStatus: 'ACTIVE' } } } });
  let sum = 0;
  for (const c of campaigns) {
    if (ours.has(c.externalId)) continue;
    const own = c.dailyBudget !== null ? Number(c.dailyBudget) : c.adSets.reduce((a, s) => a + Number(s.dailyBudget || 0), 0);
    sum += toUah(own, cur.get(c.connectionId), project);
  }
  for (const l of live) if (l.id !== exceptLaunchId) sum += toUah(l.spec.dailyBudget, cur.get(l.connectionId), project);
  return sum;
}

async function spentTodayUah(project) {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const rows = await db.insightDaily.groupBy({ by: ['currency'], where: { date: today, ad: { projectId: project.id } }, _sum: { spend: true } });
  return rows.reduce((a, r) => a + toUah(Number(r._sum.spend || 0), r.currency, project), 0);
}

function connectionReasons(conn) {
  if (!conn) return ['Підключення кабінету не знайдено'];
  const out = [];
  if (conn.status !== 'ok') out.push(`(13) Підключення «${conn.name}» не в порядку (${conn.status === 'blocked' ? 'кабінет обмежено' : conn.status === 'error' ? 'помилка ключа' : 'не перевірено'}): спершу виправте його в «Підключеннях»`);
  if (!conn.secretWrite) out.push('Не додано ключ керування (ads_management) у «Підключення». Поточний ключ лише читає.');
  const c = currencyOf(conn);
  if (!c) out.push('Невідома валюта кабінету: натисніть «Перевірити» в «Підключеннях»');
  else if (!['USD', 'UAH'].includes(c)) out.push(`Валюта кабінету ${c}: платформа вміє рахувати ліміт лише в доларах і гривнях`);
  return out;
}

/** Чиста перевірка перед створенням. Нічого не пише. Повертає { ok, reasons, notes, ... }. */
async function check(project, launch, { actor = 'user:' } = {}) {
  const spec = launch.spec; const reasons = []; const notes = [];
  if (!String(actor).startsWith('user:')) reasons.push('(15) Створювати кампанії може лише людина з підтвердженням');
  const conn = await db.connection.findFirst({ where: { id: launch.connectionId, projectId: project.id, channel: 'meta' } });
  reasons.push(...connectionReasons(conn));

  const bundle = await db.bundle.findFirst({ where: { id: spec.bundleId, projectId: project.id } });
  if (!bundle) reasons.push('Зв\'язку не знайдено');
  else if (!bundle.code) reasons.push('У зв\'язки нема коду: задайте його в «Зв\'язках», інакше цифри не привʼяжуться');

  const creatives = []; let origins = [];
  try {
    const got = await contentCreatives(project); origins = got.origins;
    for (const id of spec.creativeIds) {
      const c = got.creatives.find((x) => x.id === id);
      if (!c) { reasons.push('Один із креативів зник із контент-платформи'); continue; }
      const label = `Креатив №${c.number}`;
      const problems = Array.isArray(c.violations) ? c.violations : [];
      if (problems.length) reasons.push(`(4) ${label} не пройшов перевірку правил реклами: ${problems.join('; ')}`);
      else if (c.status === 'draft') reasons.push(`(4) ${label} у контент-платформі ще чернетка`);
      const text = parseCreativeText(c.text);
      if (!text) reasons.push(`${label}: не вдалося прочитати основний текст і заголовок`);
      let media = null; try { media = new URL(c.mediaUrl); } catch { /* нема файла */ }
      if (!media || !origins.includes(media.origin)) reasons.push(`${label}: нема картинки чи відео з контент-платформи`);
      if (text) for (const why of policy.checkAdText(text)) reasons.push(`(Meta) ${label}: ${why}`);
      if (text) creatives.push({ id: c.id, number: c.number, mediaUrl: c.mediaUrl, mediaType: c.mediaType, ...text });
    }
  } catch (e) { reasons.push(`(4) Не вдалося перевірити креативи: ${scrub(e.message)}`); }

  // Правила Meta: куди веде реклама.
  const dest = spec.destination.type === 'telegram' ? `https://t.me/${spec.destination.bot}` : spec.destination.url;
  for (const why of await policy.checkDestination(dest, { domains: await policy.projectDomains(db, project.id) })) reasons.push(`(Meta) ${why}`);

  // (5) Денна кількість нового. Ця ж кампанія при повторі вдруге не рахується.
  const dayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const today = await db.launch.findMany({ where: { projectId: project.id, createdInMetaAt: { gte: dayStart }, id: { not: launch.id || '' } } });
  const adsToday = today.reduce((a, l) => a + Object.values(l.ids?.items || {}).filter((i) => i.ad).length, 0);
  if (today.length >= MAX_CAMPAIGNS_DAY) reasons.push(`(5) Сьогодні вже створено ${today.length} кампанії: більше ${MAX_CAMPAIGNS_DAY} на добу не можна`);
  if (adsToday + spec.creativeIds.length > MAX_ADS_DAY) reasons.push(`(5) Сьогодні вже ${adsToday} нових оголошень, ще ${spec.creativeIds.length} перевищить ${MAX_ADS_DAY} на добу`);

  // (6) Два останні оголошення кабінету відхилені → спершу розібратись, чому.
  if (conn) {
    const last = await db.ad.findMany({ where: { projectId: project.id, campaign: { connectionId: conn.id }, extCreatedAt: { not: null } }, orderBy: { extCreatedAt: 'desc' }, take: 2 });
    if (last.length === 2 && last.every((a) => a.effectiveStatus === 'DISAPPROVED')) reasons.push('(6) Два останні оголошення відхилені: створення зупинено, доки не зʼясуєте причину');
  }

  const currency = currencyOf(conn);
  const limit = limitUah(project);
  const budget = toUah(spec.dailyBudget, currency, project);
  if (limit > 0 && budget > limit + 0.001) reasons.push(`(10) Денний бюджет ${round2(budget)} грн більший за денний ліміт проєкту ${round2(limit)} грн: таку групу не вдасться запустити`);
  if (spec.creativeIds.length > 3) notes.push('При невеликому бюджеті краще 2–3 оголошення: інакше кожне отримає копійки');
  notes.push(`Бюджет: ${spec.dailyBudget} ${currency || ''} на добу. Усе буде створено вимкненим.`);

  return { ok: reasons.length === 0, reasons, notes, dryRun: !!project.dryRun, conn, bundle, creatives, origins };
}

const campaignName = (bundle, spec) => `[${bundle.code}] ${spec.name || bundle.name}`.slice(0, 240);

/** Площадки. Threads Meta не пропонує для мети «ліди», тому там його нема. */
const placements = (spec) => ['facebook', 'instagram', 'messenger', ...(spec.threads && spec.goal !== 'leads' ? ['threads'] : []), ...(spec.audienceNetwork ? ['audience_network'] : [])];

/** Посилання конкретного оголошення. Номери підставляються справжні (а не макроси Meta), щоб бот і сайт точно знали джерело. */
function adLink(spec, bundle, creative, ids) {
  const d = spec.destination;
  if (d.type === 'telegram') return `https://t.me/${d.bot}?start=${d.slug}${ids.ad ? `__a${ids.ad}` : ''}`;
  const u = new URL(d.url);
  const set = (k, v) => { if (v && !u.searchParams.has(k)) u.searchParams.set(k, v); };
  set('utm_source', 'meta'); set('utm_medium', 'paid_social'); set('utm_campaign', bundle.code); set('utm_content', `n${creative.number}`);
  set('campaign_id', ids.campaign); set('adset_id', ids.adSet); set('ad_id', ids.ad);
  return u.toString();
}

function creativeFields(spec, creative, media, link, name) {
  const cta = { type: creative.cta, value: { link } };
  const story = { page_id: spec.pageId, ...(spec.instagramId ? { instagram_user_id: spec.instagramId } : {}) };
  if (media.videoId) story.video_data = { video_id: media.videoId, image_url: media.picture, title: creative.headline, message: creative.primary, ...(creative.description ? { link_description: creative.description } : {}), call_to_action: cta };
  else story.link_data = { link, message: creative.primary, name: creative.headline, ...(creative.description ? { description: creative.description } : {}), image_hash: media.imageHash, call_to_action: cta };
  // Адреса сайту отримує ще й місце показу: його знає лише Meta в момент кліку.
  return { name, object_story_spec: story, ...(spec.destination.type === 'site' ? { url_tags: 'placement={{placement}}' } : {}) };
}

async function download(url, origins) {
  if (!origins.includes(new URL(url).origin)) throw new Error('Файл креативу не з контент-платформи');
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'error' });
  if (!res.ok) throw new Error(`Не вдалося взяти картинку креативу (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('Картинка креативу більша за 15 МБ');
  return buf;
}

/** Пояснення найчастіших відмов Meta простими словами. */
function explain(e) {
  const msg = scrub(e.message);
  if (e.rateLimited) return 'Meta просить зачекати (ліміт звернень). Натисніть «Продовжити» за кілька хвилин.';
  if (e.subcode === 1885183) return `Додаток Meta ще в режимі розробки. На developers.facebook.com переведіть його в робочий режим (Live): потрібна адреса політики конфіденційності. Відповідь Meta: ${msg}`;
  if (e.code === 190) return `Ключ керування недійсний: згенеруйте новий і введіть у «Підключеннях». Відповідь Meta: ${msg}`;
  if (e.code === 200 || e.code === 270 || e.code === 10 || e.code === 294) return `Ключу бракує прав: системному користувачу потрібні кабінет (керування кампаніями), Facebook-сторінка (створення реклами) і дозвіл ads_management. Відповідь Meta: ${msg}`;
  return `Meta не прийняла: ${msg}`;
}

/** Створює в кабінеті все, чого ще нема. Кожен крок одразу записується, тож повтор продовжує з місця зупинки без дублів. */
async function build(project, launch, verdict, actor) {
  const { conn, bundle, creatives, origins } = verdict;
  const spec = launch.spec; const goal = GOALS[spec.goal]; const account = conn.externalId;
  const ids = JSON.parse(JSON.stringify(launch.ids || {})); ids.items ||= {};
  const save = (extra = {}) => db.launch.update({ where: { id: launch.id }, data: { ids, updatedAt: new Date(), ...extra } });
  try {
    const token = decrypt(conn.secretWrite);
    const name = campaignName(bundle, spec);
    if (!ids.campaign) {
      ids.campaign = await meta.createCampaign(token, account, { name, objective: goal.objective, buying_type: 'AUCTION', special_ad_categories: [], is_adset_budget_sharing_enabled: false });
      await save({ createdInMetaAt: new Date() });
    }
    if (!ids.adSet) {
      ids.adSet = await meta.createAdSet(token, account, {
        name: `${name} · група`, campaign_id: ids.campaign, daily_budget: Math.round(spec.dailyBudget * 100),
        billing_event: 'IMPRESSIONS', optimization_goal: goal.optimization, bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        ...(spec.goal === 'leads' ? { destination_type: 'WEBSITE', promoted_object: { pixel_id: spec.pixelId, custom_event_type: spec.pixelEvent } } : {}),
        targeting: { geo_locations: { countries: spec.countries }, age_min: spec.ageMin, age_max: spec.ageMax, targeting_automation: { advantage_audience: spec.advantageAudience ? 1 : 0 }, publisher_platforms: placements(spec) },
      });
      await save();
    }
    for (const c of creatives) {
      const item = ids.items[c.id] ||= {};
      const adName = `${bundle.code} №${c.number} · ${c.headline}`.slice(0, 240);
      if (!item.media) {
        if (c.mediaType === 'video') {
          if (!item.videoId) { item.videoId = await meta.uploadVideo(token, account, c.mediaUrl, adName); await save(); }
          let v = await meta.videoState(token, item.videoId);
          for (let i = 0; i < VIDEO_POLL.tries && v.state !== 'ready' && v.state !== 'error'; i += 1) { await new Promise((r) => setTimeout(r, VIDEO_POLL.ms)); await save(); v = await meta.videoState(token, item.videoId); }
          if (v.state === 'error') { delete item.videoId; throw new Error(`Meta не змогла обробити відео креативу №${c.number}`); }
          if (v.state !== 'ready' || !v.picture) throw new Error(`Meta ще обробляє відео креативу №${c.number}. Натисніть «Продовжити» за кілька хвилин.`);
          item.media = { videoId: item.videoId, picture: v.picture };
        } else item.media = { imageHash: await meta.uploadImage(token, account, await download(c.mediaUrl, origins)) };
        await save();
      }
      if (!item.creative) { item.creative = await meta.createCreative(token, account, creativeFields(spec, c, item.media, adLink(spec, bundle, c, { campaign: ids.campaign, adSet: ids.adSet }), adName)); await save(); }
      if (!item.ad) { item.ad = await meta.createAd(token, account, { name: adName, adset_id: ids.adSet, creative: { creative_id: item.creative } }); await save(); }
      // Другий крок: тепер відомий номер оголошення — вписуємо його в посилання.
      if (!item.finalCreative) { item.finalCreative = await meta.createCreative(token, account, creativeFields(spec, c, item.media, adLink(spec, bundle, c, { campaign: ids.campaign, adSet: ids.adSet, ad: item.ad }), adName)); await save(); }
      if (!item.linked) { await meta.setAdCreative(token, item.ad, item.finalCreative); item.linked = true; await save(); }
    }
    // (17) Перечитуємо: усе має бути вимкненим.
    const objects = [ids.campaign, ids.adSet, ...Object.values(ids.items).map((i) => i.ad)];
    for (const id of objects) {
      const back = await meta.readBack(token, id);
      if (back.status !== 'PAUSED') { await meta.setStatus(token, ids.campaign, 'PAUSED'); throw new Error('Обʼєкт у кабінеті виявився не вимкненим. Кампанію вимкнено, перевірте її в Ads Manager.'); }
    }
    await save({ status: 'created', error: null });
    await logAction(project.id, actor, 'launch_create', { target: name, after: { campaign: ids.campaign, adSet: ids.adSet, ads: objects.length - 2, status: 'PAUSED' } });
    return { status: 'created' };
  } catch (e) {
    const message = e.name === 'MetaError' ? explain(e) : scrub(e.message);
    logger.warn(`[launch] ${launch.id}: ${message}`);
    await save({ status: 'failed', error: message.slice(0, 1000) });
    await logAction(project.id, actor, 'launch_create', { target: bundle.name, after: { campaign: ids.campaign || null }, reason: message.slice(0, 500), status: 'failed' });
    return { status: 'failed', message };
  }
}

/**
 * Створити в кабінеті (вимкненим). Саме створення триває довго (відео), тому йде у фоні: повертає { status: 'creating', job }.
 * Інші відповіді: blocked (запобіжники), dry_run (режим «проба»).
 */
async function create(project, launch, { actor }) {
  if (!['draft', 'failed', 'creating'].includes(launch.status)) return { status: 'blocked', reasons: ['Цю кампанію вже створено'] };
  const verdict = await check(project, launch, { actor });
  if (!verdict.ok) {
    await logAction(project.id, actor, 'launch_create', { target: launch.name, reason: verdict.reasons.join('; ').slice(0, 900), status: 'blocked' });
    return { status: 'blocked', reasons: verdict.reasons, notes: verdict.notes };
  }
  if (project.dryRun) {
    await logAction(project.id, actor, 'launch_create', { target: campaignName(verdict.bundle, launch.spec), after: launch.spec, status: 'dry_run' });
    return { status: 'dry_run', message: 'Режим «проба»: у кабінеті нічого не створено, дію записано в журнал як «зробив би». Щоб створювати насправді, вимкніть «пробу» в налаштуваннях.', notes: verdict.notes };
  }
  // Захоплюємо запис одним запитом: два натискання не створять дві кампанії.
  const claimed = await db.launch.updateMany({ where: { id: launch.id, OR: [{ status: { in: ['draft', 'failed'] } }, { status: 'creating', updatedAt: { lt: new Date(Date.now() - STALE_MS) } }] }, data: { status: 'creating', error: null, updatedAt: new Date() } });
  if (!claimed.count) return { status: 'blocked', reasons: ['Ця кампанія вже створюється: зачекайте'] };
  const fresh = await db.launch.findUnique({ where: { id: launch.id } });
  const job = build(project, fresh, verdict, actor).catch((e) => { logger.error(`[launch] ${launch.id}: ${scrub(e.message)}`); return { status: 'failed', message: scrub(e.message) }; });
  return { status: 'creating', job };
}

/** Чинні тексти креативів запуску проти правил Meta. Не вдалося прочитати — не вмикаємо. */
async function metaRuleReasons(project, launch) {
  try {
    const { creatives } = await contentCreatives(project);
    return (launch.spec.creativeIds || []).flatMap((id) => {
      const c = creatives.find((x) => x.id === id);
      const text = c && parseCreativeText(c.text);
      if (!text) return ['(Meta) Креатив кампанії не вдалося перевірити: його нема в контент-платформі або в ньому нема тексту'];
      return [...(c.violations || []), ...policy.checkAdText(text)].map((why) => `(Meta) Креатив №${c.number}: ${why}`);
    });
  } catch (e) { return [`(Meta) Не вдалося перевірити креативи перед увімкненням: ${scrub(e.message)}`]; }
}

/** Увімкнути показ створеної кампанії. Окреме «так» людини (3, 15). */
async function start(project, launch, { actor }) {
  const reasons = [];
  if (!String(actor).startsWith('user:')) reasons.push('(15) Запускати кампанії може лише людина з підтвердженням');
  if (!['created', 'stopped'].includes(launch.status)) reasons.push('Запустити можна лише повністю створену кампанію');
  const conn = await db.connection.findFirst({ where: { id: launch.connectionId, projectId: project.id } });
  reasons.push(...connectionReasons(conn));
  const limit = limitUah(project);
  if (limit > 0 && conn) {
    const [active, spent] = await Promise.all([activeDailyUah(project, launch.id), spentTodayUah(project)]);
    const mine = toUah(launch.spec.dailyBudget, currencyOf(conn), project);
    if (spent >= limit) reasons.push(`(10) Денний ліміт уже витрачено: ${round2(spent)} з ${round2(limit)} грн`);
    if (active + mine > limit + 0.001) reasons.push(`(10) Увімкнені кампанії вже можуть витрачати ${round2(active)} грн на добу, ця додасть ${round2(mine)} грн, а денний ліміт ${round2(limit)} грн`);
  }
  for (const why of await metaRuleReasons(project, launch)) reasons.push(why);
  const ads = Object.values(launch.ids?.items || {}).map((i) => i.ad).filter(Boolean);
  let token = null;
  if (!reasons.length) {
    try {
      token = decrypt(conn.secretWrite);
      for (const id of ads) if ((await meta.readBack(token, id)).effective_status === 'DISAPPROVED') reasons.push(`(6) Оголошення ${id} відхилене Meta: виправте або створіть без нього`);
    } catch (e) { reasons.push(explain(e)); }
  }
  const blocked = async (list) => { await logAction(project.id, actor, 'launch_start', { target: launch.name, reason: list.join('; ').slice(0, 900), status: 'blocked' }); return { status: 'blocked', reasons: list }; };
  if (reasons.length) return blocked(reasons);
  if (project.dryRun) {
    await logAction(project.id, actor, 'launch_start', { target: launch.name, status: 'dry_run' });
    return { status: 'dry_run', message: 'Режим «проба»: показ не увімкнено, дію записано в журнал.' };
  }
  try {
    // Кампанія вмикається останньою: витрати починаються лише коли все всередині готове.
    for (const id of [...ads, launch.ids.adSet, launch.ids.campaign]) await meta.setStatus(token, id, 'ACTIVE');
    const back = await meta.readBack(token, launch.ids.campaign);
    if (back.status !== 'ACTIVE') throw new Error('Кабінет не підтвердив увімкнення');
  } catch (e) {
    await meta.setStatus(token, launch.ids.campaign, 'PAUSED').catch(() => {});
    const message = e.name === 'MetaError' ? explain(e) : scrub(e.message);
    await logAction(project.id, actor, 'launch_start', { target: launch.name, reason: message.slice(0, 500), status: 'failed' });
    return { status: 'failed', message };
  }
  await db.launch.update({ where: { id: launch.id }, data: { status: 'live', launchedAt: new Date(), error: null } });
  await db.campaign.updateMany({ where: { projectId: project.id, externalId: launch.ids.campaign }, data: { status: 'ACTIVE', effectiveStatus: 'ACTIVE' } });
  await logAction(project.id, actor, 'launch_start', { target: launch.name, before: { status: 'PAUSED' }, after: { status: 'ACTIVE', dailyBudget: launch.spec.dailyBudget } });
  return { status: 'done', message: 'Показ увімкнено. Meta ще перевірить оголошення, перші цифри зʼявляться після синхронізації.' };
}

/** Зупинити кампанію. Напрямок, безпечний для грошей: працює і в режимі «проба», і з обмеженим кабінетом. */
async function stop(project, launch, { actor }) {
  if (!launch.ids?.campaign) return { status: 'blocked', reasons: ['У кабінеті ця кампанія не створена'] };
  const conn = await db.connection.findFirst({ where: { id: launch.connectionId, projectId: project.id } });
  if (!conn?.secretWrite) return { status: 'blocked', reasons: ['Нема ключа керування: вимкніть кампанію в Ads Manager'] };
  try {
    const token = decrypt(conn.secretWrite);
    await meta.setStatus(token, launch.ids.campaign, 'PAUSED');
    if ((await meta.readBack(token, launch.ids.campaign)).status !== 'PAUSED') throw new Error('Кабінет не підтвердив вимкнення');
  } catch (e) {
    const message = `${e.name === 'MetaError' ? explain(e) : scrub(e.message)} Перевірте кампанію в Ads Manager.`;
    await logAction(project.id, actor, 'launch_stop', { target: launch.name, reason: message.slice(0, 500), status: 'failed' });
    return { status: 'failed', message };
  }
  if (['live', 'created'].includes(launch.status)) await db.launch.update({ where: { id: launch.id }, data: { status: 'stopped' } });
  await db.campaign.updateMany({ where: { projectId: project.id, externalId: launch.ids.campaign }, data: { status: 'PAUSED', effectiveStatus: 'PAUSED' } });
  await logAction(project.id, actor, 'launch_stop', { target: launch.name, after: { status: 'PAUSED' } });
  return { status: 'done', message: 'Кампанію вимкнено.' };
}

module.exports = { parseSpec, parseCreativeText, adLink, check, create, start, stop, GOALS, PIXEL_EVENTS, STALE_MS, contentCreatives, creativeFields, download, explain };
