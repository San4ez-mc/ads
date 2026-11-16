// Проєкт FINEKO: консультації з автоматизації. Заводить аудиторії, елементи шляху і зв'язки (а–г від власника + пропозиції).
// Повторний запуск безпечний: наявне не перезаписує, лише додає відсутнє. Запуск: node scripts/seed-fineko.js
// Нічого не запускає в рекламі: усі зв'язки створюються чернетками.
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { db } = require('@ads/db');

const PRICE = 1500;

const AUDIENCES = [
  ['owner-routine', 'Власник малого бізнесу: тоне в ручній роботі', 'Сам або з 2–15 людьми. Заявки, рахунки, звіти, відповіді клієнтам роблять руками. Болить: нема часу на розвиток, усе тримається на одній людині. Хоче: щоб рутина робилась сама, але не знає, з чого почати і скільки це коштує.'],
  ['owner-ai', 'Власник бізнесу: хоче ШІ, не знає з чого почати', 'Бачить, що всі говорять про ШІ, пробував ChatGPT, у бізнес не впровадив. Боїться злити гроші на «іграшку». Хоче: конкретний перший крок із зрозумілою вигодою.'],
  ['sales-head', 'Керівник продажів: заявки губляться', 'Заявки приходять із кількох месенджерів і соцмереж, менеджери забувають відповісти чи передзвонити. Болить: втрачені клієнти і нема контролю. Хоче: усе в одному місці й автоматичні нагадування.'],
];

// [тип, код, назва, налаштування, кроки: ключ, назва, порядок, гілка, продаж?, веде до, сума]
const ELEMENTS = [
  ['site', 'auto-lp', 'Лендінг «Розбір процесу»', { domain: 'auto-lp.fineko.space' }, [
    ['view', 'Відкрив сторінку', 1, null, false, null, null], ['cta_click', 'Натиснув кнопку', 2, null, false, null, null],
    ['tg_click', 'Перейшов у Telegram', 3, 'telegram', false, 'flows:bot-karta-sales', null],
    ['pay_start', 'Почав оплату на сайті', 3, 'pay', false, null, null], ['pay_success', 'Оплатив на сайті', 4, 'pay', true, 'calendar:matsuk', PRICE],
  ]],
  ['flows', 'bot-karta-sales', 'Ден — Карта автоматизації + Продаж', {}, [
    ['Відкрив бота', 'Відкрив бота', 1, null, false, null, null], ['Діалог завершено', 'Діалог завершено', 2, null, false, null, null],
    ['Побачив пропозицію консультації', 'Побачив пропозицію консультації', 3, null, false, null, null], ['Отримав посилання на оплату', 'Отримав посилання на оплату', 4, null, false, null, null],
    ['Оплатив', 'Оплатив', 5, null, true, null, PRICE], ['Обрав час консультації', 'Обрав час консультації', 6, null, false, 'manual:consult', null],
    ['Заперечення', 'Заперечення', 10, 'side', false, null, null], ['Не переконали після заперечення', 'Не переконали після заперечення', 11, 'side', false, null, null],
    ['Не актуально', 'Не актуально', 12, 'side', false, null, null], ['Мовчав 24 год', 'Мовчав 24 год', 14, 'side', false, null, null],
  ]],
  ['calendar', 'matsuk', 'Запис у календар', {}, [['booking', 'Записався на час', 1, null, false, 'manual:consult', null]]],
  ['instagram', 'direct', 'Повідомлення в Instagram (вручну)', {}, [
    ['wrote', 'Написав у дірект', 1, null, false, null, null], ['answered', 'Отримав відповідь', 2, null, false, null, null],
    ['offer', 'Отримав пропозицію консультації', 3, null, false, null, null], ['paid', 'Оплатив', 4, null, true, 'manual:consult', PRICE],
  ]],
  ['manual', 'consult', 'Консультація і продаж далі (позначаєте вручну)', {}, [
    ['done', 'Консультація відбулась', 1, null, false, null, null], ['upsell', 'Купив дорожчий продукт', 2, null, true, null, null],
  ]],
];

