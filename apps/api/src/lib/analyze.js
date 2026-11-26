// Кнопка «Аналізувати» на карті: підказки під рекламою, сайтом і воронкою. Рахує код за простими правилами (не ШІ),
// тому кожна підказка тримається на конкретній цифрі. Чиста функція — перевіряється тестом.
// Для реклами підказка може мати дію (її виконує платформа через запобіжники), для сайту й воронки — текст, який копіюють виконавцю.
const { toUah } = require('./money');
const { PLATFORM } = require('./describe');

const grn = (n) => `${Math.round(n).toLocaleString('uk-UA')} грн`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const main = (e) => e.steps.filter((s) => s.branch !== 'side').sort((a, b) => a.order - b.order);

/** @param map buildMapData  @param rows витрати по площадках (meta.fetchPlacements)  @param ctx { project, emptyAdSets } */
function analyze(map, rows, ctx = {}) {
  const ads = {}; const elements = {}; const general = [];
  const add = (bag, key, h) => { (bag[key] ||= []).push({ severity: 'mid', ...h }); };
  const list = map.campaigns.flatMap((c) => c.adSets.flatMap((s) => s.ads.map((a) => ({ ...a, campaign: c.name }))));
  const target = map.target;

  const byAd = new Map();
  for (const r of rows || []) { if (!byAd.has(r.adExternalId)) byAd.set(r.adExternalId, []); byAd.get(r.adExternalId).push({ ...r, uah: toUah(r.spend, r.currency, ctx.project) }); }

  for (const a of list) {
    const id = a.externalId; const platforms = byAd.get(id) || [];
    const total = platforms.reduce((s, p) => s + p.uah, 0);
    const clicks = platforms.reduce((s, p) => s + p.linkClicks, 0); const landed = platforms.reduce((s, p) => s + p.landingViews, 0);
    const an = platforms.find((p) => p.platform === 'audience_network');
    const now = a.placements;
    const anOn = !now || now.auto || now.list.includes('audience_network');
    if (an && total > 0 && an.uah >= 20 && an.uah / total >= 0.3) {
      if (anOn) add(ads, id, { severity: 'high', title: `Audience Network забирає ${pct(an.uah, total)}% грошей`, text: `${grn(an.uah)} з ${grn(total)}. Дочекались сайту ${pct(an.landingViews, an.linkClicks)}% тих, хто клікнув там. Вимкніть цю площадку.`, action: { kind: 'set_placements', adSetId: a.adSetId, placements: (now && !now.auto ? now.list : ['facebook', 'instagram', 'messenger']).filter((x) => x !== 'audience_network'), label: 'Вимкнути Audience Network' } });
      else add(ads, id, { severity: 'info', title: 'Audience Network уже вимкнено', text: `За цей період на неї пішло ${grn(an.uah)} (${pct(an.uah, total)}%). Порівнюйте цифри з дня вимкнення.` });
    }
    const site = a.creative.linkUrl && !/\/\/t\.me\//i.test(a.creative.linkUrl);
    if (site && clicks >= 30 && landed / clicks < 0.4) {
      const best = platforms.filter((p) => p.linkClicks >= 20).sort((x, y) => y.landingViews / y.linkClicks - x.landingViews / x.linkClicks)[0];
      add(ads, id, { title: `Лише ${pct(landed, clicks)}% тих, хто клікнув, дочекались сайту`, text: `${landed} з ${clicks}.${best ? ` Найкраще в ${PLATFORM[best.platform] || best.platform}: ${pct(best.landingViews, best.linkClicks)}%.` : ''} Причини: випадкові кліки або сайт довго відкривається з телефона.` });
    }
    if (a.creative.linkUrl) {
      const tg = !site;
      if (tg && !/[?&]start=[^&]*__(a\d+|c[A-Za-z0-9]{10})/.test(a.creative.linkUrl)) add(ads, id, { title: 'У посиланні на бота нема мітки оголошення', text: 'Бот не дізнається, з якої реклами прийшла людина: ціну продажу порахувати не вдасться.' });
      if (site && !/[?&]ad_id=\d/.test(a.creative.linkUrl)) add(ads, id, { title: 'У посиланні нема мітки оголошення', text: 'Візити на сайт не привʼяжуться до цієї реклами. Додайте до адреси ad_id (платформа робить це сама в нових кампаніях і при заміні креативу).' });
    }
    if (a.impressions >= 1000 && a.ctr !== null) {
      if (a.ctr < 0.8) add(ads, id, { title: `Мало кому цікаво: клікає ${a.ctr}%`, text: 'Замініть картинку або перший рядок тексту: інший біль, коротший заголовок.', action: { kind: 'edit', label: 'Замінити креатив' } });
      else if (a.ctr >= 2) add(ads, id, { severity: 'info', title: `Креатив чіпляє: клікає ${a.ctr}%`, text: 'Якщо далі люди не йдуть, проблема не в оголошенні, а в тому, що вони бачать після кліку.' });
    }
    if (target && a.spend > 0 && a.sales === 0 && a.spend >= target * 2) add(ads, id, { severity: 'high', title: 'Витрачено дві цільові ціни без продажу', text: `${grn(a.spend)} при цілі ${grn(target)} за продаж. Вимкніть або замініть шлях.`, action: { kind: 'pause_ad', adId: a.id, label: 'Вимкнути оголошення' } });
    else if (target && a.spend > 0 && a.spend < target && a.sales === 0) add(ads, id, { severity: 'info', title: 'Для висновку про продажі даних ще мало', text: `Витрачено ${grn(a.spend)} з ${grn(target)} цільової ціни. Дивіться на кліки й кроки на сайті.` });
  }

  const textsFor = (key) => list.filter((a) => a.entry === key && a.creative.body).slice(0, 3).map((a) => `«${a.name}»: ${[a.creative.title, a.creative.body].filter(Boolean).join(' · ').slice(0, 400)}`);
  const period = `${map.from} – ${map.to}`;
  for (const e of map.elements) {
    const steps = main(e); if (!steps.length) continue;
    const first = steps[0];
    const line = steps.map((s) => `${s.title}: ${s.total}`).join(', ');
    const brief = (problem, todo) => [`${e.type === 'site' ? 'Сайт' : 'Воронка'} «${e.name}»${e.domain ? ` (https://${e.domain})` : ''}.`, `Проблема: ${problem}`, `Цифри за ${period} (люди по кроках): ${line}.`, ...(textsFor(e.key).length ? ['Реклама, яка сюди веде:', ...textsFor(e.key)] : []), `Що зробити: ${todo}`, 'Після змін перевірити з телефона, що кроки далі рахуються.'].join('\n');
    if (e.type === 'site') {
      const cta = steps.find((s) => s.key === 'cta_click');
      if (cta && first.total >= 50 && cta.total / first.total < 0.02) add(elements, e.key, { severity: 'high', title: `Майже ніхто не тисне кнопку: ${cta.total} з ${first.total}`, text: 'Найчастіше перший екран обіцяє не те, що реклама, або головної кнопки не видно з телефона.', copy: brief(`з ${first.total} відвідувачів кнопку натиснули ${cta.total}.`, 'Перший екран на телефоні має повторювати обіцянку з реклами і мати одну помітну кнопку саме на неї. Прибрати те, що відволікає. Перевірити швидкість відкриття і щоб нічого не вилазило за край екрана.') });
    }
    for (let i = 1; i < steps.length; i += 1) {
      const prev = steps[i - 1]; const cur = steps[i];
      if (cur.branch || prev.branch || prev.order === cur.order) continue;
      if (e.type === 'site' && cur.key === 'cta_click') continue; // уже пораховано вище
      if (prev.total >= 10 && cur.total / prev.total < 0.3) { add(elements, e.key, { title: `Великий відсів на кроці «${cur.title}»: ${cur.total} з ${prev.total}`, text: `Далі проходить ${pct(cur.total, prev.total)}%.`, copy: brief(`між «${prev.title}» і «${cur.title}» лишається ${pct(cur.total, prev.total)}% людей.`, `Подивитись, що бачить людина між цими кроками: прибрати зайве, пояснити наступну дію простими словами.`) }); break; }
    }
    // Сюди з сайту переходять, а воронка бота нікого не бачить.
    if (e.type === 'flows' && first.total === 0) {
      const sent = map.elements.reduce((n, o) => n + o.steps.filter((s) => s.leadsTo === `flows:${e.key.split(':')[1]}`).reduce((m, s) => m + s.total, 0), 0);
      if (sent >= 5) add(elements, e.key, { severity: 'high', title: `Сайт відправив у бота ${sent}, а воронка не бачить нікого`, text: 'Або люди не натискають «Почати» в Telegram, або воронка не записує вхід із реклами.', copy: brief(`із сайту в бота перейшли ${sent}, у воронці нуль входів.`, 'Перевірити, що посилання відкриває бота з міткою, воронка стартує і записує перший етап.') });
    }
    if (first.total >= 20 && first.unknown / first.total > 0.5) add(elements, e.key, { severity: 'info', title: `${pct(first.unknown, first.total)}% людей без відомої реклами`, text: 'Частина прийшла не з реклами або посилання без міток.' });
  }

  for (const s of ctx.emptyAdSets || []) general.push({ severity: 'info', title: `Група «${s.name}» увімкнена, але без жодного оголошення`, text: 'Вона нічого не показує. Додайте оголошення або вимкніть, щоб не плутала.' });
  return { ads, elements, general };
}

module.exports = { analyze };
