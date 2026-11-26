// Історія тестів: цифри за оголошеннями, заборона дублів, закриття лише з висновком, заморожені результати.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { db } = require('@ads/db');

let project; let srv; let ad;
const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

test.before(async () => {
  await db.project.deleteMany({ where: { slug: 'selftest8' } });
  project = await db.project.create({ data: { name: 'Самоперевірка 8', slug: 'selftest8', apiKey: `ads_selftest8_${Date.now()}`, usdRate: 40 } });
  const conn = await db.connection.create({ data: { projectId: project.id, channel: 'meta', name: 'М', externalId: '99', status: 'ok' } });
  const c = await db.campaign.create({ data: { projectId: project.id, connectionId: conn.id, channel: 'meta', externalId: 'c8', name: 'К' } });
  const s = await db.adSet.create({ data: { projectId: project.id, campaignId: c.id, channel: 'meta', externalId: 's8', name: 'Г' } });
  ad = await db.ad.create({ data: { projectId: project.id, campaignId: c.id, adSetId: s.id, channel: 'meta', externalId: '880001', name: 'О' } });
  await db.insightDaily.create({ data: { adId: ad.id, date: today, spend: 200, currency: 'UAH', impressions: 1000, linkClicks: 50 } });
  const el = await db.element.create({ data: { projectId: project.id, type: 'flows', ref: 'bot', name: 'Бот' } });
  await db.step.createMany({ data: [{ elementId: el.id, key: 'start', title: 'Відкрив', order: 1 }, { elementId: el.id, key: 'reply', title: 'Відповів', order: 2 }] });
  const ev = (sourceId, stepKey, personKey, isTest = false) => ({ projectId: project.id, elementType: 'flows', elementRef: 'bot', sourceId, stepKey, ts: new Date(), personKey, adExtId: '880001', isTest });
  await db.stepEvent.createMany({ data: [ev('1', 'start', 'a'), ev('2', 'start', 'b'), ev('3', 'start', 'a'), ev('4', 'reply', 'a'), ev('5', 'start', 'z', true)] });
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.project = project; req.actor = 'user:1'; next(); });
  app.use('/api', require('../src/routes/experiments'));
  app.use(require('../src/middleware/errorHandler'));
  srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
});
test.after(async () => { await db.project.deleteMany({ where: { slug: 'selftest8' } }); await new Promise((r) => srv.close(r)); await db.$disconnect(); });

const call = (method, p, body) => fetch(`http://127.0.0.1:${srv.address().port}/api${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));
const base = { audience: 'Власники', pain: 'Excel і Viber', offer: 'Карта', creative: '№2035', site: '', bot: 'bot-karta-sales' };

test('однаковий варіант двічі не завести (регістр і лапки не рятують); з явною згодою — можна', async () => {
  const a = await call('POST', '/experiments', { code: 'V1', title: 'Перший', ...base, adExtIds: ['880001', 'не номер'] });
  assert.strictEqual(a.status, 201, JSON.stringify(a.json));
  assert.deepStrictEqual(a.json.data.adExtIds, ['880001']);
  const twin = await call('POST', '/experiments', { code: 'V2', title: 'Копія', ...base, pain: '«excel і viber»' });
  assert.strictEqual(twin.status, 409);
  assert.ok(twin.json.error.message.includes('V1'));
  assert.strictEqual((await call('POST', '/experiments', { code: 'V2', title: 'Копія', ...base, force: true })).status, 201);
  assert.strictEqual((await call('POST', '/experiments', { code: 'V1', title: 'Той самий код', pain: 'інший' })).status, 409);
});

test('цифри рахуються за оголошеннями без тестових людей; закрити без висновку не можна; результат заморожується', async () => {
  const id = (await call('GET', '/experiments')).json.data.experiments.find((e) => e.code === 'V1').id;
  const run = await call('PATCH', `/experiments/${id}`, { status: 'running' });
  assert.deepStrictEqual([run.json.data.result.spend, run.json.data.result.linkClicks, run.json.data.result.steps.map((s) => [s.title, s.people])], [200, 50, [['Відкрив', 2], ['Відповів', 1]]]);
  assert.strictEqual((await call('PATCH', `/experiments/${id}`, { status: 'lost' })).status, 400);
  const done = await call('PATCH', `/experiments/${id}`, { status: 'lost', conclusion: 'Люди не відповідають' });
  assert.ok(done.json.data.frozen && done.json.data.dateTo);
  await db.insightDaily.updateMany({ where: { adId: ad.id }, data: { spend: 999 } });
  const after = (await call('GET', '/experiments')).json.data.experiments.find((e) => e.id === id);
  assert.strictEqual(after.result.spend, 200, 'закритий тест не міняється заднім числом');
  assert.strictEqual((await call('PATCH', `/experiments/${id}`, { pain: 'переписую' })).status, 400);
  assert.strictEqual((await call('DELETE', `/experiments/${id}`)).status, 400);
  const { keyAllowed, isAllowed } = require('../src/lib/pageAccess');
  assert.ok(!keyAllowed('POST', '/experiments') && isAllowed({ role: 'user', pageIds: ['map'] }, 'GET', '/experiments') && !isAllowed({ role: 'user', pageIds: ['map'] }, 'POST', '/experiments'));
});
