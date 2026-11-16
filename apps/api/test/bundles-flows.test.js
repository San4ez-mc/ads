// Наскрізна перевірка на локальній базі: етапи бота з підробленого Flows, зведення «код заходу → оголошення», сума продажу
// за замовчуванням, зв'язки за кодом у назві кампанії. Запуск: npm test
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { db } = require('@ads/db');
const { encrypt } = require('../src/lib/secrets');

const today = new Date().toISOString().slice(0, 10);
const day = new Date(`${today}T00:00:00Z`);
let flowsServer; let appServer; let base; let project; let flowsCalls = 0;

const FUNNEL = { botId: 'b1', slug: 'bot-karta-sales', name: 'Ден — Карта', stages: [{ name: 'Відкрив бота', order: 1, side: false }, { name: 'Оплатив', order: 5, side: false }, { name: 'Мовчав 24 год', order: 14, side: true }] };
const EVENTS = [
  { sessionId: 's1', slug: 'bot-karta-sales', stage: 'Відкрив бота', order: 1, ts: `${today}T08:10:00Z`, isTest: false, clickId: 'AAAAAAAAA1', adId: null },
  { sessionId: 's1', slug: 'bot-karta-sales', stage: 'Оплатив', order: 5, ts: `${today}T08:30:00Z`, isTest: false, clickId: 'AAAAAAAAA1', adId: null },
  { sessionId: 's2', slug: 'bot-karta-sales', stage: 'Відкрив бота', order: 1, ts: `${today}T09:00:00Z`, isTest: false, clickId: null, adId: 'x2' },
  { sessionId: 's2', slug: 'bot-karta-sales', stage: 'Мовчав 24 год', order: 14, ts: `${today}T09:05:00Z`, isTest: false, clickId: null, adId: 'x2' },
  { sessionId: 's3', slug: 'bot-karta-sales', stage: 'Відкрив бота', order: 1, ts: `${today}T10:00:00Z`, isTest: false, clickId: null, adId: null },
  { sessionId: 's9', slug: 'bot-karta-sales', stage: 'Оплатив', order: 5, ts: `${today}T11:00:00Z`, isTest: true, clickId: null, adId: 'x2' },
];

test.before(async () => {
  flowsServer = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); flowsCalls += 1;
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== 'Bearer feed-key') return send(401, { ok: false, error: { code: 'AUTH_ERROR', message: 'Невірний ключ' } });
    if (u.pathname === '/ping') return send(200, { ok: true, data: { service: 'fineko-flows' } });
    if (u.pathname === '/funnels') return send(200, { ok: true, data: { funnels: u.searchParams.get('slugs').split(',').includes(FUNNEL.slug) ? [FUNNEL] : [] } });
    if (u.pathname === '/events') { const after = u.searchParams.get('after'); const list = EVENTS.filter((e) => !after || e.ts >= after); return send(200, { ok: true, data: { events: list, next: list.length ? list[list.length - 1].ts : after, hasMore: false } }); }
    send(404, { ok: false, error: { code: 'not_found', message: 'no' } });
  });
  await new Promise((r) => flowsServer.listen(0, '127.0.0.1', r));

  await db.project.deleteMany({ where: { slug: 'selftest2' } });
  project = await db.project.create({ data: { name: 'Самоперевірка 2', slug: 'selftest2', apiKey: `ads_selftest2_${Date.now()}`, usdRate: 40, targetSaleCost: 1500 } });
  const conn = await db.connection.create({ data: { projectId: project.id, channel: 'meta', name: 'Тест', externalId: '222' } });
  await db.connection.create({ data: { projectId: project.id, channel: 'flows', name: 'Боти', externalId: `http://127.0.0.1:${flowsServer.address().port}`, secretRead: encrypt('feed-key'), config: { slugs: ['bot-karta-sales', 'nema-takoi'] } } });
  // Дві кампанії: одна належить зв'язці [A1], друга ні.
  const mk = async (cext, cname, ads) => {
    const c = await db.campaign.create({ data: { projectId: project.id, connectionId: conn.id, channel: 'meta', externalId: cext, name: cname, effectiveStatus: 'ACTIVE' } });
    const s = await db.adSet.create({ data: { projectId: project.id, campaignId: c.id, channel: 'meta', externalId: `${cext}s`, name: 'група' } });
    for (const [ext, spend] of ads) { const a = await db.ad.create({ data: { projectId: project.id, campaignId: c.id, adSetId: s.id, channel: 'meta', externalId: ext, name: ext, effectiveStatus: 'ACTIVE' } }); await db.insightDaily.create({ data: { adId: a.id, date: day, spend, currency: 'USD', impressions: 100, linkClicks: 10 } }); }
  };
  await mk('k1', 'Консультація [a1] лендінг → бот', [['x1', 10]]);
  await mk('k2', 'Інша кампанія', [['x2', 5]]);
  // Захід із лендінгу: код AAAAAAAAA1 належить оголошенню x1 (так це знає сайт).
  await db.click.create({ data: { projectId: project.id, clickId: 'AAAAAAAAA1', ts: new Date(), adExtId: 'x1', campaignExtId: 'k1' } });

  const app = require('../src/index');
  appServer = app.listen(0, '127.0.0.1');
  await new Promise((r) => appServer.once('listening', r));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

