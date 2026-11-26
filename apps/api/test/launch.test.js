// Створення і запуск кампанії на підробленій Meta і підробленій контент-платформі. Справжні сервіси не викликаються.
process.env.META_VIDEO_POLL_MS = '1';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { db } = require('@ads/db');
const { encrypt } = require('../src/lib/secrets');
const launch = require('../src/services/launch');

const WRITE = 'EAAwritekeywritekeywritekey7777';
const realFetch = global.fetch;
const sent = []; let objects = {}; let seq = 5000000; let failOn = null; let videoPolls = 0; let disapproved = false;
let project; let conn; let bundle; let c2; let c2Url;

const adText = (button = 'Надіслати повідомлення') => `Основний текст:\nЗаявки губляться між чатами?\n\nПокажемо, де саме.\nЗаголовок: Карта автоматизації\nОпис: PDF безкоштовно\nКнопка: ${button}\nПосилання: додається в Ads Manager`;
const creatives = () => [
  { id: 'img', number: 11, status: 'scheduled', text: adText(), mediaUrl: `${c2Url}/uploads/a.png`, mediaType: 'image', violations: null },
  { id: 'vid', number: 12, status: 'scheduled', text: adText('Дізнатися більше'), mediaUrl: `${c2Url}/uploads/b.mp4`, mediaType: 'video', violations: null },
  { id: 'bad', number: 13, status: 'draft', text: adText(), mediaUrl: `${c2Url}/uploads/c.png`, mediaType: 'image', violations: ['плашка «для кого» 52 символів (макс 45)'] },
  { id: 'public', number: 15, status: 'scheduled', text: adText(), mediaUrl: 'https://content2.fineko.space/uploads/p.png', mediaType: 'image', violations: null },
  { id: 'foreign', number: 14, status: 'scheduled', text: adText(), mediaUrl: 'http://169.254.169.254/latest', mediaType: 'image', violations: null },
];

test.before(async () => {
  c2 = http.createServer((req, res) => {
    if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.from('PNGDATA')); }
    let raw = ''; req.on('data', (d) => { raw += d; }).on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, data: { creatives: creatives() } })); });
    return undefined;
  });
  await new Promise((r) => c2.listen(0, '127.0.0.1', r));
  c2Url = `http://127.0.0.1:${c2.address().port}`;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (u.hostname !== 'graph.facebook.com') return realFetch(url, opts);
    const parts = u.pathname.split('/').filter(Boolean).slice(1); // без версії
    const method = (opts.method || 'GET').toUpperCase();
    const body = Object.fromEntries(new URLSearchParams(opts.body ? String(opts.body) : ''));
    sent.push({ method, path: parts.join('/'), body, url: String(url), auth: opts.headers?.Authorization });
    const json = (code, data) => new Response(JSON.stringify(data), { status: code, headers: { 'Content-Type': 'application/json' } });
    if (method === 'POST') {
      const edge = parts[1];
      if (failOn && failOn.edge === edge) return json(400, { error: { message: failOn.message, code: 100, error_subcode: failOn.subcode } });
      if (edge === 'adimages') return json(200, { images: { bytes: { hash: 'hash123' } } });
      if (edge) { seq += 1; const id = String(seq); objects[id] = { edge, ...body }; return json(200, { id }); }
      objects[parts[0]] = { ...(objects[parts[0]] || {}), ...body }; return json(200, { success: true });
    }
    const obj = objects[parts[0]] || {};
    if (String(u.searchParams.get('fields')).includes('picture')) { videoPolls += 1; return json(200, { status: { video_status: videoPolls > 1 ? 'ready' : 'processing' }, picture: 'https://scontent.fbcdn.net/thumb.jpg' }); }
    return json(200, { status: obj.status || 'PAUSED', effective_status: disapproved && obj.edge === 'ads' ? 'DISAPPROVED' : obj.status || 'PAUSED' });
  };
  await db.project.deleteMany({ where: { slug: 'selftest6' } });
  project = await db.project.create({ data: { name: 'Самоперевірка 6', slug: 'selftest6', apiKey: `ads_selftest6_${Date.now()}`, usdRate: 40, dryRun: true } });
  conn = await db.connection.create({ data: { projectId: project.id, channel: 'meta', name: 'Каб', externalId: '777000', status: 'ok', secretRead: encrypt('read'), secretWrite: encrypt(WRITE), config: { check: { currency: 'USD' } } } });
  await db.connection.create({ data: { projectId: project.id, channel: 'content2', name: 'К', externalId: c2Url, secretRead: encrypt('c2'), config: { projectId: 'p' } } });
  bundle = await db.bundle.create({ data: { projectId: project.id, name: 'Бот карти', code: 'B1' } });
});

