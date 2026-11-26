// FINEKO Ads API — Express, CommonJS, той самий стиль, що CRM і календар.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const { db } = require('@ads/db');
const logger = require('@ads/logger');

const errorHandler = require('./middleware/errorHandler');
const asyncHandler = require('./middleware/asyncHandler');
const { resolveProject } = require('./middleware/resolveProject');

const authSsoRouter = require('./routes/auth-sso');
const projects = require('./routes/projects');
const connectionsRouter = require('./routes/connections');
const adsRouter = require('./routes/ads');
const mapRouter = require('./routes/map');
const bundlesRouter = require('./routes/bundles');
const adviceRouter = require('./routes/advice');
const creativesRouter = require('./routes/creatives');
const actionsRouter = require('./routes/actions');
const clientsRouter = require('./routes/clients');
const planRouter = require('./routes/plan');
const launchesRouter = require('./routes/launches');

const app = express();
const PORT = Number(process.env.PORT || 4900);
app.set('trust proxy', 1);

// Креативи показуються з адрес Meta (картинки, мініатюри) і з контент-платформи (картинки й відео креативів), тому img-src і media-src ширші; решта — лише свій origin.
const C2_ORIGIN = process.env.CONTENT2_ORIGIN || 'https://content2.fineko.space';
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'https://*.fbcdn.net', 'https://*.facebook.com', 'https://*.cdninstagram.com', C2_ORIGIN], mediaSrc: ["'self'", 'https://*.fbcdn.net', C2_ORIGIN], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"] } },
  crossOriginResourcePolicy: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
// Воронки звертаються server-to-server (без cookie); адмінка — той самий origin. Cookie-запити з чужих origin відхиляємо.
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)), credentials: true }));
// Зміни через cookie-сесію приймаються лише зі свого origin (захист від підробки запиту з чужого сайту).
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.header('authorization')) return next();
  const origin = req.header('origin');
  if (origin && !ALLOWED_ORIGINS.includes(origin) && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Чужий origin' } });
  next();
});

app.get('/health', asyncHandler(async (req, res) => {
  const projectsCount = await db.project.count().catch(() => -1);
  res.json({ ok: true, service: 'fineko-ads-api', projects: projectsCount });
}));

app.use(authSsoRouter);
app.use('/api', projects.admin);
app.use('/api', resolveProject, projects.scoped, connectionsRouter, adsRouter, mapRouter, bundlesRouter, adviceRouter, creativesRouter, actionsRouter, clientsRouter, planRouter, launchesRouter);

// Продакшн: зібрана адмінка (npm run build:admin → public/admin) роздається цим же процесом.
const ADMIN_DIST = path.join(__dirname, '../../../public/admin');
app.use(express.static(ADMIN_DIST));
app.get('*', (req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path === '/me' || req.path === '/health') return next();
  res.sendFile(path.join(ADMIN_DIST, 'index.html'), (err) => { if (err) next(); });
});

app.use((req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.path}` } }));
app.use(errorHandler);

if (require.main === module) app.listen(PORT, () => logger.info(`FINEKO Ads API listening on :${PORT}`));
module.exports = app;
