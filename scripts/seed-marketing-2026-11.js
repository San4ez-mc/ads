// План маркетолога 18.11.2026: нові аудиторії (персони), нові зв'язки, розкладка креативів по зв'язках з хвилями запуску.
// Повторний запуск безпечний: наявне не перезаписує. Існуючі зв'язки чіпає лише якщо це чернетка, у якій ще нема креативів.
// Нічого не запускає в рекламі. Запуск: node scripts/seed-marketing-2026-11.js   (--no-push: не створювати персони в контент-платформі)
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { db } = require('@ads/db');
const { decrypt } = require('../apps/api/src/lib/secrets');
const c2 = require('../apps/api/src/channels/content2');

const PUSH = !process.argv.includes('--no-push');
const PRICE = 1500;
const STOP = 'Стоп, якщо витрачено бюджет тесту і нема жодної оплати, або 40 заходів не дали жодної заявки';

// Нові персони: гіпотези з болів, які вже названо в кейсах (акт, звіти, синхронізація CRM і складу, парсери цін, підрядник не спрацював).
const NEW_PERSONAS = [
  { name: 'Ірина', pains: 'Замовлення з сайту й маркетплейсів переносять у CRM і на склад руками; залишки й ціни не збігаються, продають те, чого вже нема; ціни конкурентів дивляться очима раз на тиждень; повернення й відмови рахують у таблиці.', goals: 'Щоб замовлення, склад і ціни самі збігались; не втрачати гроші на помилках; менше сидіти в таблицях.', triggers: 'Продали товар, якого нема на складі; помилка в ціні; сезонний пік, коли менеджери не встигають; конкурент знизив ціну, а вона дізналась через тиждень.', objections: '«У нас уже є CRM чи Prom — вони все вміють»; «Розробка дорога й довга»; «Мої менеджери не люблять нових систем».', language: 'Українська. Власниця інтернет-магазину (5–20 людей).' },
  { name: 'Тетяна', pains: 'Акти, рахунки й звіти для клієнтів збирають руками, на один акт йде до 20 хвилин; кінець місяця — «день актів»; звіти щотижня збирає людина з кількох місць; клієнтам нагадують про оплату й зустрічі вручну, частину забувають.', goals: 'Щоб документи й звіти формувались за кнопкою; не залежати від того, чи хтось сьогодні на роботі; більше часу на клієнтів.', triggers: 'Кінець місяця; клієнт скаржиться, що акт чи звіт запізнився; людина, яка все це робила, пішла у відпустку.', objections: '«У нас є бухгалтер, вона робить»; «Дані клієнтів конфіденційні»; «Наші документи всі різні».', language: 'Українська. Керівниця компанії з B2B-послугами чи агенції (3–20 людей).' },
  { name: 'Руслан', pains: 'Платив підрядникові за бота чи автоматизацію, а воно працює погано або ніхто не користується; сам пробував ChatGPT і конструктори — не прижилось; не розуміє, як це підтримувати; втратив гроші й довіру до теми.', goals: 'Зробити з першого разу правильно; знати план, порядок і вартість ДО оплати розробки; щоб команда реально користувалась.', triggers: 'Бот чи автоматизація, за які заплатили, стоять без діла; конкурент запровадив таке саме, і воно працює; бажання спробувати «ще раз», але інакше.', objections: '«Знову гроші на вітер»; «Підрядники всі обіцяють»; «Команда не користуватиметься»; «Я вже пробував».', language: 'Українська. Власник бізнесу, якого вже «обпекли».' },
];
// Персони, що вже є в контент-платформі: лише привʼязуємо до аудиторій платформи реклами.
const EXISTING = ['Дмитро', 'Максим', 'Андрій', 'Сашко', 'Власник бізнесу: рутина та впровадження ШІ'];

// Номери креативів контент-платформи за болями (див. lib/pains.js).
const SET = {
  A1: [1694, 1695, 1706, 1707, 1952],
  A2: [1686, 1687, 1698, 1699, 1684],
  B1: [1688, 1689, 1700, 1701, 1685],
  C1: [1696, 1697, 1708, 1709],
  D1: [1690, 1691, 1702, 1703, 1954],
  D3: [1692, 1693, 1704, 1705, 1951, 1953],
};
// Хвиля 1: по одному креативу з кожного болю на одному й тому ж шляху (бот) — так порівнюємо болі, а не шляхи.
const WAVE1 = [1707, 1687, 1701, 1697, 1703, 1693];

