// ПРАВИЛА РЕКЛАМИ META — внутрішня перевірка платформи. ОБОВʼЯЗКОВО для будь-якої зміни, що потрапляє в кабінет.
//
// Правило власника (26.11.2026): усі зміни реклами мають відповідати правилам Meta; кабінет під загрозою не ставимо.
// Хто пише нову дію, яка створює чи міняє текст, картинку, посилання або аудиторію, — проводить її через цей модуль
// (services/launch.js → check, services/actions.js → check). Обходити не можна ні прапорцем, ні «режимом».
//
// Це другий рубіж: перший — гейт контент-платформи (content2 src/lib/adRules.ts), останній — перевірка самої Meta.
// Список ловить типові порушення, а не всі: «пройшло тут» не означає «Meta гарантовано схвалить».
// Офіційні правила: https://transparency.meta.com/policies/ad-standards/
const L0 = '(?<![\\p{L}])';
const L1 = '(?![\\p{L}])';
const re = (body, flags = 'iu') => new RegExp(body, flags);

const TEXT_RULES = [
  [re('гаранту[єю]|гарантован|гарантія результату|без ризику|100\\s?%'), 'гарантія результату або «100%»: Meta вважає це оманливою обіцянкою'],
  [re(`пасивн\\p{L}* дохід|легк\\p{L}* гроші|швидк\\p{L}* заробіт|(?:заробляй\\p{L}*|заробіть|дохід)\\s+(?:від\\s+)?[$€]?\\s?\\d`), 'обіцянка доходу'],
  [re(`${L0}(?:facebook|instagram|meta|фейсбук\\p{L}*|інстаграм\\p{L}*)${L1}`), 'назва Facebook, Instagram або Meta в тексті реклами'],
  [re(`${L0}(?:ви|вас|вам|ваш\\p{L}*|ти|тебе|тобі|твій|твоя)\\s+(?:\\S+\\s+){0,3}(?:борг\\p{L}*|банкрут\\p{L}*|хвор\\p{L}*|депрес\\p{L}*|тривож\\p{L}*|самотн\\p{L}*|товст\\p{L}*|зайв\\p{L}* ваг\\p{L}*|безробітн\\p{L}*|судим\\p{L}*|інвалід\\p{L}*|вагітн\\p{L}*)`), 'натяк, що ми знаємо особисту ознаку людини (борги, здоровʼя, стан): пишіть про ситуацію, а не про людину'],
  [re(`${L0}(?:вам|тобі)\\s+(?:вже\\s+)?\\d{2}\\s+рок`), 'звернення за віком людини'],
  [re('до і після|до\\s*\\/\\s*після|before\\s*\\/?\\s*after'), 'порівняння «до і після»'],
  [re('шок(?:уюч|ували)?(?![\\p{L}])|не повірите|вам не розкажуть|ніхто не знає|секретн\\p{L}* (?:спосіб|метод|схема)'), 'клікбейт'],
  [re('останній шанс|тільки сьогодні|лишилось\\s+\\d+\\s+місц|залишилось\\s+\\d+\\s+місц'), 'тиск і дефіцит, який нічим не підтверджений'],
];

// Теми, для яких Meta вимагає окрему «спеціальну категорію» чи дозвіл. Платформа таких кампаній не створює.
const RESTRICTED = [
  [re(`${L0}(?:кредит\\p{L}*|позик\\p{L}*|іпотек\\p{L}*|розстрочк\\p{L}*)`), 'фінанси й кредити (спеціальна категорія)'],
  [re(`${L0}ваканс\\p{L}*|шукаємо\\s+(?:співробітник|працівник|менеджер)\\p{L}*|влаштува\\p{L}*\\s+на\\s+роботу`), 'робота й вакансії (спеціальна категорія)'],
  [re(`оренд\\p{L}*\\s+(?:житл|квартир)\\p{L}*|продаж\\p{L}*\\s+(?:квартир|будинк)\\p{L}*|нерухом\\p{L}*`), 'житло й нерухомість (спеціальна категорія)'],
  [re(`${L0}(?:вибор(?:и|ах|ів|чий)|депутат\\p{L}*|партії|голосуйт\\p{L}*)${L1}`), 'політика й вибори (потрібен дозвіл)'],
  [re(`${L0}(?:казино|букмекер\\p{L}*|ставк\\p{L}* на спорт|крипт\\p{L}*|біткоїн\\p{L}*)`), 'азартні ігри чи криптовалюта (потрібен дозвіл)'],
];

const CAPS_OK = /^(CRM|ERP|API|PDF|GPT|SMM|KPI|SPIN|FINEKO)$/;

/** Порушення в тексті оголошення (основний текст, заголовок, опис). Порожній масив = зауважень нема. */
function checkAdText({ primary, headline, description } = {}) {
  const all = [primary, headline, description].filter(Boolean).join('\n');
  const out = [];
  if (!all.trim()) return ['нема тексту оголошення'];
  for (const [rule, why] of TEXT_RULES) if (rule.test(all)) out.push(why);
  for (const [rule, why] of RESTRICTED) if (rule.test(all)) out.push(`тема «${why}»: таку рекламу платформа не створює`);
  const caps = (all.match(new RegExp(`${L0}[А-ЯІЇЄҐA-Z]{4,}${L1}`, 'gu')) || []).filter((w) => !CAPS_OK.test(w));
  if (caps.length >= 2) out.push(`слова великими літерами (${caps.slice(0, 3).join(', ')})`);
  if (/[!?]{2,}/.test(all) || (all.match(/!/g) || []).length > 1) out.push('зайві знаки оклику чи питання');
  if ((all.match(/\p{Extended_Pictographic}/gu) || []).length > 3) out.push('забагато емодзі');
  return out;
}

const hostOf = (u) => String(u || '').toLowerCase().replace(/^www\./, '');

/**
 * Куди веде реклама: лише https і лише на наші адреси (fineko.space, t.me, домени сайтів проєкту й уже схвалені в кабінеті) —
 * жодних скорочувачів і чужих сторінок. Сторінка мусить відкриватись: Meta відхиляє непрацюючі посилання.
 */
async function checkDestination(link, { domains = [] } = {}) {
  let url; try { url = new URL(link); } catch { return ['адреса оголошення крива']; }
  if (url.protocol !== 'https:') return ['посилання має починатися з https://'];
  const host = hostOf(url.hostname);
  const ours = host === 't.me' || host === 'fineko.space' || host.endsWith('.fineko.space') || domains.map(hostOf).includes(host);
  if (!ours) return [`посилання веде на незнайомий домен ${host}: додайте цей сайт у платформу, якщо він ваш`];
  if (host === 't.me' || process.env.META_POLICY_SKIP_REACH === '1') return [];
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    return res.ok ? [] : [`сторінка не відкривається (код ${res.status}): Meta відхилить оголошення`];
  } catch { return ['сторінка не відповідає: Meta відхилить оголошення']; }
}

/** Домени, які проєкт уже використовує: сайти з карти й посилання наявних оголошень. */
async function projectDomains(db, projectId) {
  const [elements, ads] = await Promise.all([
    db.element.findMany({ where: { projectId, type: 'site' }, select: { config: true } }),
    db.ad.findMany({ where: { projectId, linkUrl: { not: null } }, select: { linkUrl: true }, take: 500 }),
  ]);
  const fromAds = ads.map((a) => { try { return new URL(a.linkUrl).hostname; } catch { return null; } });
  return [...new Set([...elements.map((e) => e.config?.domain), ...fromAds].filter(Boolean))];
}

module.exports = { checkAdText, checkDestination, projectDomains };
