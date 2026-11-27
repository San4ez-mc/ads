// Доба рахується за часом проєкту (Київ), а не за UTC: інакше людина, яка прийшла о 01:00, потрапляла у вчорашній день.
// Дні статистики реклами (InsightDaily.date) уже за часом кабінету й порівнюються датами; тут — межі для подій із моментом часу.
const TZ = 'Europe/Kyiv';

/** «РРРР-ММ-ДД» цього моменту в часовому поясі. */
const localDate = (at = new Date(), tz = TZ) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

function offsetMs(at, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/** Момент, коли в часовому поясі починається ця дата (з урахуванням переходу на літній час). */
function dayStart(ymd, tz = TZ) {
  const utc = Date.parse(`${ymd}T00:00:00Z`);
  const guess = utc - offsetMs(new Date(utc), tz);
  return new Date(utc - offsetMs(new Date(guess), tz));
}

const nextDay = (ymd) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/** Фільтр часу подій за період «з … по …» включно. */
const eventRange = (from, to, tz = TZ) => ({ gte: dayStart(from, tz), lt: dayStart(nextDay(to), tz) });

module.exports = { localDate, dayStart, eventRange };
