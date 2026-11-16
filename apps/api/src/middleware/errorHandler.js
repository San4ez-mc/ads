// Єдиний error-middleware. Відповідь завжди { ok:false, error:{code,message,context?} }.
const { AuthError, ForbiddenError, NotFoundError, ValidationError, ConflictError, AdsError } = require('@ads/errors');
const logger = require('@ads/logger');

module.exports = function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AuthError) return res.status(401).json({ ok: false, error: { code: err.code, message: err.message } });
  if (err instanceof ForbiddenError) return res.status(403).json({ ok: false, error: { code: err.code, message: err.message } });
  if (err instanceof NotFoundError) return res.status(404).json({ ok: false, error: { code: err.code, message: err.message } });
  if (err instanceof ValidationError) return res.status(400).json({ ok: false, error: { code: err.code, message: err.message, context: err.context } });
  if (err instanceof ConflictError) return res.status(409).json({ ok: false, error: { code: err.code, message: err.message, context: err.context } });
  if (err instanceof AdsError) {
    logger.error('Ads error', { message: err.message, code: err.code, context: err.context });
    return res.status(500).json({ ok: false, error: { code: err.code, message: err.message } });
  }
  if (err && err.code === 'P2002') return res.status(409).json({ ok: false, error: { code: 'CONFLICT', message: 'Duplicate value', context: { fields: err.meta?.target } } });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } });
  logger.error('Unhandled error', { message: err && err.message, stack: err && err.stack });
  res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