const W = (n, text) => `ХВИЛЯ ${n} · ${text}`;
// [код, аудиторія, креативи, текст гіпотези; для нових: назва, шлях, обіцянка, кут]
const PLAN = {
  B1: { aud: 'Власник бізнесу: рутина та впровадження ШІ', nums: WAVE1, hyp: W(1, 'Перевіряємо БОЛІ. Шість оголошень — по одному на кожен біль, шлях один (бот, він уже готовий). Дивимось, який біль дає найдешевший старт бота. Далі беремо переможця у хвилю 2.') },
  A1: { aud: 'Дмитро', nums: SET.A1, hyp: W(2, 'Шлях лендінг (або оплата одразу) на біль «рутина менеджера». Порівнюємо з B1/Q1 на тих самих креативах: що дешевше — лендінг чи бот. Якщо у хвилі 1 виграє інший біль, замінити креативи на переможні.') },
  Q1: { aud: 'Дмитро', nums: SET.A1, hyp: W(4, 'Тест у боті на той самий біль «рутина менеджера». Спершу треба зробити бота-тест; запускати лише коли хвиля 2 покаже, що біль працює.') },
  F1: { aud: 'Сашко', nums: SET.D1, hyp: W(2, 'Форма у Facebook на біль «з чого почати з ШІ»: найдешевша заявка, але якість нижча. Перевіряємо, чи дають такі заявки оплату, а не лише контакти.') },
  C1: { aud: 'Сашко', nums: SET.D1, hyp: W(3, 'Лендінг із записом на безкоштовну розмову для болю «з чого почати з ШІ». Спершу треба зробити лендінг запису; той самий біль, що у F1 — порівнюємо шлях.') },
  D1: { aud: 'Максим', nums: SET.B1, hyp: W(2, 'Дірект в Instagram на біль «заявки губляться». Відповідаєте вручну: перевіряємо, чи люди пишуть і чи доходять до оплати. Дешево по підготовці, дорого по вашому часу.') },
  K1: { aud: 'Тетяна', nums: SET.A2, hyp: W(3, 'Відео-кейс «акт 20 хв → 30 с» плюс картинки того ж кейсу для керівників B2B-послуг. Перевіряємо, чи відео переконує краще за картинку на тому ж болю.') },
  R1: { aud: 'Руслан', nums: SET.D3, hyp: W(4, 'Повернення тих, хто вже брав карту й не купив: їм потрібні відповіді на заперечення («пробували — не прижилось»). Потрібен піксель Meta на лендінгу.') },
  G1: { aud: 'Андрій', nums: SET.C1, hyp: W(3, 'Новий сегмент: власник, на якому тримається все (бригади, об\'єкти, заявки). Біль «піде людина — зупиниться все» дуже емоційний; шлях бот, як у хвилі 1.'),
    name: 'Біль «усе на мені» → бот', path: [['flows:bot-karta-sales', 'Реклама → бот: карта, потім продаж консультації'], ['manual:consult', 'Консультація і продаж далі']], promise: 'Розбір: що змінити, щоб бізнес не зупинявся без вас', angle: 'Піде ключова людина у відпустку чи звільниться — що зупиниться' },
  H1: { aud: 'Руслан', nums: SET.D3, hyp: W(3, 'Новий сегмент: «обпечені» власники. Пропонуємо розбір ДО оплати розробки: що, чим і в якому порядку. Низький ризик (1500 грн) знімає страх «знову гроші на вітер».'),
    name: 'Обпечені: розбір до оплати розробки', path: [['site:auto-lp', 'Реклама → лендінг «Розбір процесу»'], ['flows:bot-karta-sales', 'Бот Ден'], ['manual:consult', 'Консультація і продаж далі']], promise: 'План, порядок і вартість до того, як платити за розробку', angle: 'Бот зробили, а ним ніхто не користується' },
  I1: { aud: 'Ірина', nums: [], hyp: W(3, 'Новий сегмент: інтернет-магазин (CRM, склад, ціни конкурентів). Конкретні кейси вже є (синхронізація, парсери цін), але креативів на ці болі ще нема: спершу замовити їх (блоки E1, E2 на карті креативів).'),
    name: 'Магазин: замовлення, склад, ціни', path: [['flows:bot-karta-sales', 'Реклама → бот: карта, потім продаж консультації'], ['manual:consult', 'Консультація і продаж далі']], promise: 'Замовлення, склад і ціни збігаються самі', angle: 'Продали те, чого вже нема на складі' },
};

