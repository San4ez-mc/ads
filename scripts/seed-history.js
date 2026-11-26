// Початкові записи «Історії» проєкту FINEKO: що вже тестували (24–26.11) і п'ять запланованих варіантів із плану.
// Повторний запуск безпечний: наявні коди не чіпаються.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { db } = require('@ads/db');

const AD = '120252753332020776';
const d = (s) => new Date(`${s}T00:00:00Z`);
const ROWS = [
  { code: 'T1', title: 'Реклама про Карту → сторінка консультації (перший запуск)', status: 'stopped', dateFrom: d('2026-11-24'), dateTo: d('2026-11-26'), budgetUah: 200, adExtIds: [AD],
    audience: 'Україна, 25–55, без інтересів', pain: 'Усі впроваджують ШІ, а з чого почати', offer: 'Безкоштовна «Карта автоматизації»', creative: '«Усі впроваджують ШІ», довгий текст в описі', site: 'auto-lp (продає консультацію 1500 грн)', bot: 'bot-karta-sales', changed: 'Перший запуск. Площадки автоматичні, без міток оголошення',
    result: { spend: 266, impressions: 6525, linkClicks: 356, steps: [{ element: 'Реклама', title: 'Дочекались сайту (за даними Meta)', people: 91 }], note: 'Audience Network: 210 грн із 266, дочекались сайту 17% (Instagram 55%). Сайт: 317 переглядів, 0 натискань кнопки (без привʼязки до оголошення).' },
    conclusion: 'Висновку про біль чи пропозицію зробити не можна: більшість грошей пішла в Audience Network. Сторінка не повторює обіцянку реклами. Далі: без Audience Network, з мітками, довгий текст в основному полі.' },
  { code: 'T2', title: 'Те саме без Audience Network, з мітками', status: 'running', dateFrom: d('2026-11-26'), budgetUah: 200, adExtIds: [AD],
    audience: 'Україна, 25–55, без інтересів', pain: 'Усі впроваджують ШІ, а з чого почати', offer: 'Безкоштовна «Карта автоматизації»', creative: '«Усі впроваджують ШІ», довгий текст в основному полі', site: 'auto-lp (продає консультацію 1500 грн)', bot: 'bot-karta-sales', changed: 'Прибрано Audience Network, додано мітки оголошення, текст переставлено. 26.11 цифри частково перетинаються з T1' },
  { code: 'V1', title: 'Excel і Viber → одразу бот', audience: 'Власники з командою: торгівля, склад', pain: 'Замовлення в Excel, Viber і по телефону', offer: 'Безкоштовна «Карта автоматизації»', creative: '№2035', site: 'без сайту', bot: 'bot-karta-sales (після виправлень)', changed: 'Шлях напряму в бота; біль із розмов', budgetUah: 650 },
  { code: 'V2', title: '«З чого почати з ШІ» → одразу бот', audience: 'Власники, яким цікавий ШІ', pain: 'Усі впроваджують ШІ, а з чого почати', offer: 'Безкоштовна «Карта автоматизації»', creative: '«Усі впроваджують ШІ»', site: 'без сайту', bot: 'bot-karta-sales (після виправлень)', changed: 'Порівняно з V1 інший біль', budgetUah: 650 },
  { code: 'V3', title: 'Ручне перенесення даних → одразу бот', audience: 'Керівники продажів', pain: 'Менеджери вручну переносять дані', offer: 'Безкоштовна «Карта автоматизації»', creative: 'новий, замовити', site: 'без сайту', bot: 'bot-karta-sales (після виправлень)', changed: 'Порівняно з V1 інший біль', budgetUah: 650 },
  { code: 'V4', title: 'Біль-переможець → сторінка про Карту → бот', pain: 'переможець раунду 1', offer: 'Безкоштовна «Карта автоматизації»', site: 'auto-lp ?ab=page:b', bot: 'bot-karta-sales', changed: 'Сторінка перед ботом', budgetUah: 900 },
  { code: 'V5', title: 'Біль-переможець → 20 хв безкоштовно → платний розбір', pain: 'переможець раунду 1', offer: 'Безкоштовні 20 хвилин, далі розбір 1500 грн', site: 'сторінка із записом', bot: 'календар', changed: 'Інший перший крок до продажу', budgetUah: 900 },
];

(async () => {
  const project = await db.project.findUnique({ where: { slug: process.argv[2] || 'fineko' } });
  if (!project) throw new Error('Проєкт не знайдено');
  let added = 0;
  for (const row of ROWS) {
    if (await db.experiment.findFirst({ where: { projectId: project.id, code: row.code } })) continue;
    await db.experiment.create({ data: { ...row, projectId: project.id } });
    added += 1;
  }
  console.log(`Історія: додано ${added} із ${ROWS.length}`);
  await db.$disconnect();
})().catch(async (e) => { console.error(e.message); await db.$disconnect(); process.exit(1); });
