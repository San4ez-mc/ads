// Коментарі біля креативів: зберігаються, порожні прибираються, чужий ключ і задовгий текст відхиляються.
const test = require('node:test');
const assert = require('node:assert');
require('dotenv').config({ path: require('node:path').join(__dirname, '../../../.env') });
const { db } = require('@ads/db');
const { keyAllowed } = require('../src/lib/pageAccess');

let project; let api;

test.before(async () => {
  await db.project.deleteMany({ where: { slug: 'selftest-notes' } });
  project = await db.project.create({ data: { name: 'Самоперевірка коментарів', slug: 'selftest-notes', apiKey: `ads_notes_${Date.now()}` } });
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.project = project; req.actor = 'user:1'; next(); });
  app.use(require('../src/routes/notes')); app.use(require('../src/middleware/errorHandler'));
  api = app.listen(0, '127.0.0.1'); await new Promise((r) => api.once('listening', r));
});

test.after(async () => { await db.project.deleteMany({ where: { slug: 'selftest-notes' } }); api.closeAllConnections(); await new Promise((r) => api.close(r)); await db.$disconnect(); });

const call = (method, body) => fetch(`http://127.0.0.1:${api.address().port}/notes`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));

test('коментар біля креативу: запис, зміна, видалення порожнім; перевірка вводу', async () => {
  await call('PUT', { key: 'ad:120252778606070776', text: 'Пишуть бухгалтери' });
  await call('PUT', { key: 'ad:120252778606070776', text: 'Пишуть власники складів' });
  assert.deepStrictEqual((await call('GET')).json.data.notes, { 'ad:120252778606070776': 'Пишуть власники складів' });
  await call('PUT', { key: 'ad:120252778606070776', text: '  ' });
  assert.deepStrictEqual((await call('GET')).json.data.notes, {});
  assert.strictEqual((await call('PUT', { key: '../x', text: 'a' })).status, 400);
  assert.strictEqual((await call('PUT', { key: 'abc', text: 'я'.repeat(2001) })).status, 400);
  assert.ok(!keyAllowed('PUT', '/notes') && !keyAllowed('GET', '/notes'));
});