(async () => {
  const p = await db.project.findUnique({ where: { slug: 'fineko' } });
  if (!p) throw new Error('Проєкт FINEKO не знайдено (спершу node scripts/seed-fineko.js)');
  const made = { audiences: 0, personasPushed: 0, bundles: 0, bundlesUpdated: 0 };

  // Контент-платформа: персони й креативи.
  const conn = await db.connection.findFirst({ where: { projectId: p.id, channel: 'content2', secretRead: { not: null } } });
  let personas = []; let creatives = [];
  if (conn) {
    const k = decrypt(conn.secretRead); const pid = conn.config?.projectId;
    personas = await c2.personas(conn.externalId, k, pid);
    creatives = await c2.creatives(conn.externalId, k, pid, 200);
    if (PUSH) {
      for (const np of NEW_PERSONAS) {
        if (personas.some((x) => String(x.name).trim().toLowerCase() === np.name.toLowerCase())) continue;
        await c2.upsertPersona(conn.externalId, k, pid, np); made.personasPushed += 1;
      }
      personas = await c2.personas(conn.externalId, k, pid);
    }
  } else console.log('Контент-платформу не підключено: персони й креативи пропущено');
  const idByNum = new Map(creatives.map((c) => [c.number, c.id]));

  // Аудиторії платформи реклами = персони.
  const personaText = (x) => [x.pains && `Болі: ${x.pains}`, x.goals && `Цілі: ${x.goals}`, x.triggers && `Що штовхає до покупки: ${x.triggers}`, x.objections && `Заперечення: ${x.objections}`, x.language && `Як говорять: ${x.language}`].filter(Boolean).join('\n');
  const audId = new Map();
  for (const name of [...EXISTING, ...NEW_PERSONAS.map((x) => x.name)]) {
    const persona = personas.find((x) => String(x.name).trim().toLowerCase() === name.toLowerCase());
    const fallback = NEW_PERSONAS.find((x) => x.name === name);
    let a = await db.audience.findFirst({ where: { projectId: p.id, name } });
    if (!a) { a = await db.audience.create({ data: { projectId: p.id, name, description: persona ? personaText(persona) : (fallback ? personaText(fallback) : null), content2PersonaId: persona ? persona.id : null, targeting: { countries: ['UA'] } } }); made.audiences += 1; }
    else if (persona && !a.content2PersonaId) a = await db.audience.update({ where: { id: a.id }, data: { content2PersonaId: persona.id } });
    audId.set(name, a.id);
  }

  // Зв'язки: нові створюємо, чернетки без креативів доповнюємо.
  for (const [code, d] of Object.entries(PLAN)) {
    const ids = d.nums.map((n) => idByNum.get(n)).filter(Boolean);
    const have = await db.bundle.findFirst({ where: { projectId: p.id, code } });
    if (!have) {
      await db.bundle.create({ data: { projectId: p.id, code, name: d.name, hypothesis: d.hyp, audienceId: audId.get(d.aud), product: `Розбір процесу, ${PRICE} грн`, promise: d.promise, angle: d.angle, path: d.path.map(([key, note]) => ({ key, note })), creativeIds: ids, status: 'draft', testBudgetUsd: 30, stopRule: { text: STOP } } });
      made.bundles += 1; continue;
    }
    const noCreatives = !Array.isArray(have.creativeIds) || have.creativeIds.length === 0;
    if (have.status === 'draft' && noCreatives) {
      await db.bundle.update({ where: { id: have.id }, data: { creativeIds: ids, audienceId: audId.get(d.aud), hypothesis: d.hyp } });
      made.bundlesUpdated += 1;
    }
  }
  console.log(`Готово: аудиторій додано ${made.audiences}, персон створено в контент-платформі ${made.personasPushed}, нових зв'язок ${made.bundles}, оновлено чернеток ${made.bundlesUpdated}`);
  await db.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