const STOP = 'Стоп, якщо витрачено бюджет тесту і нема жодної оплати, або 40 заходів не дали жодної заявки';
// [код, назва, аудиторія, що перевіряємо, обіцянка, кут, шлях]
const BUNDLES = [
  ['A1', 'Лендінг → бот або оплата одразу', 'owner-routine', 'Власник, що тоне в рутині, з лендінгу або одразу платить, або йде в бота і купує там. Дивимось, яка гілка дає дешевший продаж.', '1 зустріч → план, що автоматизувати першим', 'Одна людина робить усе вручну; рутина з\'їдає години',
    [['site:auto-lp', 'Реклама → лендінг: заявка в бота або оплата одразу'], ['flows:bot-karta-sales', 'Бот Ден: карта автоматизації, потім продаж консультації'], ['manual:consult', 'Консультація і продаж далі']]],
  ['B1', 'Реклама одразу на бота з картою автоматизацій', 'owner-routine', 'Без лендінгу заявка дешевша: людина одразу отримує карту автоматизацій, а бот продає консультацію.', 'Безкоштовна карта: що у вашому бізнесі автоматизувати', 'Отримайте карту автоматизацій за 5 хвилин',
    [['flows:bot-karta-sales', 'Реклама → одразу бот: карта, потім продаж консультації'], ['manual:consult', 'Консультація і продаж далі']]],
  ['C1', 'Лендінг → запис на коротку безкоштовну консультацію', 'owner-ai', 'Безкоштовна коротка розмова дає більше заявок; частина з них купує платний розбір або дорожчий продукт.', '20 хвилин: покажу перший крок до ШІ у вашому бізнесі', 'ШІ у бізнесі: з чого почати',
    [[null, 'Реклама → лендінг із записом (лендінг ще треба зробити)'], ['calendar:matsuk', 'Запис на час'], ['manual:consult', 'Розмова і продаж далі']]],
  ['D1', 'Реклама на повідомлення в Instagram (вручну)', 'sales-head', 'Людям простіше написати в дірект, ніж іти на сайт. Поки відповідаєте самі; якщо піде — ставимо бота.', 'Напишіть «заявки» — розкажу, як перестати їх губити', 'Заявки губляться між месенджерами',
    [['instagram:direct', 'Реклама → дірект, відповідаєте вручну'], ['manual:consult', 'Консультація і продаж далі']]],
  ['R1', 'Повернення тих, хто взяв карту і не купив', 'owner-routine', 'Люди, які вже були в боті чи на лендінгу, купують дешевше за нових. Потребує лічильника Meta на лендінгу.', 'Ви вже отримали карту — зробімо перший крок разом', 'Нагадування з кейсом і конкретним результатом',
    [['site:auto-lp', 'Реклама лише на тих, хто вже був → лендінг'], ['flows:bot-karta-sales', 'Бот'], ['manual:consult', 'Консультація і продаж далі']]],
  ['F1', 'Форма прямо у Facebook, без лендінгу', 'owner-ai', 'Найдешевша заявка: контакт у два дотики, далі пише бот або ви. Якість нижча — годиться, щоб швидко перевірити біль.', 'Залиште контакт — надішлю план першого кроку', 'ШІ у бізнесі: з чого почати',
    [[null, 'Реклама → форма у Facebook (заявки поки розбираєте вручну)'], ['manual:consult', 'Розмова і продаж']]],
  ['Q1', 'Тест у боті «де у вас зникає час»', 'owner-routine', 'Людина, що відповіла на 5 питань про свій бізнес, охочіше йде на консультацію, а ви отримуєте матеріал до розмови.', 'Тест на 2 хвилини: де ваш бізнес втрачає час', 'Дізнайтесь, скільки годин на тиждень можна повернути',
    [[null, 'Реклама → бот із тестом (воронку ще треба зробити)'], ['manual:consult', 'Консультація і продаж далі']]],
  ['K1', 'Відео-розбір кейсу → запис', 'sales-head', 'Короткий кейс «було 20 хвилин — стало 30 секунд» переконує краще за обіцянку; тим, хто додивився, показуємо R1.', 'Подивіться, як це працює в реальному бізнесі', 'Кейс: заявка 20 хв → 30 с',
    [['site:auto-lp', 'Відео до 60 с → лендінг'], ['flows:bot-karta-sales', 'Бот'], ['manual:consult', 'Консультація і продаж далі']]],
];

(async () => {
  let p = await db.project.findUnique({ where: { slug: 'fineko' } });
  if (!p) p = await db.project.create({ data: { name: 'FINEKO', slug: 'fineko', apiKey: `ads_${crypto.randomBytes(24).toString('hex')}`, targetSaleCost: PRICE } });
  const made = { audiences: 0, elements: 0, steps: 0, bundles: 0 };

  const audId = new Map();
  const existing = await db.audience.findMany({ where: { projectId: p.id } });
  for (const [key, name, description] of AUDIENCES) {
    let a = existing.find((x) => x.name === name);
    if (!a) { a = await db.audience.create({ data: { projectId: p.id, name, description, targeting: { countries: ['UA'] } } }); made.audiences += 1; }
    audId.set(key, a.id);
  }

  for (const [type, ref, name, config, steps] of ELEMENTS) {
    let el = await db.element.findUnique({ where: { projectId_type_ref: { projectId: p.id, type, ref } } });
    if (!el) { el = await db.element.create({ data: { projectId: p.id, type, ref, name, config } }); made.elements += 1; }
    for (const [key, title, order, branch, isSale, leadsTo, defaultAmount] of steps) {
      const has = await db.step.findUnique({ where: { elementId_key: { elementId: el.id, key } } });
      if (!has) { await db.step.create({ data: { elementId: el.id, key, title, order, branch, isSale, leadsTo, defaultAmount } }); made.steps += 1; }
    }
  }

  for (const [code, name, aud, hypothesis, promise, angle, pathRows] of BUNDLES) {
    if (await db.bundle.findFirst({ where: { projectId: p.id, code } })) continue;
    await db.bundle.create({ data: { projectId: p.id, code, name, hypothesis, audienceId: audId.get(aud), product: `Розбір процесу, ${PRICE} грн`, promise, angle, path: pathRows.map(([key, note]) => ({ key, note })), status: 'draft', testBudgetUsd: 30, stopRule: { text: STOP } } });
    made.bundles += 1;
  }
  console.log(`Проєкт «${p.name}» (${p.id}): додано аудиторій ${made.audiences}, елементів ${made.elements}, кроків ${made.steps}, зв'язок ${made.bundles}`);
  await db.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
