// Канал «Календар» (calendar.fineko.space): записи клієнтів як крок шляху «Записався на час».
// Календар віддає і імена, і телефони, тому тут з відповіді береться ЛИШЕ: номер запису, час створення, статус, джерело.
// Решта (клієнт, телефон, Telegram) відкидається ще до того, як потрапить у базу платформи реклами.
const { scrub } = require('../lib/secrets');

async function call(baseUrl, key, path) {
  const res = await fetch(`${String(baseUrl).replace(/\/+$/, '')}${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) })
    .catch((e) => { throw new Error(`Календар недоступний: ${e.message}`); });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) throw new Error(scrub(json?.error?.message || `Календар відповів HTTP ${res.status}`));
  return json.data;
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

async function check(baseUrl, key) {
  const t = await call(baseUrl, key, '/tenant').catch(() => null);
  const list = await call(baseUrl, key, `/bookings?from=${day(Date.now() - 30 * 86400000)}&to=${day(Date.now() + 60 * 86400000)}&limit=1`);
  return { name: t?.name || 'Календар', bookingsFound: Array.isArray(list) ? list.length : 0 };
}

/** Записи за останні 30 днів і наперед на 120: людина записується заздалегідь, а нас цікавить момент створення запису. */
async function fetchBookings(baseUrl, key) {
  const rows = await call(baseUrl, key, `/bookings?from=${day(Date.now() - 30 * 86400000)}&to=${day(Date.now() + 120 * 86400000)}&limit=500`);
  return (Array.isArray(rows) ? rows : []).map((b) => ({ id: String(b.id), createdAt: b.createdAt, status: b.status, source: String(b.source || '') }));
}

/** Джерело запису з публічної сторінки: «c<код заходу>» (так сторінка отримує його з лендінгу). Усе інше — не реклама. */
const clickIdOf = (source) => { const m = /^c([A-Za-z0-9]{10})$/.exec(String(source || '')); return m ? m[1] : null; };

/** «a<номер оголошення>» — запис із бота, куди людина прийшла прямо з реклами (воронки Flows). */
const adIdOf = (source) => /^a(\d{6,40})$/.exec(String(source || ''))?.[1] || null;

module.exports = { check, fetchBookings, clickIdOf, adIdOf };