test.after(async () => { global.fetch = realFetch; await db.project.deleteMany({ where: { slug: 'selftest6' } }); c2.closeAllConnections(); await new Promise((r) => c2.close(r)); await db.$disconnect(); });

const reload = async () => { project = await db.project.findUnique({ where: { id: project.id } }); };
const posts = (edge) => sent.filter((s) => s.method === 'POST' && (edge ? s.path.endsWith(`/${edge}`) : true));
const form = (over = {}) => ({ connectionId: conn.id, bundleId: bundle.id, goal: 'clicks', destination: { type: 'telegram', bot: '@Fineko_test_bot', slug: 'bot-karta-sales' }, dailyBudget: 5, countries: 'UA', ageMin: 25, ageMax: 55, pageId: '100200300', creativeIds: ['img', 'vid'], ...over });
const draft = async (over) => { const spec = launch.parseSpec(form(over)); return db.launch.create({ data: { projectId: project.id, connectionId: conn.id, name: 'Т', spec } }); };
const get = (id) => db.launch.findUnique({ where: { id } });
const run = async (l) => { const r = await launch.create(project, l, { actor: 'user:1' }); if (r.job) await r.job; return r; };

test('форма: бот лише з «кліками», розширення аудиторії міняє вік за правилом Meta, кривий ввід відхиляється', () => {
  assert.throws(() => launch.parseSpec(form({ goal: 'landing' })), /кліки/);
  assert.throws(() => launch.parseSpec(form({ destination: { type: 'site', url: 'http://x.ua' } })), /https/);
  assert.throws(() => launch.parseSpec(form({ goal: 'leads', destination: { type: 'site', url: 'https://x.ua' } })), /пікселя/);
  assert.throws(() => launch.parseSpec(form({ creativeIds: [] })), /креатив/);
  const s = launch.parseSpec(form({ advantageAudience: true, ageMin: 30, ageMax: 50 }));
  assert.deepStrictEqual([s.ageMin, s.ageMax, s.destination.bot], [25, 65, 'Fineko_test_bot']);
});

test('текст креативу розбирається на поля; без заголовка — null', () => {
  const t = launch.parseCreativeText(adText());
  assert.deepStrictEqual([t.headline, t.description, t.cta], ['Карта автоматизації', 'PDF безкоштовно', 'CONTACT_US']);
  assert.ok(t.primary.startsWith('Заявки') && t.primary.endsWith('саме.'));
  assert.strictEqual(launch.parseCreativeText('просто пост'), null);
});

test('запобіжники: порушення правил (4), чужий файл, бюджет понад ліміт (10), лише людина (15)', async () => {
  const l = await draft({ creativeIds: ['bad', 'foreign'], dailyBudget: 50 });
  sent.length = 0;
  const r = await launch.create(project, l, { actor: 'rule:auto' });
  assert.strictEqual(r.status, 'blocked');
  const text = r.reasons.join(' | ');
  for (const part of ['(15)', '(4) Креатив №13', 'Креатив №14: нема картинки', '(10)']) assert.ok(text.includes(part), `${part} у: ${text}`);
  assert.strictEqual(posts().length, 0);
});

test('картинка з публічної адреси контент-платформи приймається, навіть коли звертаємось по внутрішній', async () => {
  const v = await launch.check(project, await draft({ creativeIds: ['public'] }), { actor: 'user:1' });
  assert.ok(v.ok, v.reasons.join(' | '));
});

test('режим «проба» (16): у кабінет нічого не пишеться', async () => {
  const l = await draft(); sent.length = 0;
  const r = await run(l);
  assert.strictEqual(r.status, 'dry_run', JSON.stringify(r));
  assert.strictEqual(posts().length, 0);
  assert.strictEqual((await get(l.id)).status, 'draft');
});

