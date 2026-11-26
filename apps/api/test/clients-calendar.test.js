// Ручні позначки клієнтів (консультація, продажі далі, Instagram) і записи з календаря: події кроків, атрибуція, дохід далі, без персональних даних.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { db } = require('@ads/db');
const { encrypt } = require('../src/lib/secrets');
const { runProjectSync } = require('../src/services/sync');
const { adRows, period } = require('../src/routes/ads');

const today = new Date().toISOString().slice(0, 10);
let project; let calServer; let mini; let ms; let ad;

const BOOKINGS = [
  { id: 'b1', createdAt: new Date().toISOString(), status: 'confirmed', source: 'cAAAAAAAAA1', clientName: 'Іван Петренко', clientPhone: '+380501112233', clientTelegram: '@ivan' },
  { id: 'b2', createdAt: new Date().toISOString(), status: 'confirmed', source: 'bot-karta-sales', clientName: 'Марія', clientPhone: '+380671112233' },
  { id: 'b4', createdAt: new Date().toISOString(), status: 'confirmed', source: 'a120252778606070776', clientName: 'З реклами' },
  { id: 'b3', createdAt: new Date().toISOString(), status: 'cancelled', source: 'cBBBBBBBBB2', clientName: 'Скасований', clientPhone: '+380931112233' },
];

test.before(async () => {
  calServer = http.createServer((req, res) => {
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== 'Bearer cal-key') return send(401, { ok: false, error: { code: 'AUTH_ERROR', message: 'Невірний ключ' } });
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/tenant') return send(200, { ok: true, data: { name: 'Олександр Мацук' } });
    if (u.pathname === '/bookings') return send(200, { ok: true, data: BOOKINGS });
    send(404, { ok: false, error: { code: 'NOT_FOUND', message: 'no' } });
  });
  await new Promise((r) => calServer.listen(0, '127.0.0.1', r));
  await db.project.deleteMany({ where: { slug: 'selftest4' } });
  project = await db.project.create({ data: { name: 'Самоперевірка 4', slug: 'selftest4', apiKey: `ads_selftest4_${Date.now()}`, usdRate: 40, targetSaleCost: 1500 } });
  const mconn = await db.connection.create({ data: { projectId: project.id, channel: 'meta', name: 'М', externalId: '444', status: 'ok' } });
  const camp = await db.campaign.create({ data: { projectId: project.id, connectionId: mconn.id, channel: 'meta', externalId: 'k1', name: 'К', effectiveStatus: 'ACTIVE' } });
  const set = await db.adSet.create({ data: { projectId: project.id, campaignId: camp.id, channel: 'meta', externalId: 'k1s', name: 'Г' } });
  ad = await db.ad.create({ data: { projectId: project.id, campaignId: camp.id, adSetId: set.id, channel: 'meta', externalId: 'x1', name: 'Оголошення 1', effectiveStatus: 'ACTIVE' } });
  await db.insightDaily.create({ data: { adId: ad.id, date: new Date(`${today}T00:00:00Z`), spend: 10, currency: 'USD' } }); // 400 грн
  await db.click.create({ data: { projectId: project.id, clickId: 'AAAAAAAAA1', ts: new Date(), adExtId: 'x1' } });
  await db.connection.create({ data: { projectId: project.id, channel: 'calendar', name: 'Календар', externalId: `http://127.0.0.1:${calServer.address().port}`, secretRead: encrypt('cal-key'), config: { slug: 'matsuk' } } });
  // Один платіжний крок сайту для «оплат без клієнта».
  const el = await db.element.create({ data: { projectId: project.id, type: 'site', ref: 'lp', name: 'Лендінг' } });
  await db.step.create({ data: { elementId: el.id, key: 'pay_success', title: 'Оплатив', order: 1, isSale: true } });
  await db.stepEvent.create({ data: { projectId: project.id, elementType: 'site', elementRef: 'lp', sourceId: 'pay1', stepKey: 'pay_success', ts: new Date(), personKey: 'v-pay1', adExtId: 'x1', amount: 1500, currency: 'UAH' } });

  const express = require('express');
  mini = express(); mini.use(express.json());
  mini.use((req, res, next) => { req.project = project; req.actor = 'user:1'; next(); });
  mini.use('/api', require('../src/routes/clients'));
  mini.use(require('../src/middleware/errorHandler'));
  ms = mini.listen(0, '127.0.0.1'); await new Promise((r) => ms.once('listening', r));
});

test.after(async () => { await db.project.deleteMany({ where: { slug: 'selftest4' } }); await new Promise((r) => ms.close(r)); await new Promise((r) => calServer.close(r)); await db.$disconnect(); });

