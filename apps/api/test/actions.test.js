// Дії в кабінеті на підробленій Meta: запобіжники, режим «проба», перевірка після зміни, журнал. Справжня Meta не викликається.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { db } = require('@ads/db');
const { encrypt } = require('../src/lib/secrets');
const actions = require('../src/services/actions');

const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const WRITE = 'EAAwritekeywritekeywritekey9999';
const realFetch = global.fetch;
const sent = []; // усі виклики до Meta
let state = {}; // що «зберігає» підроблена Meta: id → {status, daily_budget}
let failWrite = false; let breakReadBack = false;
let project; let conn; let ad1; let ad2; let setA; let setB;

test.before(async () => {
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (u.hostname !== 'graph.facebook.com') return realFetch(url, opts);
    const id = u.pathname.split('/').pop();
    const method = (opts.method || 'GET').toUpperCase();
    sent.push({ method, url: String(url), auth: opts.headers?.Authorization, body: opts.body ? String(opts.body) : '' });
    const json = (code, data) => new Response(JSON.stringify(data), { status: code, headers: { 'Content-Type': 'application/json' } });
    if (method === 'POST') {
      if (failWrite) return json(400, { error: { message: 'Некоректний параметр', code: 100 } });
      const p = new URLSearchParams(String(opts.body)); state[id] = { ...(state[id] || {}), ...(p.get('status') ? { status: p.get('status') } : {}), ...(p.get('daily_budget') ? { daily_budget: p.get('daily_budget') } : {}) };
      return json(200, { success: true });
    }
    if (breakReadBack) return json(200, { status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '1000' });
    return json(200, { status: (state[id] || {}).status || 'ACTIVE', effective_status: (state[id] || {}).status || 'ACTIVE', daily_budget: (state[id] || {}).daily_budget || '1000' });
  };
  await db.project.deleteMany({ where: { slug: 'selftest3' } });
  project = await db.project.create({ data: { name: 'Самоперевірка 3', slug: 'selftest3', apiKey: `ads_selftest3_${Date.now()}`, usdRate: 40, targetSaleCost: 1500, dryRun: true, autonomyLevel: 0 } });
  conn = await db.connection.create({ data: { projectId: project.id, channel: 'meta', name: 'Тест', externalId: '333', status: 'ok', secretRead: encrypt('read'), secretWrite: encrypt(WRITE) } });
  const camp = await db.campaign.create({ data: { projectId: project.id, connectionId: conn.id, channel: 'meta', externalId: '900001', name: 'К', effectiveStatus: 'ACTIVE' } });
  const old = new Date(Date.now() - 20 * 86400000);
  setA = await db.adSet.create({ data: { projectId: project.id, campaignId: camp.id, channel: 'meta', externalId: '910001', name: 'Група A', dailyBudget: 10, learningStage: 'SUCCESS', extUpdatedAt: old } });
  setB = await db.adSet.create({ data: { projectId: project.id, campaignId: camp.id, channel: 'meta', externalId: '910002', name: 'Група B (навчається)', dailyBudget: 10, learningStage: 'LEARNING', extUpdatedAt: old } });
  const mk = (adSet, ext, name) => db.ad.create({ data: { projectId: project.id, campaignId: camp.id, adSetId: adSet.id, channel: 'meta', externalId: ext, name, status: 'ACTIVE', effectiveStatus: 'ACTIVE' } });
  ad1 = await mk(setA, '920001', 'Оголошення 1'); ad2 = await mk(setB, '920002', 'Оголошення 2');
  // Група A окупається: 2 продажі на ~800 грн витрат (400 за продаж при цілі 1500). Витрати сьогодні малі (ліміт 400 грн).
  await db.insightDaily.create({ data: { adId: ad1.id, date: new Date(today.getTime() - 3 * 86400000), spend: 20, currency: 'USD' } });
  await db.insightDaily.create({ data: { adId: ad1.id, date: today, spend: 1, currency: 'USD' } });
  for (let i = 0; i < 2; i += 1) await db.stepEvent.create({ data: { projectId: project.id, elementType: 'site', elementRef: 'x', sourceId: `a${i}`, stepKey: 'pay_success', ts: new Date(Date.now() - 86400000), adExtId: '920001', amount: 1500, currency: 'UAH' } });
});

