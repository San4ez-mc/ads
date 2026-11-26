// Правки й версії сайтів: лише людина з підтвердженням, зрозуміла відмова ключа на читання, без дублів, запис у журнал.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
require('dotenv').config({ path: require('node:path').join(__dirname, '../../../.env') });
const { db } = require('@ads/db');
const { encrypt } = require('../src/lib/secrets');
const { keyAllowed, isAllowed } = require('../src/lib/pageAccess');

let project; let hub; let api; const seen = []; const stored = new Map();

test.before(async () => {
  hub = http.createServer((req, res) => {
    let raw = ''; req.on('data', (d) => { raw += d; }).on('end', () => {
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      const key = String(req.headers.authorization || '').replace('Bearer ', '');
      seen.push({ method: req.method, url: req.url, key });
      if (req.url.startsWith('/versions')) return send(200, { ok: true, data: { param: 'v', sites: [{ site: 'lp', name: 'Лендінг', versions: [{ variant: 'b', url: 'https://lp.example/?v=b', name: 'Синя кнопка', status: 'active', changes: [], edit_id: 1 }] }] } });
      if (key !== 'write-key') return send(403, { ok: false, error: { code: 'forbidden', message: 'read only' } });
      const body = JSON.parse(raw);
      const had = stored.get(body.external_id); if (had) return send(200, { ok: true, data: { id: had, status: 'new', duplicate: true } });
      stored.set(body.external_id, stored.size + 1);
      return send(201, { ok: true, data: { id: stored.size, status: 'new', duplicate: false } });
    });
  });
  await new Promise((r) => hub.listen(0, '127.0.0.1', r));
  await db.project.deleteMany({ where: { slug: 'selftest-sites' } });
  project = await db.project.create({ data: { name: 'Самоперевірка сайтів', slug: 'selftest-sites', apiKey: `ads_sites_${Date.now()}` } });
  await db.connection.create({ data: { projectId: project.id, channel: 'site', name: 'Сайти', externalId: `http://127.0.0.1:${hub.address().port}`, secretRead: encrypt('read-key') } });
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.project = project; req.actor = req.header('x-actor') || 'user:1'; next(); });
  app.use(require('../src/routes/sites'));
  app.use(require('../src/middleware/errorHandler'));
  api = app.listen(0, '127.0.0.1'); await new Promise((r) => api.once('listening', r));
});

test.after(async () => { await db.project.deleteMany({ where: { slug: 'selftest-sites' } }); api.closeAllConnections(); hub.closeAllConnections(); await new Promise((r) => api.close(r)); await new Promise((r) => hub.close(r)); await db.$disconnect(); });

const call = (method, path, body, headers) => fetch(`http://127.0.0.1:${api.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));
const edit = { site: 'lp', kind: 'ab', message: 'Зробити кнопку помітнішою' };

test('правки сайтів: підтвердження й людина обовʼязкові; ключ на читання — зрозуміла відмова', async () => {
  assert.strictEqual((await call('POST', '/sites/edits', edit)).status, 400);
  assert.strictEqual((await call('POST', '/sites/edits', { ...edit, confirm: true }, { 'x-actor': 'flows' })).status, 403);
  assert.strictEqual((await call('POST', '/sites/edits', { ...edit, message: 'я'.repeat(4001), confirm: true })).status, 400);
  assert.strictEqual(seen.filter((s) => s.method === 'POST').length, 0, 'до сайтів нічого не пішло');
  const r = await call('POST', '/sites/edits', { ...edit, confirm: true });
  assert.strictEqual(r.json.data.status, 'failed');
  assert.match(r.json.data.message, /Дозволити писати/);
  assert.ok(!keyAllowed('POST', '/sites/edits') && !keyAllowed('GET', '/sites'));
  assert.ok(!isAllowed({ role: 'user', pageIds: ['ads'] }, 'POST', '/sites/edits'));
});

test('правки сайтів: ключ для запису, повтор без дубля, журнал і версії', async () => {
  await db.connection.updateMany({ where: { projectId: project.id }, data: { secretWrite: encrypt('write-key') } });
  const first = (await call('POST', '/sites/edits', { ...edit, confirm: true })).json.data;
  const again = (await call('POST', '/sites/edits', { ...edit, confirm: true })).json.data;
  assert.deepStrictEqual([first.status, first.duplicate, again.duplicate, again.id], ['done', false, true, first.id]);
  assert.strictEqual(await db.actionLog.count({ where: { projectId: project.id, kind: 'site_edit', status: 'done' } }), 1);
  const list = (await call('GET', '/sites')).json.data;
  assert.strictEqual(list.versions[0].versions[0].variant, 'b');
  assert.strictEqual(list.edits[0].message, edit.message);
  assert.strictEqual(seen.filter((s) => s.url.startsWith('/versions')).pop().key, 'read-key', 'читання — ключем на читання');
});
