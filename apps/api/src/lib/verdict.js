// Стан оголошення за ціною продажу. Рахує код за простими порогами (не ШІ), щоб карта й звіти працювали завжди.
// good — працює · pricey — дорого · bad — зливає · few — мало даних · none — ціль не задано.
const LABEL = { good: 'працює', pricey: 'дорого', bad: 'зливає', few: 'мало даних', none: 'ціль не задано' };

function verdict({ spend, sales, target }) {
  const s = Number(spend) || 0; const n = Number(sales) || 0; const t = Number(target) || 0;
  if (!t) return 'none';
  if (n > 0) {
    const cost = s / n;
    if (cost <= t) return 'good';
    if (cost <= t * 1.5) return 'pricey';
    return 'bad';
  }
  // Без жодного продажу: «зливає» лише коли витрачено щонайменше дві цільові ціни; до того — ще мало даних.
  return s >= t * 2 ? 'bad' : 'few';
}

module.exports = { verdict, LABEL };
