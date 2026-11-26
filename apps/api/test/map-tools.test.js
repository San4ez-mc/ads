// Карта: опис аудиторії й площадок, підказки «Аналізувати», правки площадок і креативу (на підробленій Meta і контент-платформі).
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { db } = require('@ads/db');
const { encrypt } = require('../src/lib/secrets');
const describe = require('../src/lib/describe');
const { analyze } = require('../src/lib/analyze');
const actions = require('../src/services/actions');

test('аудиторія й площадки простими словами; без списку площадок — «усі, разом з Audience Network»', () => {
  const t = { geo_locations: { countries: ['UA'] }, age_min: 25, age_max: 65, age_range: [25, 55], targeting_automation: { advantage_audience: 1 }, publisher_platforms: ['facebook', 'instagram'] };
  assert.strictEqual(describe.audience(t).text, 'Україна · 25–55 років · усі статі · без інтересів · Meta може розширювати');
  assert.strictEqual(describe.placements(t).text, 'Facebook, Instagram');
  assert.ok(describe.placements({ geo_locations: {} }).text.includes('Audience Network'));
  assert.strictEqual(describe.audience({}), null);
});

const ad = (over = {}) => ({ externalId: '1', id: 'a1', adSetId: 's1', name: 'О', placements: { auto: true, list: [] }, creative: { linkUrl: 'https://x.ua/', title: 'Т', body: 'Обіцяємо карту' }, impressions: 6000, ctr: 3.9, spend: 266, sales: 0, entry: 'site:lp', ...over });
const mapOf = (a, elements) => ({ from: '2026-11-20', to: '2026-11-26', target: 1500, campaigns: [{ name: 'К', adSets: [{ ads: [a] }] }], elements });
const site = { key: 'site:lp', type: 'site', name: 'Лендінг', domain: 'x.ua', steps: [{ key: 'view', title: 'Відкрив', order: 1, total: 317, unknown: 0 }, { key: 'cta_click', title: 'Натиснув кнопку', order: 2, total: 0, unknown: 0 }] };
const rows = [{ adExternalId: '1', platform: 'audience_network', spend: 210, currency: 'UAH', linkClicks: 279, landingViews: 48 }, { adExternalId: '1', platform: 'instagram', spend: 56, currency: 'UAH', linkClicks: 76, landingViews: 42 }];

test('підказки: Audience Network з готовою дією, нема міток, на сайті не тиснуть — із текстом для копіювання', () => {
  const r = analyze(mapOf(ad(), [site]), rows, { project: { usdRate: 42 }, emptyAdSets: [{ name: 'Порожня' }] });
  const an = r.ads['1'].find((h) => h.title.startsWith('Audience Network'));
  assert.ok(an.title.includes('79%'), an.title);
  assert.deepStrictEqual(an.action.placements, ['facebook', 'instagram', 'messenger']);
  assert.ok(r.ads['1'].some((h) => h.title.includes('нема мітки')));
  assert.ok(r.ads['1'].some((h) => h.title.includes('дочекались сайту')));
  const s = r.elements['site:lp'][0];
  assert.ok(s.title.includes('0 з 317') && s.copy.includes('https://x.ua') && s.copy.includes('Обіцяємо карту') && !s.action);
  assert.strictEqual(r.general.length, 1);
});

test('підказки: якщо Audience Network уже вимкнено — без дії; мало даних сайту — без вироку', () => {
  const quiet = { ...site, steps: [{ ...site.steps[0], total: 9 }, site.steps[1]] };
  const r = analyze(mapOf(ad({ placements: { auto: false, list: ['instagram'] } }), [quiet]), rows, { project: {} });
  const an = r.ads['1'].find((h) => h.title.startsWith('Audience Network'));
  assert.ok(an.title.includes('уже вимкнено') && !an.action);
  assert.ok(!r.elements['site:lp']);
});

