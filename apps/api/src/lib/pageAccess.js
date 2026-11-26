// Доступ до розділів за сторінками з SSO-панелі (Access.pageIds). Порожній pageIds = усі розділи; superadmin — без обмежень.
// Ключ проєкту (воронки Flows) має лише те, що перелічено в KEY_ALLOWED: читання і запуск синхронізації.
const PAGES = [
  { id: 'map', label: 'Карта' },
  { id: 'ads', label: 'Оголошення й аналітика' },
  { id: 'bundles', label: 'Зв\'язки' },
  { id: 'creatives', label: 'Креативи' },
  { id: 'clients', label: 'Клієнти (ручні позначки)' },
  { id: 'journal', label: 'Журнал дій' },
  { id: 'connections', label: 'Підключення і ключі' },
  { id: 'settings', label: 'Налаштування і ліміти' },
  { id: 'approve', label: 'Право затверджувати запуск' },
];

const RULES = [
  [(m, p) => /^\/connections(\/|$)/.test(p), ['connections']],
  [(m, p) => m !== 'GET' && /^\/project(\/|$)/.test(p), ['settings']],
  [(m, p) => /^\/(ads|overview|map|advice|report)(\/|$)/.test(p), ['ads', 'map']],
  [(m, p) => /^\/sync(\/|$)/.test(p), ['ads', 'connections']],
  [(m, p) => /^\/journal(\/|$)/.test(p), ['journal']],
  [(m, p) => m === 'GET' && /^\/experiments(\/|$)/.test(p), ['ads', 'map', 'bundles']],
  [(m, p) => /^\/experiments(\/|$)/.test(p), ['bundles']],
  [(m, p) => m !== 'GET' && /^\/(bundles|audiences|elements)(\/|$)/.test(p), ['bundles']],
  [(m, p) => /^\/creatives(\/|$)/.test(p), ['creatives']],
  [(m, p) => /^\/notes(\/|$)/.test(p), ['creatives', 'map']],
  [(m, p) => /^\/actions(\/|$)/.test(p), ['approve']],
  [(m, p) => m === 'GET' && /^\/launches(\/|$)/.test(p), ['ads', 'approve']],
  [(m, p) => /^\/launches(\/|$)/.test(p), ['approve']],
  [(m, p) => /^\/clients(\/|$)/.test(p), ['clients']],
  [(m, p) => m === 'GET' && /^\/sites(\/|$)/.test(p), ['ads', 'map']],
  [(m, p) => /^\/sites(\/|$)/.test(p), ['bundles']],
];

function requiredPages(method, path) {
  const m = String(method || 'GET').toUpperCase(); const p = String(path || '');
  for (const [test, pages] of RULES) if (test(m, p)) return pages;
  return null;
}

function isAllowed(access, method, path) {
  if (!access || access.role === 'superadmin') return true;
  const pageIds = Array.isArray(access.pageIds) ? access.pageIds : [];
  if (!pageIds.length) return true;
  const need = requiredPages(method, path);
  return !need || need.some((pg) => pageIds.includes(pg));
}

// Що дозволено ключу проєкту (воронкам): читати зведення й оголошення, запускати синхронізацію. Ключі й налаштування — ні.
const KEY_ALLOWED = [
  ['GET', /^\/(ads|overview|map|bundles|advice|report|sync\/runs|project)(\/|$)/],
  ['POST', /^\/sync\/run$/],
];
const keyAllowed = (method, path) => KEY_ALLOWED.some(([m, re]) => m === String(method).toUpperCase() && re.test(String(path)));

module.exports = { PAGES, RULES, requiredPages, isAllowed, keyAllowed };
