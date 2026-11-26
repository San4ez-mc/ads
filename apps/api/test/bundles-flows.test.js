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

test('рекомендації: що вимкнути, що підсилити, що почекати; звіт для Telegram', async () => {
  const { buildAdvice, dailyReportText } = require('../src/lib/advice');
  const ad = (o) => ({ externalId: o.id, name: o.id, running: true, spend: 0, sales: 0, saleCost: null, linkClicks: 10, impressions: 500, verdict: 'few', entry: null, createdAt: '2026-01-01', ...o });
  const map = { target: 1500, elements: [], campaigns: [{ name: 'К', adSets: [{ name: 'Г', dailyBudget: 10, learningStage: 'SUCCESS', ads: [
    ad({ id: 'bad0', spend: 3200, verdict: 'bad' }), ad({ id: 'good2', spend: 2000, sales: 2, saleCost: 1000, verdict: 'good' }), ad({ id: 'good1', spend: 1000, sales: 1, saleCost: 1000, verdict: 'good' }),
    ad({ id: 'pricey', spend: 4000, sales: 2, saleCost: 2000, verdict: 'pricey' }), ad({ id: 'dead', impressions: 3000, linkClicks: 0, spend: 300 }),
  ] }] }] };
  const items = buildAdvice(map, { overview: { todaySpend: 900, limit: 400 }, connections: [{ name: 'Meta', status: 'error', lastError: 'ключ прострочено' }] });
  const kinds = (id) => items.filter((i) => i.ad === id).map((i) => i.kind);
  assert.deepStrictEqual(kinds('bad0'), ['pause']);
  assert.deepStrictEqual(kinds('good2'), ['scale']);
  assert.deepStrictEqual(kinds('good1'), ['watch']);
  assert.ok(items.find((i) => i.ad === 'good1').preliminary, 'один продаж — лише попередньо');
  assert.deepStrictEqual(kinds('pricey'), ['watch']);
  assert.deepStrictEqual(kinds('dead'), ['no_clicks']);
  assert.ok(items.some((i) => i.kind === 'limit' && i.severity === 'high'));
  assert.ok(items.some((i) => i.kind === 'connection'));
  assert.ok(['high', 'high'].includes(items[0].severity), 'найважливіше першим');
  assert.ok(!items.some((i) => i.kind === 'scale' && i.ad === 'good1'), 'з одного продажу не масштабуємо');
  // Без цілі — просимо її задати і нічого не вирішуємо.
  // «Щось зламано»: гроші йдуть, а людей від оголошення нема; поріг і вимкнення — з правил проєкту.
  const stuck = { ...map, campaigns: [{ adSets: [{ ads: [ad({ id: 'stuck', spend: 300 })] }] }], elements: [{ key: 'flows:x', steps: [{ key: 's', order: 1, total: 0, byAd: {} }] }] };
  assert.ok(buildAdvice(stuck, { connections: [] }).some((i) => i.kind === 'broken' && i.ad === 'stuck'));
  assert.ok(!buildAdvice(stuck, { connections: [], project: { rules: { brokenSpend: 500 } } }).some((i) => i.kind === 'broken'));
  assert.ok(!buildAdvice(stuck, { connections: [], project: { rules: { brokenSpend: 0 } } }).some((i) => i.kind === 'broken'));
  const none = buildAdvice({ ...map, target: null }, { overview: null, connections: [] });
  assert.ok(none.some((i) => i.kind === 'setup') && !none.some((i) => i.kind === 'pause'));
  const text = dailyReportText({ name: 'FINEKO <тест>' }, '2026-11-16', { spend: 5000, linkClicks: 80, sales: 2, revenue: 3000, saleCost: 2500, target: 1500, todaySpend: 100, todayLimit: 420 }, items, []);
  assert.ok(text.includes('FINEKO &lt;тест&gt;') && text.includes('Що робити') && text.includes('Вимкнути'), 'HTML екранований, поради є');
  // Ендпоінт звіту через ключ проєкту (так його викликає воронка Flows).
  const r = await call('GET', '/api/report/daily');
  assert.strictEqual(r.status, 200);
  assert.ok(typeof r.json.data.text === 'string' && r.json.data.text.includes('Самоперевірка 2'));
});