// ── Правки в кабінеті ──
const realFetch = global.fetch;
let project; let adRow; let setRow; let c2; let c2Url; const sent = []; let live;
test.before(async () => {
  c2 = http.createServer((req, res) => {
    if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end('PNG'); }
    let raw = ''; req.on('data', (d) => { raw += d; }).on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, data: { creatives: [{ id: 'new', number: 31, status: 'scheduled', mediaType: 'image', mediaUrl: `${c2Url}/a.png`, violations: null, text: 'Основний текст:\nНовий текст\nЗаголовок: Новий заголовок\nКнопка: Дізнатися більше' }, { id: 'bad', number: 32, status: 'scheduled', mediaType: 'image', mediaUrl: `${c2Url}/b.png`, violations: ['задовгий заголовок'], text: 'x' }] } })); });
    return undefined;
  });
  await new Promise((r) => c2.listen(0, '127.0.0.1', r)); c2Url = `http://127.0.0.1:${c2.address().port}`;
  live = { targeting: { geo_locations: { countries: ['UA'] }, brand_safety_content_filter_levels: ['FACEBOOK_RELAXED', 'AN_RELAXED'] }, creative: { id: '5550001', object_story_spec: { page_id: '100200', link_data: { link: 'https://x.ua/?utm_source=meta' } } } };
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (u.hostname !== 'graph.facebook.com') return realFetch(url, opts);
    const parts = u.pathname.split('/').filter(Boolean).slice(1); const post = opts.method === 'POST';
    const body = Object.fromEntries(new URLSearchParams(opts.body ? String(opts.body) : ''));
    const json = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
    sent.push({ post, path: parts.join('/'), body });
    if (post) {
      if (parts[1] === 'adimages') return json({ images: { b: { hash: 'h9' } } });
      if (parts[1] === 'ads') { live.newAd = body; return json({ id: '830777' }); }
      if (parts[1] === 'adcreatives') { live.pending = { id: '5550002', ...body }; return json({ id: '5550002' }); }
      if (body.targeting) live.targeting = JSON.parse(body.targeting);
      if (body.creative) live.creative = { id: JSON.parse(body.creative).creative_id };
      return json({ success: true });
    }
    if (String(u.searchParams.get('fields')).startsWith('status')) return json({ status: 'PAUSED', effective_status: 'PAUSED' });
    return String(u.searchParams.get('fields')).startsWith('creative') ? json({ creative: live.creative }) : json({ targeting: live.targeting });
  };
  await db.project.deleteMany({ where: { slug: 'selftest7' } });
  project = await db.project.create({ data: { name: 'Самоперевірка 7', slug: 'selftest7', apiKey: `ads_selftest7_${Date.now()}`, usdRate: 40, dryRun: false } });
  const conn = await db.connection.create({ data: { projectId: project.id, channel: 'meta', name: 'М', externalId: '424242', status: 'ok', secretRead: encrypt('r'), secretWrite: encrypt('w'), config: { check: { currency: 'UAH' } } } });
  await db.connection.create({ data: { projectId: project.id, channel: 'content2', name: 'К', externalId: c2Url, secretRead: encrypt('k'), config: { projectId: 'p' } } });
  const camp = await db.campaign.create({ data: { projectId: project.id, connectionId: conn.id, channel: 'meta', externalId: '810001', name: 'К', effectiveStatus: 'ACTIVE' } });
  setRow = await db.adSet.create({ data: { projectId: project.id, campaignId: camp.id, channel: 'meta', externalId: '820001', name: 'Г', extUpdatedAt: new Date() } });
  adRow = await db.ad.create({ data: { projectId: project.id, campaignId: camp.id, adSetId: setRow.id, channel: 'meta', externalId: '830001', name: 'О', status: 'ACTIVE' } });
});
test.after(async () => { global.fetch = realFetch; await db.project.deleteMany({ where: { slug: 'selftest7' } }); c2.closeAllConnections(); await new Promise((r) => c2.close(r)); await db.$disconnect(); });

const act = (input, actor = 'user:1') => actions.perform(project, input, { actor });

test('(8) свіжо змінену групу не чіпаємо; (15) без людини нічого', async () => {
  const fresh = await act({ kind: 'set_placements', adSetId: setRow.id, placements: ['instagram'] });
  assert.ok(fresh.status === 'blocked' && fresh.reasons.join(' ').includes('(8)'));
  await db.adSet.update({ where: { id: setRow.id }, data: { extUpdatedAt: new Date(Date.now() - 10 * 86400000) } });
  const robot = await act({ kind: 'set_placements', adSetId: setRow.id, placements: ['instagram'] }, 'rule:x');
  assert.ok(robot.status === 'blocked' && robot.reasons.join(' ').includes('(15)'));
  assert.strictEqual(sent.filter((s) => s.post).length, 0);
});

