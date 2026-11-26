# FINEKO Ads — перший деплой на VPS (ads.fineko.space)

> Сервер `root@173.242.62.180`. Усе нижче робиться ОДИН раз; далі лише `bash deploy.sh` на сервері.
> Порт **4900** (вільний; 4700 CRM, 4800 Правки, 4850 календар). База `fineko_ads` у спільному Postgres.
> Перед початком перевірити диск: `df -h /` (16.11 після чистки було 81%).

## 0. Що потрібно від власника
1. DNS: A-запис `ads.fineko.space` → `173.242.62.180` (додано 16.11).
2. GitHub: порожній репозиторій `San4ez-mc/ads` (локальний уже має коміт: `git remote add origin … && git push -u origin main`).
3. Слово «деплой» (SSO теж перезапускається коротко; воронки Flows не чіпаємо до окремого слова).

## 1. Код і база
```bash
ssh root@173.242.62.180
cd /var/www && git clone https://github.com/San4ez-mc/ads.git ads.fineko.space && cd ads.fineko.space
sudo -u postgres psql -c "CREATE DATABASE fineko_ads"
cp .env.example .env     # заповнити, див. нижче
```
`.env` на проді:
```
PORT=4900
NODE_ENV=production
DATABASE_URL=postgresql://<user>:<pass>@127.0.0.1:5432/fineko_ads
SSO_URL=https://sso.fineko.space
SSO_CLIENT_ID=<з кроку 3>
SSO_CLIENT_SECRET=<з кроку 3>
SSO_REDIRECT_URI=https://ads.fineko.space/auth/callback
ADMIN_BASE_URL=https://ads.fineko.space
ALLOWED_ORIGINS=https://ads.fineko.space
ADS_SECRET_KEY=<openssl rand -hex 32>   # ЗБЕРЕГТИ ОКРЕМО: без нього збережені ключі кабінетів не розшифрувати
META_API_VERSION=v26.0
```
Далі: `bash deploy.sh`, потім `node scripts/seed-fineko.js` (проєкт FINEKO, 3 аудиторії, шлях, 8 зв'язок-чернеток; повторний запуск безпечний).

## 2. nginx + SSL
```bash
cp deploy/nginx-ads.conf /etc/nginx/sites-available/ads.fineko.space
ln -s /etc/nginx/sites-available/ads.fineko.space /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d ads.fineko.space
```
Пастка: повторне копіювання конфіга затирає SSL-блок certbot — після цього знову `certbot --nginx`.

## 3. SSO
1. `POST https://sso.fineko.space/admin/clients` (`x-admin-key`) тіло `{"name":"ads","redirectUris":["https://ads.fineko.space/auth/callback"]}` → clientId/secret у `.env`.
2. Задеплоїти SSO з рядком продукту `ads` (є в `SSO/src/index.ts`, не закомічено): `git pull && pm2 restart sso`. У `.env` SSO: `ADS_URL=http://127.0.0.1:4900`.
3. У панелі доступів SSO видати собі superadmin у продукті «Реклама».

## 4. Flows (окремо, лише після слова «деплой» для Flows)
Гілка `ads-source-2026-11-16` (коміт 90d35a1): хвіст `__c<код>` / `__a<номер>` у посиланні на бота, колонки джерела в `funnel_stage_events`, `/api/ads-feed`. Перед викладанням: бекап БД Flows, у `.env` Flows додати `ADS_FEED_KEY=<openssl rand -hex 24>`, `bash scripts/deploy.sh` (вікно 21:00–08:00 Київ). Старі посилання не змінюються (тест `scripts/qa/test-ad-source-2026-11-16.js`).

## 5. Перевірка
`curl https://ads.fineko.space/health`, вхід через FINEKO, «Підключення» → «Додати кабінет Meta» (інструкція в майстрі).

## Відкат
`pm2 stop ads-api` — решта екосистеми не залежить від платформи реклами.