test('збій посередині: записано, на чому зупинились; повтор не створює дублів і пояснює режим розробки', async () => {
  await db.project.update({ where: { id: project.id }, data: { dryRun: false } }); await reload();
  const l = await draft(); sent.length = 0;
  failOn = { edge: 'adcreatives', subcode: 1885183, message: 'Ads creative post was created by an app that is in development mode' };
  await run(l);
  let row = await get(l.id);
  assert.strictEqual(row.status, 'failed');
  assert.ok(row.error.includes('режимі розробки'), row.error);
  assert.ok(row.ids.campaign && row.ids.adSet);
  failOn = null; sent.length = 0;
  await run(row);
  row = await get(l.id);
  assert.strictEqual(row.status, 'created', row.error);
  assert.strictEqual(posts('campaigns').length + posts('adsets').length + posts('adimages').length, 0, 'створене раніше не дублюється');
});

test('створене: усе вимкнене (3), номер оголошення вписано в посилання на бота, відео з обкладинкою, ключ лише в заголовку', async () => {
  const row = (await db.launch.findMany({ where: { projectId: project.id, status: 'created' } }))[0];
  const items = Object.values(row.ids.items);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(objects[row.ids.campaign].status, 'PAUSED');
  assert.strictEqual(objects[row.ids.adSet].status, 'PAUSED');
  assert.strictEqual(objects[row.ids.adSet].daily_budget, '500');
  assert.deepStrictEqual(JSON.parse(objects[row.ids.adSet].targeting), { geo_locations: { countries: ['UA'] }, age_min: 25, age_max: 55, targeting_automation: { advantage_audience: 0 }, publisher_platforms: ['facebook', 'instagram', 'messenger'] });
  assert.ok(objects[row.ids.campaign].name.startsWith('[B1] '), 'код зв\'язки в назві кампанії');
  for (const i of items) {
    assert.strictEqual(objects[i.ad].status, 'PAUSED');
    assert.deepStrictEqual(JSON.parse(objects[i.ad].creative), { creative_id: i.finalCreative });
    const spec = JSON.parse(objects[i.finalCreative].object_story_spec);
    const data = spec.link_data || spec.video_data;
    assert.strictEqual(data.call_to_action.value.link, `https://t.me/Fineko_test_bot?start=bot-karta-sales__a${i.ad}`);
    if (spec.video_data) assert.ok(spec.video_data.image_url.includes('thumb') && spec.video_data.video_id);
    else assert.strictEqual(spec.link_data.image_hash, 'hash123');
  }
  assert.ok(sent.every((s) => s.auth === `Bearer ${WRITE}` && !s.url.includes('EAA') && !JSON.stringify(s.body).includes('EAA')));
});

test('посилання на сайт: мітки й справжні номери, власні параметри не затираються', () => {
  const link = launch.adLink({ destination: { type: 'site', url: 'https://x.ua/p?utm_source=own&v=b' } }, { code: 'A1' }, { number: 7 }, { campaign: '1', adSet: '2', ad: '3' });
  const u = new URL(link);
  assert.deepStrictEqual(['utm_source', 'v', 'utm_campaign', 'utm_content', 'ad_id', 'adset_id', 'campaign_id'].map((k) => u.searchParams.get(k)), ['own', 'b', 'A1', 'n7', '3', '2', '1']);
});

test('запуск (10): ліміт не дає увімкнути більше; відхилене оголошення (6) блокує; кампанія вмикається останньою', async () => {
  const row = (await db.launch.findMany({ where: { projectId: project.id, status: 'created' } }))[0];
  const other = await db.campaign.create({ data: { projectId: project.id, connectionId: conn.id, channel: 'meta', externalId: '888', name: 'Стара', effectiveStatus: 'ACTIVE', dailyBudget: 6 } });
  const over = await launch.start(project, row, { actor: 'user:1' });
  assert.ok(over.status === 'blocked' && over.reasons.join(' ').includes('(10)'), JSON.stringify(over));
  await db.campaign.delete({ where: { id: other.id } });
  disapproved = true;
  const bad = await launch.start(project, row, { actor: 'user:1' });
  disapproved = false;
  assert.ok(bad.status === 'blocked' && bad.reasons.join(' ').includes('(6)'));
  sent.length = 0;
  const ok = await launch.start(project, row, { actor: 'user:1' });
  assert.strictEqual(ok.status, 'done', JSON.stringify(ok));
  assert.strictEqual(posts().at(-1).path, row.ids.campaign);
  assert.strictEqual((await get(row.id)).status, 'live');
});