test('площадки: інші налаштування групи збережені, фільтр вимкненої площадки прибрано, перечитано', async () => {
  const r = await act({ kind: 'set_placements', adSetId: setRow.id, placements: ['facebook', 'instagram'] });
  assert.strictEqual(r.status, 'done', JSON.stringify(r));
  assert.deepStrictEqual(live.targeting, { geo_locations: { countries: ['UA'] }, brand_safety_content_filter_levels: ['FACEBOOK_RELAXED'], publisher_platforms: ['facebook', 'instagram'] });
});

test('креатив: порушення правил (4) блокує; добрий — нова картинка, мітка оголошення в посиланні, перечитано', async () => {
  await db.adSet.update({ where: { id: setRow.id }, data: { extUpdatedAt: new Date(Date.now() - 10 * 86400000) } });
  const bad = await act({ kind: 'replace_creative', adId: adRow.id, creativeId: 'bad' });
  assert.ok(bad.status === 'blocked' && bad.reasons.join(' ').includes('(4)'));
  sent.length = 0;
  const r = await act({ kind: 'replace_creative', adId: adRow.id, creativeId: 'new' });
  assert.strictEqual(r.status, 'done', JSON.stringify(r));
  const story = JSON.parse(live.pending.object_story_spec);
  assert.deepStrictEqual([story.page_id, story.link_data.message, story.link_data.name, story.link_data.image_hash], ['100200', 'Новий текст', 'Новий заголовок', 'h9']);
  assert.strictEqual(story.link_data.link, 'https://x.ua/?utm_source=meta&ad_id=830001');
  assert.strictEqual((await db.ad.findUnique({ where: { id: adRow.id } })).content2PostId, 'new');
});

test('нове оголошення в групу: вимкнене, на ту саму адресу з власною міткою, зʼявляється на полиці як «в рекламі»', async () => {
  const noLink = await db.adSet.create({ data: { projectId: project.id, campaignId: adRow.campaignId, channel: 'meta', externalId: '820002', name: 'Порожня' } });
  const need = await act({ kind: 'add_ad', adSetId: noLink.id, creativeId: 'new' });
  assert.ok(need.status === 'blocked' && need.reasons.join(' ').includes('куди веде'), JSON.stringify(need));
  const bot = await act({ kind: 'add_ad', adSetId: noLink.id, creativeId: 'new', link: 'https://t.me/some_bot' });
  assert.ok(bot.status === 'blocked' && bot.reasons.join(' ').includes('start'));
  live.creative = { id: '5550001', object_story_spec: { page_id: '100200', link_data: { link: 'https://x.ua/' } } };
  const r = await act({ kind: 'add_ad', adSetId: setRow.id, creativeId: 'new' });
  assert.strictEqual(r.status, 'done', JSON.stringify(r));
  assert.deepStrictEqual([live.newAd.status, live.newAd.adset_id], ['PAUSED', '820001']);
  assert.strictEqual(JSON.parse(live.pending.object_story_spec).link_data.link, 'https://x.ua/?utm_source=meta&ad_id=830777');
  const row = await db.ad.findFirst({ where: { projectId: project.id, externalId: '830777' } });
  assert.deepStrictEqual([row.status, row.content2PostId], ['PAUSED', 'new']);
  const lib = await require('../src/services/library').library(project);
  const item = lib.items.find((x) => x.id === 'new');
  assert.ok(item.usable && item.ads.some((a) => a.externalId === '830777'), JSON.stringify(item));
  assert.ok(lib.items.find((x) => x.id === 'bad').problem);
  assert.ok(lib.adSets.some((s) => s.name === 'Порожня' && !s.hasLink));
});

test('режим «проба»: правка лише в журналі', async () => {
  project = await db.project.update({ where: { id: project.id }, data: { dryRun: true } });
  await db.adSet.update({ where: { id: setRow.id }, data: { extUpdatedAt: new Date(Date.now() - 10 * 86400000) } });
  await db.actionLog.deleteMany({ where: { projectId: project.id } });
  sent.length = 0;
  const r = await act({ kind: 'set_placements', adSetId: setRow.id, placements: ['instagram'] });
  assert.strictEqual(r.status, 'dry_run', JSON.stringify(r));
  assert.strictEqual(sent.length, 0);
});