test.after(async () => { global.fetch = realFetch; await db.project.deleteMany({ where: { slug: 'selftest3' } }); await db.$disconnect(); });

const reload = async () => { project = await db.project.findUnique({ where: { id: project.id } }); };
const writes = () => sent.filter((s) => s.method === 'POST');
const journal = (status) => db.actionLog.count({ where: { projectId: project.id, status } });

test('режим «проба» (16): нічого не змінюється, дія лише в журналі', async () => {
  sent.length = 0;
  const r = await actions.perform(project, { kind: 'pause_ad', adId: ad1.id }, { actor: 'user:1' });
  assert.strictEqual(r.status, 'dry_run');
  assert.strictEqual(writes().length, 0, 'у Meta не писали');
  assert.strictEqual((await db.ad.findUnique({ where: { id: ad1.id } })).status, 'ACTIVE');
  assert.strictEqual(await journal('dry_run'), 1);
});

test('автоматика без людини (15): рівень 0 не дозволяє навіть вимкнення', async () => {
  const r = await actions.perform(project, { kind: 'pause_ad', adId: ad1.id }, { actor: 'rule:waste' });
  assert.strictEqual(r.status, 'blocked');
  assert.ok(r.reasons.join(' ').includes('(15)'));
});

test('вимкнення з підтвердженням: ключ у заголовку, перечитування (17), локальні дані оновились', async () => {
  await db.project.update({ where: { id: project.id }, data: { dryRun: false } }); await reload();
  sent.length = 0;
  const r = await actions.perform(project, { kind: 'pause_ad', adId: ad1.id, reason: 'зливає' }, { actor: 'user:1' });
  assert.strictEqual(r.status, 'done', JSON.stringify(r));
  const w = writes()[0];
  assert.ok(w.url.endsWith('/920001') && w.body === 'status=PAUSED');
  assert.strictEqual(w.auth, `Bearer ${WRITE}`);
  assert.ok(!w.url.includes('EAA') && !w.body.includes('EAA'), 'ключа нема ні в адресі, ні в тілі');
  assert.ok(sent.some((s) => s.method === 'GET'), 'після зміни перечитали стан із кабінету');
  assert.strictEqual((await db.ad.findUnique({ where: { id: ad1.id } })).status, 'PAUSED');
  const log = await db.actionLog.findFirst({ where: { projectId: project.id, status: 'done' } });
  assert.deepStrictEqual([log.before.status, log.after.status, log.after.confirmedInAccount], ['ACTIVE', 'PAUSED', true]);
  assert.ok(!JSON.stringify(log).includes('EAA'), 'ключа нема в журналі');
});

test('бюджет (7): більше ніж на 20% не можна; +10% дозволено, мінорні одиниці правильні', async () => {
  const big = await actions.check(project, { kind: 'set_adset_budget', adSetId: setA.id, dailyBudget: 15 }, { actor: 'user:1' });
  assert.ok(!big.ok && big.reasons.join(' ').includes('(7)'));
  sent.length = 0;
  const ok = await actions.perform(project, { kind: 'set_adset_budget', adSetId: setA.id, dailyBudget: 11 }, { actor: 'user:1' });
  assert.strictEqual(ok.status, 'done', JSON.stringify(ok));
  assert.strictEqual(writes()[0].body, 'daily_budget=1100', '11 одиниць = 1100 найменших');
  assert.strictEqual(Number((await db.adSet.findUnique({ where: { id: setA.id } })).dailyBudget), 11);
});

test('бюджет (7): повторна зміна тієї ж групи протягом 3 днів заблокована', async () => {
  const r = await actions.check(project, { kind: 'set_adset_budget', adSetId: setA.id, dailyBudget: 11.5 }, { actor: 'user:1' });
  assert.ok(!r.ok && r.reasons.join(' ').includes('раз на 3 дні'));
});

test('бюджет (8): група в навчанні не чіпається; підняття без продажів (9) заблоковане', async () => {
  const r = await actions.check(project, { kind: 'set_adset_budget', adSetId: setB.id, dailyBudget: 11 }, { actor: 'user:1' });
  assert.ok(!r.ok);
  const text = r.reasons.join(' ');
  assert.ok(text.includes('(8)') && text.includes('(9)'));
});