test.after(async () => {
  await db.project.deleteMany({ where: { slug: 'selftest2' } });
  await new Promise((r) => appServer.close(r)); await new Promise((r) => flowsServer.close(r));
  await db.$disconnect();
});

const call = (method, p, body) => fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${project.apiKey}` }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));

test('етапи бота читаються з Flows і стають елементом шляху; бічні етапи позначені', async () => {
  const r = await call('POST', '/api/sync/run', { kinds: ['flows'] });
  assert.ok(r.json.data.ok, JSON.stringify(r.json.data));
  assert.strictEqual(r.json.data.results[0].stats.events, 6);
  const el = await db.element.findFirst({ where: { projectId: project.id, type: 'flows', ref: 'bot-karta-sales' }, include: { steps: true } });
  assert.strictEqual(el.steps.length, 3);
  assert.strictEqual(el.steps.find((s) => s.key === 'Мовчав 24 год').branch, 'side');
});

test('код заходу з лендінгу перетворюється на оголошення', async () => {
  const rows = await db.stepEvent.findMany({ where: { projectId: project.id, personKey: 's1' } });
  assert.ok(rows.length === 2 && rows.every((e) => e.adExtId === 'x1'), 'розмова s1 прийшла з кодом AAAAAAAAA1 → оголошення x1');
  const s2 = await db.stepEvent.findFirst({ where: { projectId: project.id, personKey: 's2' } });
  assert.strictEqual(s2.adExtId, 'x2', 'номер оголошення прямо з посилання на бота');
});

test('власник позначає етап продажем і ставить суму; синхронізація цього не затирає', async () => {
  const el = await db.element.findFirst({ where: { projectId: project.id, type: 'flows' } });
  await db.step.update({ where: { elementId_key: { elementId: el.id, key: 'Оплатив' } }, data: { isSale: true, defaultAmount: 1500 } });
  await call('POST', '/api/sync/run', { kinds: ['flows'] });
  const st = await db.step.findUnique({ where: { elementId_key: { elementId: el.id, key: 'Оплатив' } } });
  assert.ok(st.isSale && Number(st.defaultAmount) === 1500);
  assert.strictEqual(await db.stepEvent.count({ where: { projectId: project.id } }), 6, 'повторне читання не подвоює події');
  const again = await db.stepEvent.findMany({ where: { projectId: project.id, personKey: 's1' } });
  assert.ok(again.every((e) => e.adExtId === 'x1'), 'повторне читання не стерло знайдене оголошення');
});

test('продаж у боті рахується оголошенню з сумою за замовчуванням; тестова оплата — ні', async () => {
  const ads = (await call('GET', `/api/ads?from=${today}&to=${today}`)).json.data.ads;
  const x1 = ads.find((a) => a.externalId === 'x1'); const x2 = ads.find((a) => a.externalId === 'x2');
  assert.deepStrictEqual([x1.sales, x1.revenue, x1.saleCost], [1, 1500, 400]);
  assert.strictEqual(x2.sales, 0);
});

test('карта: етапи бота з людьми по оголошеннях, бічний етап, невідоме джерело', async () => {
  const m = (await call('GET', `/api/map?from=${today}&to=${today}`)).json.data;
  const el = m.elements.find((e) => e.key === 'flows:bot-karta-sales');
  const open = el.steps.find((s) => s.key === 'Відкрив бота'); const paid = el.steps.find((s) => s.key === 'Оплатив');
  assert.deepStrictEqual([open.total, open.byAd.x1, open.byAd.x2, open.unknown], [3, 1, 1, 1]);
  assert.deepStrictEqual([paid.total, paid.amount, paid.isSale], [1, 1500, true]);
  assert.strictEqual(el.steps.find((s) => s.key === 'Мовчав 24 год').branch, 'side');
  const x1 = m.campaigns.flatMap((c) => c.adSets.flatMap((s) => s.ads)).find((a) => a.externalId === 'x1');
  assert.strictEqual(x1.entry, 'flows:bot-karta-sales');
});

test('зв\'язка збирає оголошення за кодом у назві кампанії; закрити тест без підсумку не можна', async () => {
  const b = await db.bundle.create({ data: { projectId: project.id, name: 'Лендінг → бот', code: 'A1', status: 'test', testBudgetUsd: 20, path: [{ key: 'flows:bot-karta-sales', note: 'бот' }] } });
  const list = (await call('GET', '/api/bundles')).json.data.bundles;
  const x = list.find((q) => q.id === b.id);
  assert.deepStrictEqual([x.metrics.ads, x.metrics.spend, x.metrics.sales, x.metrics.saleCost, x.metrics.budgetUsedPct, x.metrics.state], [1, 400, 1, 400, 50, 'good']);
  const m = (await call('GET', `/api/map?from=${today}&to=${today}&bundle=${b.id}`)).json.data;
  assert.strictEqual(m.campaigns.length, 1, 'на карті зв\'язки лише її кампанія');
  assert.strictEqual(m.bundle.code, 'A1');
  // Ключ проєкту (воронка) зв'язки лише читає.
  assert.strictEqual((await call('PATCH', `/api/bundles/${b.id}`, { status: 'works' })).status, 403);
});
