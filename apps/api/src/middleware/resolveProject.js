// Єдина точка авторизації бізнес-роутів. Два шляхи:
//   1) Authorization: Bearer <project.apiKey> — воронка Flows; лише читання і запуск синхронізації (pageAccess.keyAllowed).
//   2) ads_session cookie (SSO access_token)   — людина; проєкт із ?projectId=, права з SSO /oauth/permissions.
const { db } = require('@ads/db');
const { AuthError, ForbiddenError, NotFoundError } = require('@ads/errors');
const asyncHandler = require('./asyncHandler');
const ssoClient = require('../lib/ssoClient');
const { isAllowed, keyAllowed } = require('../lib/pageAccess');

function bearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.header('authorization') || '');
  return match ? match[1].trim() : '';
}

/** Хто зайшов (SSO-сесія) і які в нього права. Кидає AuthError, якщо сесії нема. */
async function sessionIdentity(req) {
  const token = req.cookies?.ads_session;
  if (!token) throw new AuthError('Не автентифіковано — увійдіть через SSO');
  const identity = await ssoClient.introspect(token);
  if (!identity.active) throw new AuthError('Сесія недійсна або протерміновано');
  const perms = await ssoClient.getPermissions(identity.sub);
  return { identity, perms };
}

const resolveProject = asyncHandler(async (req, res, next) => {
  const apiKey = bearer(req);
  if (apiKey) {
    const project = await db.project.findUnique({ where: { apiKey } });
    if (!project) throw new AuthError('Невідомий ключ проєкту');
    if (!keyAllowed(req.method, req.path)) throw new ForbiddenError('Ключ проєкту не дає доступу до цієї дії');
    req.project = project; req.authMethod = 'project-api-key'; req.actor = 'flows';
    req.access = { role: 'key', canEdit: false, pageIds: [] };
    return next();
  }

  const { identity, perms } = await sessionIdentity(req);
  req.user = { id: identity.sub, email: identity.email, name: identity.name };
  const projectId = req.query.projectId;
  if (!projectId) throw new ForbiddenError('projectId обовʼязковий (query)');
  const allowed = perms.role === 'superadmin' || (perms.role === 'user' && (perms.projectIds || []).includes(projectId));
  if (!allowed) throw new ForbiddenError('Немає доступу до цього проєкту');
  const project = await db.project.findUnique({ where: { id: String(projectId) } });
  if (!project) throw new NotFoundError('Project', projectId);

  req.project = project; req.authMethod = 'sso-session'; req.actor = `user:${identity.sub}`;
  req.access = { role: perms.role, canEdit: perms.canEdit !== false, pageIds: Array.isArray(perms.pageIds) ? perms.pageIds : [] };
  if (!isAllowed(req.access, req.method, req.path)) throw new ForbiddenError('Немає доступу до цього розділу');
  if (req.method !== 'GET' && req.access.canEdit === false && req.access.role !== 'superadmin') throw new ForbiddenError('Лише перегляд: редагувати не дозволено');
  next();
});

module.exports = { resolveProject, sessionIdentity, bearer };
