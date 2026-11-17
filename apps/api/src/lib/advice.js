// Рекомендації: рахує код за правилами з розділу 4.3 проєкту, не ШІ. Кожна порада має пояснення простими словами,
// важливість і позначку «попередньо», коли даних мало (при малому бюджеті поради все одно потрібні, але чесні).
// Чиста функція над даними карти — легко перевіряється тестом.
const { round2 } = require('./money');

const SEV = { high: 3, mid: 2, low: 1, info: 0 };
const grn = (n) => `${Math.round(n).toLocaleString('uk-UA')} грн`;

/** @param map результат buildMapData  @param ctx { project, overview: {todaySpend, limit}, connections } */
function buildAdvice(map, ctx) {
  const items = []; const target = map.target;
  const add = (it) => items.push({ severity: 'mid', preliminary: false, ...it });
  const ads = map.campaigns.flatMap((c) => c.adSets.flatMap((s) => s.ads.map((a) => ({ ...a, campaign: c.name, adSet: s.name, adSetId: s.id, adSetBudget: s.dailyBudget, learning: s.learningStage === 'LEARNING' }))));

  if (!target) add({ kind: 'setup', severity: 'high', title: 'Задайте цільову ціну продажу', text: 'Без неї не можна сказати, що працює, а що ні. Налаштування → «Цільова ціна продажу».' });

  for (const c of ctx.connections || []) {
    if (c.status === 'error' || c.status === 'blocked') add({ kind: 'connection', severity: 'high', title: `Підключення «${c.name}» не працює`, text: c.lastError || 'Перевірте ключ у розділі «Підключення».' });
  }

  // Люди без джерела: карта бреше, коли їх багато.
  for (const e of map.elements) {
    const first = e.steps.filter((s) => s.branch !== 'side').sort((a, b) => a.order - b.order)[0];
    if (first && first.total >= 20 && first.unknown / first.total > 0.3) add({ kind: 'no_source', severity: 'mid', title: `«${e.name}»: ${Math.round((first.unknown / first.total) * 100)}% людей без відомого оголошення`, text: 'Перевірте, що кнопка в Telegram має хвіст __c<код заходу>, а в рекламних посиланнях є параметри ad_id і campaign_id.' });
  }

  // Денний ліміт.
  const o = ctx.overview;
  if (o && o.limit > 0) {
    if (o.todaySpend > o.limit) add({ kind: 'limit', severity: 'high', title: 'Денний ліміт перевищено', text: `Сьогодні витрачено ${grn(o.todaySpend)} при ліміті ${grn(o.limit)}. Платформа сама нічого не вимикає (поки лише читає) — вимкніть вручну в кабінеті.` });
    else if (o.todaySpend > o.limit * 0.8) add({ kind: 'limit', severity: 'low', title: 'Денний ліміт майже вичерпано', text: `Витрачено ${grn(o.todaySpend)} з ${grn(o.limit)}.` });
  }

  // Середня конверсія другого кроку шляху по проєкту — з чим порівнювати окреме оголошення.
  const secondConv = new Map();
  for (const e of map.elements) {
    const main = e.steps.filter((s) => s.branch !== 'side').sort((a, b) => a.order - b.order);
    if (main.length >= 2 && main[0].total >= 20) secondConv.set(e.key, { first: main[0], second: main[1], avg: main[1].total / main[0].total });
  }

  for (const a of ads) {
    const name = `«${a.name}»`;
    const tenDays = a.createdAt && Date.now() - new Date(a.createdAt).getTime() < 3 * 86400000;
    const early = !target || a.spend < target; // витрачено менше однієї цільової ціни — висновки ненадійні
    if (a.running && target) {
      if (a.verdict === 'bad' && a.sales === 0) add({ kind: 'pause', severity: 'high', ad: a.externalId, action: { kind: 'pause_ad', adId: a.id, label: 'Вимкнути в кабінеті' }, title: `Вимкнути ${name}`, text: `Витрачено ${grn(a.spend)} (понад дві цільові ціни ${grn(target * 2)}) і жодного продажу. Це не випадковість: креатив або шлях не працює.` });
      else if (a.verdict === 'bad') add({ kind: 'pause', severity: 'high', ad: a.externalId, action: { kind: 'pause_ad', adId: a.id, label: 'Вимкнути в кабінеті' }, title: `Вимкнути або замінити ${name}`, text: `Ціна продажу ${grn(a.saleCost)} — більш ніж у 1,5 раза вища за ціль ${grn(target)}.` });
      else if (a.verdict === 'pricey') add({ kind: 'watch', severity: 'mid', ad: a.externalId, title: `Дорого: ${name}`, text: `Ціна продажу ${grn(a.saleCost)} при цілі ${grn(target)}. Дайте ще 2–3 дні або замініть креатив на інший біль.`, preliminary: a.sales < 2 });
      else if (a.verdict === 'good' && a.sales >= 2) add({ kind: 'scale', severity: 'mid', ad: a.externalId, action: a.adSetBudget ? { kind: 'set_adset_budget', adSetId: a.adSetId, dailyBudget: round2(a.adSetBudget * 1.2), label: `Підняти бюджет групи до ${round2(a.adSetBudget * 1.2)}` } : null, title: `Підсилити ${name}`, text: `Ціна продажу ${grn(a.saleCost)} (ціль ${grn(target)}), продажів ${a.sales}. Можна підняти бюджет групи на 20%${a.adSetBudget ? ` (зараз ${a.adSetBudget} на день)` : ''}, не частіше ніж раз на 3 дні.`, preliminary: false });
      else if (a.verdict === 'good') add({ kind: 'watch', severity: 'low', ad: a.externalId, title: `Добре, але лише ${a.sales} продаж: ${name}`, text: `Ціна продажу ${grn(a.saleCost)}. Поки не міняйте нічого — потрібен ще хоча б один продаж, щоб довіряти цифрі.`, preliminary: true });
      if (a.learning && a.verdict !== 'bad') add({ kind: 'learning', severity: 'info', ad: a.externalId, title: `${name} ще навчається`, text: 'Група в навчанні — бюджет і креатив краще не чіпати, поки Meta не зібрала дані.', preliminary: true });
      if (!tenDays && a.impressions >= 1500 && a.linkClicks === 0) add({ kind: 'no_clicks', severity: 'mid', ad: a.externalId, title: `${name}: показів багато, переходів нуль`, text: 'Креатив не чіпляє. Замініть зображення або перший рядок тексту.' });
      if (a.cpc && early === false && a.cpc > 0) { /* ціна переходу сама по собі без продажів не вирок — окремої поради нема */ }
    }
    // Проблема не в креативі, а у воронці: переходи є, але далі відпадають значно гірше, ніж у середньому по шляху.
    const sc = a.entry && secondConv.get(a.entry);
    if (sc) {
      const f = sc.first.byAd[a.externalId] || 0; const s2 = sc.second.byAd[a.externalId] || 0;
      if (f >= 20 && s2 / f < sc.avg * 0.5) add({ kind: 'funnel', severity: 'mid', ad: a.externalId, title: `${name}: люди відпадають на кроці «${sc.second.title}»`, text: `Дійшли ${s2} з ${f} (${Math.round((s2 / f) * 100)}%), а в середньому по шляху ${Math.round(sc.avg * 100)}%. Це схоже на проблему обіцянки в креативі чи шляху, а не ціни кліка.`, preliminary: f < 50 });
    }
  }

  // Усе крутиться без жодного продажу довго, а бюджет малий: сказати чесно, що вирішувати рано.
  if (target && ads.length && !items.some((i) => i.kind === 'pause' || i.kind === 'scale')) {
    const spent = ads.reduce((s, a) => s + a.spend, 0); const sales = ads.reduce((s, a) => s + a.sales, 0);
    if (spent > 0 && spent < target * 2 && sales === 0) add({ kind: 'few_data', severity: 'info', title: 'Даних ще мало для рішень', text: `Витрачено ${grn(spent)} — менше двох цільових цін (${grn(target * 2)}). Нічого не вимикайте: дивіться на ціну заходу і частку тих, хто дійшов до пропозиції.`, preliminary: true });
  }

  const order = (i) => SEV[i.severity] ?? 0;
  items.sort((x, y) => order(y) - order(x));
  return items;
}

