// Стан оголошення за ціною продажу. Рахує код за простими порогами (не ШІ), щоб карта й звіти працювали завжди.
// good — працює · pricey — дорого · bad — зливає · few — мало даних · none — ціль не задано.
const { DEFAULTS } = require('./rules');
const LABEL = { good: 'працює', pricey: 'дорого', bad: 'зливає', few: 'мало даних', none: 'ціль не задано' };

function verdict({ spend, sales, target, rules }) {
  const { priceyUpTo, noClientTargets } = rules || DEFAULTS;
  const s = Number(spend) || 0; const n = Number(sales) || 0; const t = Number(target) || 0;
  if (!t) return 'none';
  if (n > 0) {
    const cost = s / n;
    if (cost <= t) return 'good';
    if (cost <= t * priceyUpTo) return 'pricey';
    return 'bad';
  }
  // Без жодного клієнта: «зливає» лише коли витрачено кілька цільових цін (за правилами проєкту); до того — ще мало даних.
  return s >= t * noClientTargets ? 'bad' : 'few';
}

module.exports = { verdict, LABEL };