const call = (method, p, body) => fetch(`http://127.0.0.1:${ms.address().port}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));
const events = (where) => db.stepEvent.findMany({ where: { projectId: project.id, ...where } });

test('календар: записи стають кроком, скасовані — ні, оголошення за кодом заходу, без персональних даних', async () => {
  const r = await runProjectSync(project.id, { kinds: ['calendar'] });
  assert.ok(r.ok, JSON.stringify(r));
  const ev = await events({ elementType: 'calendar' });
  assert.deepStrictEqual(ev.map((e) => e.sourceId).sort(), ['b1', 'b2', 'b4'], 'скасований запис не рахується');
  assert.strictEqual(ev.find((e) => e.sourceId === 'b4').adExtId, '120252778606070776', 'запис із бота несе номер оголошення');
  assert.strictEqual(ev.find((e) => e.sourceId === 'b1').adExtId, 'x1', 'код заходу cAAAAAAAAA1 → оголошення x1');
  assert.strictEqual(ev.find((e) => e.sourceId === 'b2').adExtId, null, 'запис з бота без коду — без оголошення');
  assert.ok(!JSON.stringify(ev).match(/Петренко|380501112233|@ivan|Марія/), 'персональних даних у базі нема');
  await runProjectSync(project.id, { kinds: ['calendar'] });
  assert.strictEqual((await events({ elementType: 'calendar' })).length, 3, 'повторне читання не подвоює');
});

test('клієнт з Instagram: етапи повідомлень стають подіями, не вище поточного', async () => {
  const c = await call('POST', '/api/clients', { label: 'Оля (інста)', source: 'instagram', adExtId: 'x1' });
  assert.strictEqual(c.status, 201);
  const id = c.json.data.id;
  assert.deepStrictEqual((await events({ elementType: 'instagram' })).map((e) => e.stepKey), ['wrote']);
  await call('PATCH', `/api/clients/${id}`, { stage: 'offer' });
  assert.deepStrictEqual((await events({ elementType: 'instagram' })).map((e) => e.stepKey).sort(), ['answered', 'offer', 'wrote']);
  await call('PATCH', `/api/clients/${id}`, { stage: 'answered' });
  assert.deepStrictEqual((await events({ elementType: 'instagram' })).map((e) => e.stepKey).sort(), ['answered', 'wrote'], 'етап можна повернути назад');
  assert.strictEqual((await call('PATCH', `/api/clients/${id}`, { stage: 'bogus' })).status, 400);
  assert.strictEqual((await call('POST', '/api/clients', { label: '  ' })).status, 400, 'порожній підпис не приймається');
});

test('продаж далі: подія з сумою й оголошенням, консультація стає «була», хто заплатив лише за дорожчий продукт, теж клієнт', async () => {
  const c = await call('POST', '/api/clients', { label: 'Клієнт А', source: 'manual', adExtId: 'x1' });
  const id = c.json.data.id;
  assert.strictEqual((await call('POST', `/api/clients/${id}/sales`, { product: 'Супровід', amount: 0 })).status, 400);
  const s = await call('POST', `/api/clients/${id}/sales`, { product: 'Супровід', amount: 15000 });
  assert.strictEqual(s.status, 201);
  const up = await events({ elementType: 'manual', stepKey: 'upsell' });
  assert.strictEqual(up.length, 1);
  assert.deepStrictEqual([Number(up[0].amount), up[0].adExtId], [15000, 'x1']);
  assert.strictEqual((await events({ elementType: 'manual', stepKey: 'done' })).length, 1, 'продаж означає, що консультація була');
  const rows = await adRows(project, period({ from: today, to: today }), {});
  const a = rows.find((r) => r.externalId === 'x1');
  assert.strictEqual(a.upsellRevenue, 15000);
  assert.strictEqual(a.upsellCount, 1);
  assert.strictEqual(a.sales, 2, 'двоє різних людей заплатили: одна на сайті, друга одразу за дорожчий продукт');
  assert.strictEqual(a.saleCost, 200);
  const del = await call('DELETE', `/api/clients/${id}/sales/${s.json.data.id}`);
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await events({ elementType: 'manual', stepKey: 'upsell' })).length, 0, 'прибрали продаж — зникла й подія');
  await call('PATCH', `/api/clients/${id}`, { consultDone: false });
  assert.strictEqual((await events({ elementType: 'manual', stepKey: 'done' })).length, 0);
});

test('оплати без клієнта: оплата з сайту → клієнт із тим самим оголошенням і більше не кандидат', async () => {
  const before = (await call('GET', '/api/clients/candidates')).json.data.candidates;
  const cand = before.find((c) => c.personKey === 'v-pay1');
  assert.ok(cand && cand.amount === 1500 && cand.adExtId === 'x1');
  const made = await call('POST', '/api/clients', { label: 'Богдан', fromEventId: cand.eventId });
  assert.strictEqual(made.status, 201);
  const cl = await db.client.findUnique({ where: { id: made.json.data.id } });
  assert.deepStrictEqual([cl.source, cl.adExtId, cl.personKey], ['site', 'x1', 'v-pay1']);
  const after = (await call('GET', '/api/clients/candidates')).json.data.candidates;
  assert.ok(!after.some((c) => c.personKey === 'v-pay1'), 'вже привʼязано');
  await call('POST', `/api/clients/${cl.id}/sales`, { product: 'Консультація 2', amount: 2000 });
  const up = (await events({ stepKey: 'upsell' }))[0];
  assert.strictEqual(up.personKey, 'v-pay1', 'продаж далі привʼязаний до тієї ж людини, що й оплата');
  const x1 = (await adRows(project, period({ from: today, to: today }), {})).find((r) => r.externalId === 'x1');
  assert.strictEqual(x1.sales, 1, 'дві оплати однієї людини — один клієнт');
});

test('видалення клієнта прибирає його події; чужі події не чіпає', async () => {
  const list = (await call('GET', '/api/clients')).json.data;
  const target = list.clients.find((c) => c.label === 'Оля (інста)');
  await call('DELETE', `/api/clients/${target.id}`);
  assert.strictEqual((await events({ elementType: 'instagram' })).length, 0);
  assert.strictEqual((await events({ elementType: 'calendar' })).length, 3, 'записи календаря лишились');
  assert.strictEqual((await events({ elementType: 'site', stepKey: 'pay_success' })).length, 1, 'оплата сайту лишилась');
  const { keyAllowed, isAllowed } = require('../src/lib/pageAccess');
  assert.ok(!keyAllowed('POST', '/clients') && !keyAllowed('GET', '/clients'), 'ключ воронки клієнтів не бачить');
  assert.ok(!isAllowed({ role: 'user', pageIds: ['ads'] }, 'GET', '/clients'));
});