/** Текст щоденного звіту для Telegram (HTML). Лише цифри й поради; кнопки додає воронка. */
function dailyReportText(project, day, totals, advice, bundles) {
  const lines = [];
  lines.push(`<b>${escapeHtml(project.name)}</b> · ${escapeHtml(day)}`);
  lines.push(`Витрачено <b>${grn(totals.spend)}</b> · переходи ${totals.linkClicks} · продажі <b>${totals.sales}</b>${totals.sales ? ` на ${grn(totals.revenue)}` : ''}`);
  lines.push(totals.saleCost ? `Ціна продажу <b>${grn(totals.saleCost)}</b>${totals.target ? ` (ціль ${grn(totals.target)})` : ''}` : `Ціна продажу — ще нема продажів${totals.target ? ` (ціль ${grn(totals.target)})` : ''}`);
  if (totals.todayLimit) lines.push(`Сьогодні: ${grn(totals.todaySpend)} з ліміту ${grn(totals.todayLimit)}`);
  const live = (bundles || []).filter((b) => ['test', 'works', 'scale'].includes(b.status));
  if (live.length) { lines.push(''); lines.push('<b>Зв\'язки в роботі</b>'); for (const b of live) lines.push(`• ${escapeHtml(b.name)}${b.code ? ` [${escapeHtml(b.code)}]` : ''}: ${grn(b.metrics.spend)}, продажів ${b.metrics.sales}${b.metrics.budgetUsedPct !== null ? `, бюджет тесту ${b.metrics.budgetUsedPct}%` : ''}`); }
  const real = advice.filter((i) => i.severity !== 'info').slice(0, 6);
  lines.push('');
  if (!real.length) lines.push('Порад немає: усе в межах правил.');
  else { lines.push('<b>Що робити</b>'); for (const i of real) lines.push(`${i.severity === 'high' ? '🔴' : i.severity === 'mid' ? '🟡' : '⚪'} ${escapeHtml(i.title)}${i.preliminary ? ' <i>(попередньо)</i>' : ''}\n${escapeHtml(i.text)}`); }
  return lines.join('\n');
}

const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports = { buildAdvice, dailyReportText, round2 };
