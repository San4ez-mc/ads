// Локальна підготовка для розробки: реєструє OAuth-клієнта "ads" у ЛОКАЛЬНОМУ SSO, створює тестового користувача
// з доступом суперадміна до продукту ads і дописує SSO_CLIENT_ID/SECRET у .env. Тестовий вхід зберігається в .dev-user.json (у git не йде).
// Запуск: node scripts/dev-setup.js   (SSO має працювати на http://localhost:4600)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const readEnv = (file) => Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
const SSO = process.env.SSO_URL || readEnv(path.join(__dirname, '..', '.env')).SSO_URL || 'http://localhost:4600';

async function j(method, url, body, headers = {}) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

(async () => {
  const adminKey = readEnv(path.join(ROOT, '../SSO/.env')).ADMIN_API_KEY;
  if (!adminKey) throw new Error('У SSO/.env нема ADMIN_API_KEY');
  const admin = { 'x-admin-key': adminKey };
  const envPath = path.join(ROOT, '.env');
  let env = fs.readFileSync(envPath, 'utf8');

  if (!/^SSO_CLIENT_SECRET=.+/m.test(env)) {
    const c = await j('POST', `${SSO}/admin/clients`, { name: 'ads', redirectUris: ['http://localhost:4900/auth/callback'] }, admin);
    if (!c.data.clientId) throw new Error(`Не вдалося створити клієнта: ${c.status} ${JSON.stringify(c.data)}`);
    env = env.replace(/^SSO_CLIENT_ID=.*$/m, `SSO_CLIENT_ID=${c.data.clientId}`).replace(/^SSO_CLIENT_SECRET=.*$/m, `SSO_CLIENT_SECRET=${c.data.clientSecret}`);
    fs.writeFileSync(envPath, env);
    console.log('OAuth-клієнт ads створено, .env оновлено');
  } else console.log('OAuth-клієнт уже прописаний у .env');

  const userFile = path.join(ROOT, '.dev-user.json');
  let dev = fs.existsSync(userFile) ? JSON.parse(fs.readFileSync(userFile, 'utf8')) : null;
  if (!dev) {
    dev = { email: `ads-dev-${crypto.randomBytes(3).toString('hex')}@fineko.test`, password: crypto.randomBytes(12).toString('base64url') };
    const r = await j('POST', `${SSO}/register`, { email: dev.email, password: dev.password, displayName: 'Ads dev' });
    if (!r.data.user?.id) throw new Error(`Не вдалося створити користувача: ${r.status} ${JSON.stringify(r.data)}`);
    dev.userId = r.data.user.id;
    fs.writeFileSync(userFile, JSON.stringify(dev, null, 2));
    console.log('Тестового користувача створено:', dev.email);
  }
  const a = await j('PUT', `${SSO}/admin/access`, { userId: dev.userId, product: 'ads', role: 'superadmin', projectIds: [], pageIds: [] }, admin);
  console.log('Доступ суперадміна до ads:', a.status === 200 ? 'видано' : `помилка ${a.status} ${JSON.stringify(a.data)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