test('друга кампанія понад денний ліміт не запускається, доки перша увімкнена', async () => {
  const second = await draft({ creativeIds: ['img'], dailyBudget: 6 });
  await run(second);
  const r = await launch.start(project, await get(second.id), { actor: 'user:1' });
  assert.ok(r.status === 'blocked' && r.reasons.join(' ').includes('(10)'), JSON.stringify(r));
  // Першу вимкнули в Ads Manager і синхронізація це побачила: ліміт знову вільний.
  const first = await db.launch.findFirst({ where: { projectId: project.id, status: 'live' } });
  const seen = await db.campaign.create({ data: { projectId: project.id, connectionId: conn.id, channel: 'meta', externalId: first.ids.campaign, name: 'x', effectiveStatus: 'PAUSED', syncedAt: new Date(Date.now() + 1000) } }).catch(async () => { await db.campaign.updateMany({ where: { projectId: project.id, externalId: first.ids.campaign }, data: { effectiveStatus: 'PAUSED', syncedAt: new Date(Date.now() + 1000) } }); return null; });
  await db.project.update({ where: { id: project.id }, data: { dryRun: true } }); await reload();
  assert.strictEqual((await launch.start(project, await get(second.id), { actor: 'user:1' })).status, 'dry_run');
  await db.project.update({ where: { id: project.id }, data: { dryRun: false } }); await reload();
  if (seen) await db.campaign.delete({ where: { id: seen.id } });
});

test('зупинка працює навіть у режимі «проба» і з обмеженим кабінетом', async () => {
  await db.project.update({ where: { id: project.id }, data: { dryRun: true } }); await reload();
  await db.connection.update({ where: { id: conn.id }, data: { status: 'blocked' } });
  const row = await db.launch.findFirst({ where: { projectId: project.id, status: 'live' } });
  const r = await launch.stop(project, row, { actor: 'user:1' });
  assert.strictEqual(r.status, 'done', JSON.stringify(r));
  assert.strictEqual(objects[row.ids.campaign].status, 'PAUSED');
  assert.strictEqual((await get(row.id)).status, 'stopped');
  const again = await launch.start(project, await get(row.id), { actor: 'user:1' });
  assert.ok(again.status === 'blocked' && again.reasons.join(' ').includes('(13)'));
  await db.connection.update({ where: { id: conn.id }, data: { status: 'ok' } });
  await db.project.update({ where: { id: project.id }, data: { dryRun: false } }); await reload();
});

test('(5) не більше 3 кампаній на добу; два натискання не створюють двох', async () => {
  const third = await draft({ creativeIds: ['img'] });
  const [a, b] = await Promise.all([launch.create(project, third, { actor: 'user:1' }), launch.create(project, third, { actor: 'user:1' })]);
  assert.deepStrictEqual([a.status, b.status].sort(), ['blocked', 'creating']);
  await (a.job || b.job);
  const fourth = await launch.check(project, await draft({ creativeIds: ['img'] }), { actor: 'user:1' });
  assert.ok(!fourth.ok && fourth.reasons.join(' ').includes('(5)'));
});

test('маршрути: без confirm нічого; ключ воронки й людина без «approve» створювати не можуть', async () => {
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.project = project; req.actor = 'user:1'; next(); });
  app.use('/api', require('../src/routes/launches'));
  app.use(require('../src/middleware/errorHandler'));
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
  const call = (method, p, body) => realFetch(`http://127.0.0.1:${srv.address().port}/api${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));
  try {
    const made = await call('POST', '/launches', form({ creativeIds: ['img'] }));
    assert.strictEqual(made.status, 201, JSON.stringify(made.json));
    for (const act of ['create', 'start', 'stop']) assert.strictEqual((await call('POST', `/launches/${made.json.data.id}/${act}`, {})).status, 400);
    const list = await call('GET', '/launches');
    assert.ok(list.json.data.launches.length >= 1 && !JSON.stringify(list.json).includes('EAA'));
    assert.strictEqual((await db.connection.findUnique({ where: { id: conn.id } })).config.launchDefaults.bot, 'Fineko_test_bot');
    assert.strictEqual((await call('DELETE', `/launches/${made.json.data.id}`)).status, 200);
  } finally { await new Promise((r) => srv.close(r)); }
  const { keyAllowed, isAllowed } = require('../src/lib/pageAccess');
  assert.ok(!keyAllowed('POST', '/launches') && !keyAllowed('GET', '/launches'));
  assert.ok(!isAllowed({ role: 'user', pageIds: ['ads'] }, 'POST', '/launches') && isAllowed({ role: 'user', pageIds: ['ads'] }, 'GET', '/launches'));
  assert.ok(isAllowed({ role: 'user', pageIds: ['approve'] }, 'POST', '/launches/x/create'));
});