test('вимкнення дозволене навіть для групи в навчанні (аварійне, 8)', async () => {
  const r = await actions.check(project, { kind: 'pause_ad', adId: ad2.id }, { actor: 'user:1' });
  assert.ok(r.ok, JSON.stringify(r.reasons));
});

test('увімкнення (10): при вичерпаному денному ліміті заблоковане', async () => {
  await db.insightDaily.update({ where: { adId_date: { adId: ad1.id, date: today } }, data: { spend: 20 } }); // 800 грн > ліміт 400
  const r = await actions.check(project, { kind: 'resume_ad', adId: ad1.id }, { actor: 'user:1' });
  assert.ok(!r.ok && r.reasons.join(' ').includes('(10)'));
  await db.insightDaily.update({ where: { adId_date: { adId: ad1.id, date: today } }, data: { spend: 1 } });
});

test('перевірка після зміни (17): якщо кабінет не підтвердив — це провал, а не успіх', async () => {
  // Підроблена Meta при читанні завжди каже ACTIVE (зміну «не застосувала»), а ми просимо PAUSED.
  breakReadBack = true;
  const p = await actions.perform(project, { kind: 'pause_ad', adId: ad2.id }, { actor: 'user:1' });
  breakReadBack = false;
  assert.strictEqual(p.status, 'failed', 'кабінет каже ACTIVE, ми просили PAUSED');
  assert.strictEqual((await db.ad.findUnique({ where: { id: ad2.id } })).status, 'ACTIVE', 'локальні дані не оновлено без підтвердження');
});

test('відмова Meta (14): без повторів, чесне повідомлення, запис у журнал', async () => {
  failWrite = true; sent.length = 0;
  const r = await actions.perform(project, { kind: 'pause_ad', adId: ad2.id }, { actor: 'user:1' });
  failWrite = false;
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(writes().length, 1, 'один запит, без циклу повторів');
  assert.ok(await db.actionLog.count({ where: { projectId: project.id, kind: 'meta_error' } }) >= 1);
});

test('кабінет обмежено (13) або нема ключа керування: усе заблоковано', async () => {
  await db.connection.update({ where: { id: conn.id }, data: { status: 'blocked' } });
  const a = await actions.check(project, { kind: 'pause_ad', adId: ad2.id }, { actor: 'user:1' });
  assert.ok(!a.ok && a.reasons.join(' ').includes('(13)'));
  await db.connection.update({ where: { id: conn.id }, data: { status: 'ok', secretWrite: null } });
  const b = await actions.check(project, { kind: 'pause_ad', adId: ad2.id }, { actor: 'user:1' });
  assert.ok(!b.ok && b.reasons.join(' ').includes('ключ керування'));
});

test('маршрут: без confirm нічого не виконується; ключ воронки дії виконувати не може', async () => {
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.project = project; req.actor = 'user:1'; next(); });
  app.use('/api', require('../src/routes/actions'));
  app.use(require('../src/middleware/errorHandler'));
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
  try {
    const post = (body) => realFetch(`http://127.0.0.1:${srv.address().port}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
    sent.length = 0;
    assert.strictEqual(await post({ kind: 'pause_ad', adId: ad2.id }), 400, 'без confirm — відмова');
    assert.strictEqual(await post({ kind: 'drop_table', adId: 'x' }), 400, 'невідома дія — відмова');
    assert.strictEqual(writes().length, 0);
  } finally { await new Promise((r) => srv.close(r)); }
  const { keyAllowed, isAllowed } = require('../src/lib/pageAccess');
  assert.ok(!keyAllowed('POST', '/actions') && !keyAllowed('POST', '/actions/check'), 'ключ проєкту (воронка) не може міняти рекламу');
  assert.ok(!isAllowed({ role: 'user', pageIds: ['ads'] }, 'POST', '/actions'), 'потрібне право «approve»');
  assert.ok(isAllowed({ role: 'user', pageIds: ['approve'] }, 'POST', '/actions'));
});
