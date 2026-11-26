// Правила оцінки реклами, які власник міняє в «Налаштуваннях». Це НЕ запобіжники (ліміт, ±20%, навчання тощо):
// ті захищають гроші й кабінет і з інтерфейсу не послаблюються.
const { ValidationError } = require('@ads/errors');

// ключ → [за замовчуванням, найменше, найбільше, назва для повідомлення про помилку]
const FIELDS = {
  priceyUpTo: [1.5, 1, 10, '«Дорого» — у скільки разів дорожче за ціль'],
  noClientTargets: [2, 0.5, 20, 'Без клієнтів «зливає» після скількох цілей'],
  brokenSpend: [250, 0, 1000000, 'Витрати для тривоги «щось зламано»'],
  brokenPeople: [1, 1, 100000, 'Скільки людей має прийти'],
};
const DEFAULTS = Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f[0]]));

/** Чинні правила проєкту: збережені поверх стандартних. */
function rulesOf(project) {
  const saved = project?.rules && typeof project.rules === 'object' ? project.rules : {};
  return Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, Number.isFinite(saved[k]) ? saved[k] : d]));
}

/** Те, що прийшло з форми: лише відомі поля в дозволених межах. */
function parseRules(input, current) {
  const next = rulesOf(current);
  for (const [k, [, min, max, label]] of Object.entries(FIELDS)) {
    if (input?.[k] === undefined) continue;
    const n = Number(input[k]);
    if (input[k] === '' || input[k] === null || !Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${label}: число від ${min} до ${max}`);
    next[k] = n;
  }
  return next;
}

module.exports = { rulesOf, parseRules, DEFAULTS };
