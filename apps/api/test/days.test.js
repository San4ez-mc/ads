// Межі доби за Києвом: нічні події — у свій день; літній і зимовий час; поради про застарілі дані реклами.
const test = require('node:test');
const assert = require('node:assert');
const { localDate, dayStart, eventRange } = require('../src/lib/days');
const { buildAdvice, dailyReportText } = require('../src/lib/advice');

test('подія о 01:34 за Києвом належить новому дню; зима +2, літо +3', () => {
  const lead = new Date('2026-11-26T23:34:23Z');
  assert.strictEqual(localDate(lead), '2026-11-27');
  const today = eventRange('2026-11-27', '2026-11-27');
  assert.ok(lead >= today.gte && lead < today.lt);
  assert.strictEqual(dayStart('2026-11-27').toISOString(), '2026-11-26T22:00:00.000Z');
  assert.strictEqual(dayStart('2026-07-01').toISOString(), '2026-06-30T21:00:00.000Z');
});

test('пауза звернень: порада й звіт кажуть, що цифри реклами застаріли, і показують, хто прийшов', () => {
  const map = { campaigns: [], elements: [], target: 1500 };
  const items = buildAdvice(map, { connections: [{ name: 'К', status: 'error', config: { paused: true }, lastSyncAt: '2026-11-26T13:36:43Z' }] });
  assert.ok(items[0].title.includes('не оновлюються') && items[0].text.includes('26.11'));
  const text = dailyReportText({ name: 'П' }, '2026-11-27', { spend: 0, linkClicks: 0, sales: 0, revenue: 0 }, items, [], [{ name: 'Ден', people: 1 }]);
  assert.ok(text.includes('Прийшли з реклами: Ден') && text.includes('не оновлюються'));
});
