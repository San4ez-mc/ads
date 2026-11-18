// План воронок без рекламного кабінету: доріжки зв'язок (креативи → шлях → підсумок) працюють без оголошень; цифри зʼявляються, коли оголошення є.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { db } = require('@ads/db');
const { encrypt } = require('../src/lib/secrets');

const today = new Date().toISOString().slice(0, 10);
let project; let c2Server; let app; let srv; let bundle;

test.before(async () => {
  c2Server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (d) => { raw += d; }).on('end', () => {
      const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.headers.authorization !== 'Bearer c2-key') return send(401, { ok: false, error: { code: 'AUTH_ERROR', message: 'Невірний ключ' } });
      const b = JSON.parse(raw || '{}');
      if (b.action === 'creatives') return send(200, { ok: true, data: { creatives: [{ id: 'g1', number: 5, status: 'draft', hook: 'Рутина їсть години', mediaUrl: 'https://x/a.jpg', mediaType: 'image' }] } });
      send(400, { ok: false, error: { code: 'VALIDATION_ERROR', message: 'no' } });
    });
  });
  await new Promise((r) => c2Server.listen(0, '127.0.0.1', r));
  await db.project.deleteMany({ where: { slug: 'selftest5' } });
  project = await db.project.create({ data: { name: 'Самоперевірка 5', slug: 'selftest5', apiKey: `ads_selftest5_${Date.now()}`, usdRate: 40, targetSaleCost: 1500 } });
  const el = await db.element.create({ data: { projectId: project.id, type: 'site', ref: 'lp', name: 'Лендінг' } });
  await db.step.createMany({ data: [{ elementId: el.id, key: 'view', title: 'Відкрив', order: 1 }, { elementId: el.id, key: 'pay', title: 'Оплатив', order: 2, isSale: true }] });
  bundle = await db.bundle.create({ data: { projectId: project.id, name: 'Тестова воронка', code: 'P1', status: 'draft', creativeIds: ['g1', 'gone'], path: [{ key: 'site:lp', note: 'лендінг' }, { key: null, note: 'крок без даних' }] } });
  await db.connection.create({ data: { projectId: project.id, channel: 'content2', name: 'К', externalId: `http://127.0.0.1:${c2Server.address().port}`, secretRead: encrypt('c2-key'), config: { projectId: 'p' } } });
  const express = require('express');
  app = express(); app.use(express.json());
  app.use((req, res, next) => { req.project = project; req.actor = 'user:1'; next(); });
  app.use('/api', require('../src/routes/plan'));
  app.use(require('../src/middleware/errorHandler'));
  srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
});

test.after(async () => { await db.project.deleteMany({ where: { slug: 'selftest5' } }); srv.closeAllConnections(); c2Server.closeAllConnections(); await new Promise((r) => srv.close(r)); await new Promise((r) => c2Server.close(r)); await db.$disconnect(); });

const plan = () => fetch(`http://127.0.0.1:${srv.address().port}/api/map/plan?from=${today}&to=${today}`).then(async (r) => ({ status: r.status, json: await r.json() }));

test('план без реклами: креативи з контент-платформи, шлях із кроками й нотатками, цифр нема', async () => {
  const r = await plan();
  assert.strictEqual(r.status, 200);
  const d = r.json.data;
  assert.strictEqual(d.metaConnected, false);
  assert.strictEqual(d.contentConnected, true);
  const lane = d.lanes[0];
  assert.strictEqual(lane.bundle.code, 'P1');
  assert.deepStrictEqual(lane.creatives.map((c) => c.number), [5]);
  assert.strictEqual(lane.missingCreatives, 1, 'один підібраний креатив зник із контент-платформи — про це знаємо');
  assert.deepStrictEqual(lane.path.map((p) => p.kind), ['element', 'note']);
  assert.strictEqual(lane.path[0].element.steps.length, 2);
  assert.ok(lane.path[0].element.steps.every((s) => s.people === null), 'без оголошень людей не показуємо як нуль, а як «нема даних»');
  assert.strictEqual(lane.metrics.hasAds, false);
  assert.strictEqual(lane.metrics.state, 'none');
});

test('зʼявилось оголошення зв\'язки (код у назві кампанії): цифри підтягуються', async () => {
  const conn = await db.connection.create({ data: { projectId: project.id, channel: 'meta', name: 'М', externalId: '555', status: 'ok', secretRead: encrypt('k') } });
  const camp = await db.campaign.create({ data: { projectId: project.id, connectionId: conn.id, channel: 'meta', externalId: 'c', name: 'Кампанія [P1]', effectiveStatus: 'ACTIVE' } });
  const set = await db.adSet.create({ data: { projectId: project.id, campaignId: camp.id, channel: 'meta', externalId: 's', name: 'Г' } });
  const ad = await db.ad.create({ data: { projectId: project.id, campaignId: camp.id, adSetId: set.id, channel: 'meta', externalId: 'ad1', name: 'О', effectiveStatus: 'ACTIVE' } });
  await db.insightDaily.create({ data: { adId: ad.id, date: new Date(`${today}T00:00:00Z`), spend: 10, currency: 'USD' } });
  for (let i = 0; i < 3; i += 1) await db.stepEvent.create({ data: { projectId: project.id, elementType: 'site', elementRef: 'lp', sourceId: `v${i}`, stepKey: 'view', ts: new Date(), personKey: `p${i}`, adExtId: 'ad1' } });
  await db.stepEvent.create({ data: { projectId: project.id, elementType: 'site', elementRef: 'lp', sourceId: 'pay0', stepKey: 'pay', ts: new Date(), personKey: 'p0', adExtId: 'ad1', amount: 1500, currency: 'UAH' } });
  const d = (await plan()).json.data;
  assert.strictEqual(d.metaConnected, true);
  const lane = d.lanes[0];
  assert.strictEqual(lane.ads.length, 1);
  const steps = lane.path[0].element.steps;
  assert.deepStrictEqual([steps.find((s) => s.key === 'view').people, steps.find((s) => s.key === 'pay').people], [3, 1]);
  assert.deepStrictEqual([lane.metrics.hasAds, lane.metrics.spend, lane.metrics.sales, lane.metrics.saleCost, lane.metrics.state], [true, 400, 1, 400, 'good']);
});

test('без підключеної контент-платформи план усе одно працює', async () => {
  await db.connection.deleteMany({ where: { projectId: project.id, channel: 'content2' } });
  const d = (await plan()).json.data;
  assert.strictEqual(d.contentConnected, false);
  assert.deepStrictEqual(d.lanes[0].creatives, []);
  assert.strictEqual(d.lanes[0].path.length, 2);
});
