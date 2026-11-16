// ЛИШЕ для локальної розробки: проєкт «Демо (вигадані дані)» — оголошення, витрати, кроки лендінгу з розгалуженням
// (у бота або оплата на сайті) і продажі. На сервері не запускати. Повторний запуск перестворює демо.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { db } = require('@ads/db');

if (process.env.NODE_ENV === 'production') { console.error('Демо-дані на проді заборонені'); process.exit(1); }

const day = (back) => new Date(`${new Date(Date.now() - back * 86400000).toISOString().slice(0, 10)}T00:00:00Z`);
const pic = (bg, l1, l2) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"><rect width="600" height="750" fill="${bg}"/><rect x="40" y="40" width="300" height="56" rx="10" fill="#0b1220"/><text x="60" y="78" font-family="Arial" font-size="26" fill="#fff">Власникам бізнесу</text><text x="40" y="330" font-family="Arial" font-size="58" font-weight="700" fill="#fff">${l1}</text><text x="40" y="410" font-family="Arial" font-size="58" font-weight="700" fill="#fff">${l2}</text><rect x="40" y="640" width="520" height="70" rx="12" fill="#fff"/><text x="60" y="686" font-family="Arial" font-size="28" fill="#0b1220">1 зустріч → план автоматизації</text></svg>`)}`;

(async () => {
  await db.project.deleteMany({ where: { slug: 'demo' } });
  const p = await db.project.create({ data: { name: 'Демо (вигадані дані)', slug: 'demo', apiKey: `ads_demo_${Date.now()}`, usdRate: 42, targetSaleCost: 1500 } });
  const conn = await db.connection.create({ data: { projectId: p.id, channel: 'meta', name: 'Демо-кабінет', externalId: '000000', status: 'ok', lastSyncAt: new Date(), config: { check: { accountName: 'Демо', currency: 'USD', timezone: 'Europe/Kiev', accountStatusText: 'активний', healthy: true } } } });

  const el = await db.element.create({ data: { projectId: p.id, type: 'site', ref: 'auto-lp', name: 'Розбір процесу — лендінг', config: { domain: 'auto-lp.fineko.space' } } });
  const steps = [['view', 'Відкрив сторінку', 1, null, false, null], ['cta_click', 'Натиснув кнопку', 2, null, false, null], ['tg_click', 'Перейшов у Telegram', 3, 'telegram', false, 'flows:bot-karta-sales'], ['pay_start', 'Почав оплату', 3, 'pay', false, null], ['pay_success', 'Оплатив на сайті', 4, 'pay', true, null]];
  for (const [key, title, order, branch, isSale, leadsTo] of steps) await db.step.create({ data: { elementId: el.id, key, title, order, branch, isSale, leadsTo } });

  // Кампанії: [зовнішній id, назва, група, оголошення: id, назва, текст, стан, колір, 2 рядки на картинці, витрати $/день, покази, переходи, воронка: зайшли/кнопка/telegram/почали оплату/оплатили]
  const camps = [
    ['c1', 'Консультація · лендінг → бот або оплата', 's1', 'Власники бізнесу, Україна', [
      ['a1', 'Біль: рутина з\'їдає години', 'Одна людина робить усе вручну? За одну зустріч покажу, що автоматизувати першим.', 'ACTIVE', '#4c1d95', 'Рутина з\'їдає', '3 години на день?', 3.2, 800, 26, [150, 58, 31, 9, 4]],
      ['a2', 'Біль: ШІ, з чого почати', 'Не знаєте, з чого почати з ШІ у своєму бізнесі? Розбір процесу за 1 500 грн.', 'ACTIVE', '#0c4a6e', 'ШІ у бізнесі:', 'з чого почати?', 3.4, 950, 14, [84, 22, 12, 3, 1]],
      ['a3', 'Кейс: 20 хв → 30 с', 'Як заявка, що займала 20 хвилин, стала займати 30 секунд.', 'PAUSED', '#7c2d12', 'Заявка: 20 хв', 'стало 30 с', 14, 3100, 41, [240, 31, 8, 2, 0]],
    ]],
    ['c2', 'Консультація · тест нового болю', 's2', 'Керівники відділів продажу', [
      ['a4', 'Біль: менеджери забувають клієнтів', 'Заявки губляться між месенджерами? Покажу, як зібрати все в одне місце.', 'ACTIVE', '#14532d', 'Заявки губляться', 'між чатами?', 1.6, 420, 9, [47, 15, 6, 1, 0]],
    ]],
  ];
  let n = 0;
  for (const [cext, cname, sext, sname, ads] of camps) {
    const camp = await db.campaign.create({ data: { projectId: p.id, connectionId: conn.id, channel: 'meta', externalId: cext, name: cname, status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudget: 10 } });
    const set = await db.adSet.create({ data: { projectId: p.id, campaignId: camp.id, channel: 'meta', externalId: sext, name: sname, status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudget: 10, learningStage: cext === 'c2' ? 'LEARNING' : 'SUCCESS' } });
    for (const [ext, name, body, st, bg, l1, l2, spend, imp, clicks, funnel] of ads) {
      const ad = await db.ad.create({ data: { projectId: p.id, campaignId: camp.id, adSetId: set.id, channel: 'meta', externalId: ext, name, body, status: st, effectiveStatus: st, imageUrl: pic(bg, l1, l2), linkUrl: 'https://auto-lp.fineko.space/', extCreatedAt: day(8) } });
      for (let d = 0; d < 7; d += 1) await db.insightDaily.create({ data: { adId: ad.id, date: day(d), spend, currency: 'USD', impressions: imp, reach: Math.round(imp * 0.8), clicks: clicks + 4, linkClicks: clicks } });
      const keys = ['view', 'cta_click', 'tg_click', 'pay_start', 'pay_success'];
      const rows = [];
      funnel.forEach((count, i) => { for (let k = 0; k < count; k += 1) { n += 1; rows.push({ projectId: p.id, elementType: 'site', elementRef: 'auto-lp', sourceId: `e${n}`, stepKey: keys[i], ts: new Date(Date.now() - ((k % 6) * 86400000) - 3600000), personKey: `${ext}-${i < 3 ? k : `p${k}`}`, clickId: null, adExtId: ext, amount: keys[i] === 'pay_success' ? 1500 : null, currency: keys[i] === 'pay_success' ? 'UAH' : null }); } });
      await db.stepEvent.createMany({ data: rows });
    }
  }
  // Люди без номера оголошення (прийшли не з реклами або посилання без параметрів).
  const unknown = [];
  [['view', 38], ['cta_click', 9], ['tg_click', 5]].forEach(([key, count]) => { for (let k = 0; k < count; k += 1) { n += 1; unknown.push({ projectId: p.id, elementType: 'site', elementRef: 'auto-lp', sourceId: `e${n}`, stepKey: key, ts: new Date(Date.now() - 7200000), personKey: `u-${k}` }); } });
  await db.stepEvent.createMany({ data: unknown });
  console.log('Демо-проєкт створено:', p.name, '· подій:', n);
  await db.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
