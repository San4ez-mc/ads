// Правила Meta: типові порушення ловляться, наші чинні тексти проходять, чужі посилання не пускаються.
const test = require('node:test');
const assert = require('node:assert');
const { checkAdText, checkDestination } = require('../src/lib/metaPolicy');

const bad = (text) => checkAdText({ primary: text, headline: 'Заголовок' });

test('порушення: гарантії, дохід, назви Meta, особисті ознаки, клікбейт, дефіцит, заборонені теми, крик', () => {
  for (const [text, part] of [
    ['Гарантуємо результат за тиждень', 'гарантія'], ['Пасивний дохід без зусиль', 'доходу'], ['Заявки з Instagram губляться', 'Instagram'],
    ['Ви тонете в боргах і не спите', 'особисту ознаку'], ['Вам 45 років і бізнес стоїть', 'віком'], ['Покажемо компанію до і після', 'до і після'],
    ['Ви не повірите, що робить ШІ', 'клікбейт'], ['Останній шанс записатися', 'тиск'], ['Кредит для бізнесу за день', 'кредити'],
    ['У нас відкрита вакансія', 'вакансії'], ['УВАГА ТЕРМІНОВО для власників', 'великими'], ['Встигніть!! Прямо зараз', 'знаки'],
  ]) assert.ok(bad(text).join(' | ').includes(part), `${text} → ${bad(text).join(' | ')}`);
});

test('чинні тексти реклами проходять', () => {
  for (const primary of [
    'Колеги вже розповідають про ШІ, а що саме підійде у вашій компанії — незрозуміло. Отримайте безкоштовну Карту автоматизації: перелік процесів, які можна автоматизувати вже зараз. Ден надішле її в Telegram і відповість на питання.',
    'Задачі ставляться в чаті — і там же губляться. Коли все у Telegram, немає ні контролю, ні відповідальних. Отримайте безкоштовну «Карту автоматизації» — PDF із 10 типовими болями бізнесу.',
    'Бухгалтери в одній компанії рахували виплати майже весь місяць. Тепер удвічі швидше. CRM і PDF за кнопкою.',
    'Шукаєте людину на рутинну роботу і не можете знайти? Частину вже робить ШІ.',
  ]) assert.deepStrictEqual(checkAdText({ primary, headline: 'З чого почати?' }), [], primary);
});

test('посилання: лише https і наші домени; скорочувачі й чужі сайти — ні', async () => {
  process.env.META_POLICY_SKIP_REACH = '1';
  assert.deepStrictEqual(await checkDestination('https://auto-lp.fineko.space/?ab=page:b'), []);
  assert.deepStrictEqual(await checkDestination('https://t.me/den_fineko_bot?start=x'), []);
  assert.deepStrictEqual(await checkDestination('https://shop.example.com/', { domains: ['shop.example.com'] }), []);
  for (const link of ['http://auto-lp.fineko.space/', 'https://bit.ly/abc', 'https://evil-fineko.space/', 'не адреса']) assert.ok((await checkDestination(link)).length, link);
});
