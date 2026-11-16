// Шифрування ключів рекламних кабінетів і сайтів (запобіжник 2): AES-256-GCM, ключ лише в .env сервера (ADS_SECRET_KEY, 64 hex).
// У базі лежить "v1:<iv>:<tag>:<data>" у base64. Розшифроване значення не логувати й не віддавати в API.
const crypto = require('node:crypto');

function key() {
  const hex = String(process.env.ADS_SECRET_KEY || '');
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('ADS_SECRET_KEY не задано або не 64 hex-символи');
  return Buffer.from(hex, 'hex');
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(stored) {
  const [v, iv, tag, data] = String(stored || '').split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Невідомий формат збереженого ключа');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/** Для показу в інтерфейсі: лише факт наявності й останні 4 символи. */
function mask(stored) {
  if (!stored) return null;
  try { const p = decrypt(stored); return `…${p.slice(-4)}`; } catch { return '…????'; }
}

/** Прибирає з тексту помилки все схоже на ключ (Meta повертає access_token у повідомленнях про помилку адреси). */
function scrub(text) {
  return String(text || '').replace(/access_token=[^&\s"']+/gi, 'access_token=***').replace(/EAA[A-Za-z0-9]{20,}/g, 'EAA***');
}

module.exports = { encrypt, decrypt, mask, scrub };