test('контент-платформа: аудиторії ↔ персони, креативи, замовлення, підсумок тесту', async () => {
  const calls = []; const personas = [{ id: 'p1', name: 'Власник бізнесу', pains: 'рутина', goals: 'вільний час', triggers: null, objections: 'дорого', language: null }];
  const c2 = http.createServer((req, res) => {
    let raw = ''; req.on('data', (d) => { raw += d; }).on('end', () => {
      const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.headers.authorization !== 'Bearer c2-key') return send(401, { ok: false, error: { code: 'AUTH_ERROR', message: 'Невірний ключ' } });
      const b = JSON.parse(raw || '{}'); calls.push(b);
      if (b.action === 'ping') return send(200, { ok: true, data: { project: 'FINEKO — Контент', personas: 1, creatives: 1 } });
      if (b.action === 'personas') return send(200, { ok: true, data: { personas } });
      if (b.action === 'upsert_persona') { const id = `new-${calls.length}`; personas.push({ id, name: b.name, pains: b.pains }); return send(200, { ok: true, data: { id, created: true } }); }
      if (b.action === 'creatives') return send(200, { ok: true, data: { creatives: [{ id: 'g1', number: 7, status: 'draft', hook: 'Рутина їсть години', text: 'текст', mediaUrl: 'https://x/y.jpg', mediaType: 'image' }] } });
      if (b.action === 'order') return send(200, { ok: true, data: { sessionKey: 'ads-1', projectId: b.projectId } });
      if (b.action === 'learning') return send(200, { ok: true, data: { id: 'k1', created: true } });
      send(400, { ok: false, error: { code: 'VALIDATION_ERROR', message: 'no' } });
    });
  });
  await new Promise((r) => c2.listen(0, '127.0.0.1', r));
  const express = require('express');
  const mini = express(); mini.use(express.json());
  mini.use((req, res, next) => { req.project = project; req.actor = 'user:test'; req.access = { role: 'superadmin', pageIds: [] }; next(); });
  mini.use('/api', require('../src/routes/creatives'), require('../src/routes/bundles'));
  mini.use(require('../src/middleware/errorHandler'));
  const ms = mini.listen(0, '127.0.0.1'); await new Promise((r) => ms.once('listening', r));
  const call2 = (method, p, body) => fetch(`http://127.0.0.1:${ms.address().port}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));
  try {
    const { encrypt } = require('../src/lib/secrets');
    await db.connection.create({ data: { projectId: project.id, channel: 'content2', name: 'Контент', externalId: `http://127.0.0.1:${c2.address().port}`, secretRead: encrypt('c2-key'), config: { projectId: 'c2proj' } } });
    await db.audience.create({ data: { projectId: project.id, name: 'Нова з реклами', description: 'опис' } });
    const s = await call2('POST', '/api/audiences/sync');
    assert.deepStrictEqual(s.json.data, { pulled: 1, linked: 0, pushed: 1 }, 'персона підтягнулась, нова аудиторія створила персону');
    const auds = await db.audience.findMany({ where: { projectId: project.id } });
    assert.ok(auds.every((a) => a.content2PersonaId), 'усі аудиторії повʼязані з персонами');
    assert.ok(auds.find((a) => a.name === 'Власник бізнесу').description.includes('Болі: рутина'));
    const again = await call2('POST', '/api/audiences/sync');
    assert.deepStrictEqual(again.json.data, { pulled: 0, linked: 0, pushed: 0 }, 'повторна синхронізація нічого не міняє');
    const list = await call2('GET', '/api/creatives');
    assert.strictEqual(list.json.data.creatives[0].number, 7);
    const b = await db.bundle.create({ data: { projectId: project.id, name: 'Тест звязка', code: 'Z9', product: 'Розбір, 1500 грн', promise: '1 зустріч', angle: 'рутина', status: 'test', audienceId: auds.find((a) => a.name === 'Власник бізнесу').id } });
    const ord = await call2('POST', '/api/creatives/order', { bundleId: b.id, format: 'story', count: 2, wishes: ['замінити X'], note: 'без людей', dryRun: false });
    assert.strictEqual(ord.status, 200, JSON.stringify(ord.json));
    const sent = calls.filter((c) => c.action === 'order').pop();
    assert.ok(['Тест звязка', '[Z9]', 'сторіз', 'замінити X', 'без людей', 'Болі: рутина', 'не став їх у чергу публікації'].every((t) => sent.text.includes(t)), 'у замовленні є звязка, аудиторія, формат, побажання');
    assert.strictEqual((await call2('POST', '/api/creatives/order', {})).status, 400, 'порожнє замовлення не приймається');
    const bad = await call2('PATCH', `/api/bundles/${b.id}`, { status: 'works' });
    assert.strictEqual(bad.status, 400, 'без підсумку тест не закривається');
    const ok = await call2('PATCH', `/api/bundles/${b.id}`, { status: 'works', verdict: 'Окупилось з першого тижня' });
    assert.strictEqual(ok.status, 200);
    const learn = calls.filter((c) => c.action === 'learning').pop();
    assert.ok(learn && learn.title === 'Тест звязка' && learn.content.includes('ПРАЦЮЄ') && learn.content.includes('Окупилось'), 'підсумок поїхав у контент-платформу');
    // Ключ проєкту (воронка) замовляти креативи не може.
    assert.strictEqual((await call('POST', '/api/creatives/order', { note: 'x' })).status, 403);
    assert.strictEqual((await call('GET', '/api/creatives')).status, 403);
  } finally { await new Promise((r) => ms.close(r)); await new Promise((r) => c2.close(r)); }
});
