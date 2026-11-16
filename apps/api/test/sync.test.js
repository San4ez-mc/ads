// Перевірка наскрізь на локальній базі: підроблена відповідь Meta і підроблений АПІ сайтів → синхронізація → цифри в /api/ads і /api/overview.
// Запуск: npm test (потрібна локальна база з .env). Справжня Meta не викликається.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { db } = require('@ads/db');
const { encrypt, decrypt, mask, scrub } = require('../src/lib/secrets');
const { keyAllowed, isAllowed } = require('../src/lib/pageAccess');

const today = new Date().toISOString().slice(0, 10);
const TOKEN = 'EAAtesttokentesttokentesttoken1234';
const realFetch = global.fetch;
const seen = [];

const META = {
  'act_111': { name: 'Тестовий кабінет', account_status: 1, currency: 'USD', timezone_name: 'Europe/Kiev', spend_cap: '0' },
  'debug_token': { data: { scopes: ['ads_read'], type: 'SYSTEM_USER', expires_at: 0 } },
  'act_111/campaigns': { data: [{ id: 'c1', name: 'Консультація — тест болю', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS', daily_budget: '1000', created_time: '2026-11-10T10:00:00+0200' }] },
  'act_111/adsets': { data: [{ id: 's1', campaign_id: 'c1', name: 'Власники бізнесу', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '500', optimization_goal: 'LEAD_GENERATION', learning_stage_info: { status: 'LEARNING' }, targeting: { geo_locations: { countries: ['UA'] } } }] },
  'act_111/ads': { data: [
    { id: 'a1', campaign_id: 'c1', adset_id: 's1', name: 'Біль: рутина', status: 'ACTIVE', effective_status: 'ACTIVE', creative: { id: 'cr1', body: 'Одна людина робить усе вручну?', image_url: 'https://scontent.fbcdn.net/a1.jpg', object_story_spec: { link_data: { link: 'https://auto-lp.fineko.space/', call_to_action: { type: 'LEARN_MORE' } } } } },
    { id: 'a2', campaign_id: 'c1', adset_id: 's1', name: 'Біль: ШІ з чого почати', status: 'PAUSED', effective_status: 'PAUSED', creative: { id: 'cr2', body: 'Не знаєте, з чого почати з ШІ?' } },
  ] },
  'act_111/insights': { data: [
    { ad_id: 'a1', date_start: today, spend: '10.00', account_currency: 'USD', impressions: '2000', reach: '1500', clicks: '60', inline_link_clicks: '40', frequency: '1.33', actions: [{ action_type: 'lead', value: '3' }] },
    { ad_id: 'a2', date_start: today, spend: '4.00', account_currency: 'USD', impressions: '900', reach: '800', clicks: '10', inline_link_clicks: '8' },
    { ad_id: 'ghost', date_start: today, spend: '1.00', account_currency: 'USD', impressions: '1', reach: '1', clicks: '0', inline_link_clicks: '0' },
  ] },
};

let siteUrl; let siteServer; let app; let appServer; let base; let project;

test.before(async () => {
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (u.hostname !== 'graph.facebook.com') return realFetch(url, opts);
    seen.push({ url: u.toString(), auth: opts.headers?.Authorization });
    const key = u.pathname.replace(/^\/v[\d.]+\//, '');
    const body = META[key];
    return new Response(JSON.stringify(body || { error: { message: `no fixture ${key}`, code: 100 } }), { status: body ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
  };
  siteServer = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== 'Bearer site-key') return send(401, { ok: false, error: { code: 'auth', message: 'bad key' } });
    if (u.pathname === '/ping') return send(200, { ok: true, data: { service: 'fineko-sites', version: '1' } });
    if (u.pathname === '/sites') return send(200, { ok: true, data: { sites: [{ id: 'auto-lp', domain: 'auto-lp.fineko.space', name: 'Розбір процесу', steps: [{ key: 'view', title: 'Відкрив', order: 1 }, { key: 'tg_click', title: 'У Telegram', order: 2, branch: 'telegram', leads_to: 'flows:bot-karta-sales' }, { key: 'pay_success', title: 'Оплатив', order: 3, branch: 'pay', is_sale: true }] }] } });
    if (u.pathname === '/events') {
      const after = Number(u.searchParams.get('after_id'));
      const src = { ad_id: 'a1', adset_id: 's1', campaign_id: 'c1', utm_source: 'meta' };
      const all = [
        { id: 1, ts: `${today}T08:00:00Z`, site: 'auto-lp', step: 'view', visitor_id: 'v1', click_id: 'AAAAAAAAA1', is_test: false, source: src },
        { id: 2, ts: `${today}T08:05:00Z`, site: 'auto-lp', step: 'pay_success', visitor_id: 'v1', click_id: 'AAAAAAAAA1', is_test: false, source: src, amount: 1500, currency: 'UAH', order_id: 'o1' },
        { id: 3, ts: `${today}T09:00:00Z`, site: 'auto-lp', step: 'pay_success', visitor_id: 'v9', click_id: 'AAAAAAAAA9', is_test: true, source: src, amount: 1500, currency: 'UAH', order_id: 'o2' },
      ].filter((e) => e.id > after);
      return send(200, { ok: true, data: { events: all, last_id: all.length ? all[all.length - 1].id : after, has_more: false } });
    }
    send(404, { ok: false, error: { code: 'not_found', message: 'no' } });
  });
  await new Promise((r) => siteServer.listen(0, '127.0.0.1', r));
  siteUrl = `http://127.0.0.1:${siteServer.address().port}`;

  await db.project.deleteMany({ where: { slug: 'selftest' } });
  project = await db.project.create({ data: { name: 'Самоперевірка', slug: 'selftest', apiKey: `ads_selftest_${Date.now()}`, usdRate: 40, targetSaleCost: 1500 } });
  await db.connection.create({ data: { projectId: project.id, channel: 'meta', name: 'Тест', externalId: '111', secretRead: encrypt(TOKEN) } });
  await db.connection.create({ data: { projectId: project.id, channel: 'site', name: 'Сайти', externalId: siteUrl, secretRead: encrypt('site-key') } });

  app = require('../src/index');
  appServer = app.listen(0, '127.0.0.1');
  await new Promise((r) => appServer.once('listening', r));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

test.after(async () => {
  global.fetch = realFetch;
  await db.project.deleteMany({ where: { slug: 'selftest' } });
  await new Promise((r) => appServer.close(r)); await new Promise((r) => siteServer.close(r));
  await db.$disconnect();
});

const call = (method, p, body, key = project.apiKey) => realFetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));

test('ключі шифруються, маскуються і вичищаються з текстів помилок', () => {
  const enc = encrypt(TOKEN);
  assert.ok(!enc.includes(TOKEN));
  assert.strictEqual(decrypt(enc), TOKEN);
  assert.strictEqual(mask(enc), '…1234');
  assert.ok(!scrub(`bad url ?access_token=${TOKEN}&x=1 and ${TOKEN}`).includes('testtoken'));
});

test('ключ проєкту дає лише читання і запуск синхронізації', async () => {
  assert.ok(keyAllowed('POST', '/sync/run') && keyAllowed('GET', '/ads'));
  assert.ok(!keyAllowed('GET', '/connections') && !keyAllowed('PATCH', '/project') && !keyAllowed('POST', '/connections'));
  assert.ok(!isAllowed({ role: 'user', pageIds: ['ads'] }, 'GET', '/connections'));
  assert.strictEqual((await call('GET', '/api/connections')).status, 403);
  assert.strictEqual((await call('PATCH', '/api/project', { dailyLimitUsd: 999 })).status, 403);
  assert.strictEqual((await call('GET', '/api/ads', null, 'wrong-key')).status, 401);
  assert.strictEqual((await call('GET', '/api/ads', null, null)).status, 401);
  const p = await call('GET', '/api/project');
  assert.strictEqual(p.status, 200);
  assert.strictEqual(p.json.data.apiKey, undefined, 'ключ проєкту не віддається воронці назад');
  assert.strictEqual(p.json.data.dailyLimitUsd, 10, 'ліміт за замовчуванням 10 доларів');
  assert.strictEqual(p.json.data.dryRun, true, 'новий проєкт у режимі «проба»');
});

test('синхронізація читає кабінет і сайт, нічого не пише в Meta', async () => {
  const r = await call('POST', '/api/sync/run', { days: 3 });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.data.ok, JSON.stringify(r.json.data));
  const kinds = Object.fromEntries(r.json.data.results.map((x) => [x.kind, x.stats]));
  assert.deepStrictEqual({ c: kinds.meta_structure.campaigns, s: kinds.meta_structure.adSets, a: kinds.meta_structure.ads }, { c: 1, s: 1, a: 2 });
  assert.strictEqual(kinds.meta_insights.saved, 2);
  assert.strictEqual(kinds.meta_insights.unknownAds, 1);
  assert.strictEqual(kinds.site_events.events, 3);
  assert.ok(seen.length > 0 && seen.every((s) => s.auth === `Bearer ${TOKEN}`), 'ключ іде в заголовку');
  assert.ok(seen.every((s) => !s.url.includes(TOKEN)), 'ключа нема в адресі запиту');
});

test('повторна синхронізація не подвоює дані', async () => {
  await call('POST', '/api/sync/run', { days: 3 });
  assert.strictEqual(await db.ad.count({ where: { projectId: project.id } }), 2);
  assert.strictEqual(await db.stepEvent.count({ where: { projectId: project.id } }), 3);
  assert.strictEqual(await db.insightDaily.count({ where: { ad: { projectId: project.id } } }), 2);
  assert.strictEqual(await db.click.count({ where: { projectId: project.id } }), 1);
});

test('ціна продажу рахується з витрат і продажів сайту, тестові продажі не враховуються', async () => {
  const r = await call('GET', `/api/ads?from=${today}&to=${today}`);
  const a1 = r.json.data.ads.find((a) => a.externalId === 'a1'); const a2 = r.json.data.ads.find((a) => a.externalId === 'a2');
  assert.strictEqual(a1.spend, 400, '10 доларів × курс 40');
  assert.strictEqual(a1.sales, 1);
  assert.strictEqual(a1.revenue, 1500);
  assert.strictEqual(a1.saleCost, 400);
  assert.strictEqual(a1.cpc, 10);
  assert.strictEqual(a1.adSet.learningStage, 'LEARNING');
  assert.strictEqual(a1.creative.linkUrl, 'https://auto-lp.fineko.space/');
  assert.strictEqual(a2.sales, 0);
  assert.strictEqual(a2.saleCost, null);
  assert.ok(a2.spend > 0, 'вимкнене оголошення з витратами лишається у списку');
  const o = (await call('GET', `/api/overview?from=${today}&to=${today}`)).json.data;
  assert.strictEqual(o.totals.spend, 560);
  assert.strictEqual(o.totals.sales, 1);
  assert.strictEqual(o.totals.saleCost, 560);
  assert.strictEqual(o.today.limit, 400);
  assert.strictEqual(o.today.overLimit, true, '560 грн > ліміту 400 грн');
  assert.strictEqual(o.counts.running, 1);
});

test('кроки сайту стали елементом шляху з розгалуженням', async () => {
  const el = await db.element.findFirst({ where: { projectId: project.id, type: 'site', ref: 'auto-lp' }, include: { steps: { orderBy: { order: 'asc' } } } });
  assert.strictEqual(el.steps.length, 3);
  assert.strictEqual(el.steps.find((s) => s.key === 'tg_click').leadsTo, 'flows:bot-karta-sales');
  assert.strictEqual(el.steps.find((s) => s.key === 'pay_success').isSale, true);
});

test('зламаний ключ дає зрозумілу помилку і не валить решту', async () => {
  const conn = await db.connection.findFirst({ where: { projectId: project.id, channel: 'site' } });
  await db.connection.update({ where: { id: conn.id }, data: { secretRead: encrypt('wrong-zz9') } });
  const r = await call('POST', '/api/sync/run', {});
  assert.strictEqual(r.json.data.ok, false);
  const siteRes = r.json.data.results.find((x) => x.kind === 'site_events');
  assert.strictEqual(siteRes.ok, false);
  assert.ok(r.json.data.results.find((x) => x.kind === 'meta_insights').ok, 'кабінет при цьому оновився');
  const after = await db.connection.findUnique({ where: { id: conn.id } });
  assert.strictEqual(after.status, 'error');
  assert.ok(after.lastError && !after.lastError.includes('wrong-zz9'));
});

test('стан оголошення за ціною продажу', () => {
  const { verdict } = require('../src/lib/verdict');
  assert.strictEqual(verdict({ spend: 1000, sales: 1, target: 1500 }), 'good');
  assert.strictEqual(verdict({ spend: 2000, sales: 1, target: 1500 }), 'pricey');
  assert.strictEqual(verdict({ spend: 4000, sales: 1, target: 1500 }), 'bad');
  assert.strictEqual(verdict({ spend: 2999, sales: 0, target: 1500 }), 'few', 'без продажу до двох цільових цін — ще мало даних');
  assert.strictEqual(verdict({ spend: 3000, sales: 0, target: 1500 }), 'bad');
  assert.strictEqual(verdict({ spend: 500, sales: 0, target: null }), 'none');
});

test('карта: креативи, кроки з людьми по оголошеннях, вхід у шлях', async () => {
  const conn = await db.connection.findFirst({ where: { projectId: project.id, channel: 'site' } });
  await db.connection.update({ where: { id: conn.id }, data: { secretRead: encrypt('site-key') } });
  const r = await call('GET', `/api/map?from=${today}&to=${today}`);
  assert.strictEqual(r.status, 200);
  const m = r.json.data;
  assert.strictEqual(m.campaigns.length, 1);
  const ads = m.campaigns[0].adSets[0].ads;
  const a1 = ads.find((a) => a.externalId === 'a1'); const a2 = ads.find((a) => a.externalId === 'a2');
  assert.strictEqual(a1.entry, 'site:auto-lp', 'вхід визначено за подіями оголошення');
  assert.strictEqual(a1.verdict, 'good');
  assert.strictEqual(a2.entry, null, 'оголошення без подій і без посилання — шлях не визначено');
  assert.strictEqual(a2.verdict, 'few');
  const el = m.elements.find((e) => e.key === 'site:auto-lp');
  const view = el.steps.find((s) => s.key === 'view'); const pay = el.steps.find((s) => s.key === 'pay_success');
  assert.strictEqual(view.total, 1);
  assert.strictEqual(view.byAd.a1, 1);
  assert.strictEqual(pay.total, 1, 'тестова оплата не рахується');
  assert.strictEqual(pay.amountByAd.a1, 1500);
  assert.strictEqual(el.steps.find((s) => s.key === 'tg_click').leadsTo, 'flows:bot-karta-sales');
});
