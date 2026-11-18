// Креативи: бібліотека з контент-платформи, список побажань від рекомендацій, замовлення контент-менеджеру, синхронізація аудиторій.
// Креативи створюються й зберігаються ЛИШЕ в контент-платформі; тут вони тільки показуються й замовляються.
const express = require('express');
const { db } = require('@ads/db');
const { ValidationError } = require('@ads/errors');
const asyncHandler = require('../middleware/asyncHandler');
const c2 = require('../channels/content2');
const { decrypt } = require('../lib/secrets');
const { period } = require('./ads');
const { buildMapData } = require('./map');
const { buildAdvice } = require('../lib/advice');
const { logAction } = require('../services/journal');
const { withPain } = require('../lib/pains');

const router = express.Router();

async function link(project) {
  const conn = await db.connection.findFirst({ where: { projectId: project.id, channel: 'content2', secretRead: { not: null } } });
  if (!conn) throw new ValidationError('Контент-платформу ще не підключено: розділ «Підключення» → «Додати контент-платформу»');
  const pid = conn.config?.projectId || project.content2ProjectId;
  if (!pid) throw new ValidationError('Не вказано проєкт контент-платформи');
  return { url: conn.externalId, key: decrypt(conn.secretRead), pid };
}

const personaText = (p) => [p.pains && `Болі: ${p.pains}`, p.goals && `Цілі: ${p.goals}`, p.triggers && `Що штовхає до покупки: ${p.triggers}`, p.objections && `Заперечення: ${p.objections}`, p.language && `Як говорять: ${p.language}`].filter(Boolean).join('\n');

/** Аудиторії ↔ персони. Хто за що відповідає: «хто це» (болі, цілі, заперечення) — персона в контент-платформі;
 *  «кому показуємо» (країна, вік, інтереси) і статистика — аудиторія тут. Нову аудиторію з платформи реклами створюємо в контент-платформі як персону. */
router.post('/audiences/sync', asyncHandler(async (req, res) => {
  const { url, key, pid } = await link(req.project);
  const personas = await c2.personas(url, key, pid);
  const auds = await db.audience.findMany({ where: { projectId: req.project.id } });
  const byPersona = new Map(auds.filter((a) => a.content2PersonaId).map((a) => [a.content2PersonaId, a]));
  const byName = new Map(auds.filter((a) => !a.content2PersonaId).map((a) => [a.name.trim().toLowerCase(), a]));
  const stats = { pulled: 0, linked: 0, pushed: 0 };
  for (const p of personas) {
    const text = personaText(p);
    const cur = byPersona.get(p.id);
    if (cur) { if (cur.name !== p.name || (cur.description || '') !== text) { await db.audience.update({ where: { id: cur.id }, data: { name: p.name, description: text || cur.description } }); stats.pulled += 1; } continue; }
    const same = byName.get(String(p.name).trim().toLowerCase());
    if (same) { await db.audience.update({ where: { id: same.id }, data: { content2PersonaId: p.id, description: text || same.description } }); stats.linked += 1; continue; }
    await db.audience.create({ data: { projectId: req.project.id, name: p.name, description: text, content2PersonaId: p.id, targeting: { countries: ['UA'] } } });
    stats.pulled += 1;
  }
  for (const a of auds.filter((x) => !x.content2PersonaId && !personas.some((p) => String(p.name).trim().toLowerCase() === x.name.trim().toLowerCase()))) {
    const r = await c2.upsertPersona(url, key, pid, { name: a.name, pains: a.description || undefined });
    // Опис лягає в «Болі» персони; щоб наступна синхронізація не вважала його зміненим, зберігаємо тут ту саму форму.
    await db.audience.update({ where: { id: a.id }, data: { content2PersonaId: r.id, description: a.description ? personaText({ pains: a.description }) : a.description } });
    stats.pushed += 1;
  }
  await logAction(req.project.id, req.actor, 'audiences_sync', { after: stats });
  res.json({ ok: true, data: stats });
}));

router.get('/creatives', asyncHandler(async (req, res) => {
  const { url, key, pid } = await link(req.project);
  res.json({ ok: true, data: { creatives: (await c2.creatives(url, key, pid, Number(req.query.limit) || 60)).map(withPain) } });
}));

/** Побажання до нових креативів, складені з порад: що замінити, що розвинути. Людина може прибрати зайве й дописати своє. */
router.get('/creatives/wishes', asyncHandler(async (req, res) => {
  const map = await buildMapData(req.project, period({}), { all: false });
  const items = buildAdvice(map, { project: req.project, overview: null, connections: [] });
  const byExt = new Map(map.campaigns.flatMap((c) => c.adSets.flatMap((s) => s.ads)).map((a) => [a.externalId, a]));
  const wishes = [];
  for (const i of items) {
    const a = i.ad && byExt.get(i.ad);
    if (!a) continue;
    const snippet = (a.creative.body || a.name || '').slice(0, 90);
    if (i.kind === 'pause' || i.kind === 'no_clicks') wishes.push({ id: `${i.kind}:${i.ad}`, text: `Замінити «${a.name}»: ${i.kind === 'no_clicks' ? 'не чіпляє (переходів нуль)' : 'не окупається'}. Потрібен інший біль або інший перший рядок. Було: «${snippet}»`, preliminary: !!i.preliminary });
    else if (i.kind === 'scale') wishes.push({ id: `scale:${i.ad}`, text: `Зробити 2–3 варіації «${a.name}», бо він працює: інший заголовок і інша картинка, той самий біль. Було: «${snippet}»`, preliminary: !!i.preliminary });
    else if (i.kind === 'funnel') wishes.push({ id: `funnel:${i.ad}`, text: `«${a.name}» приводить людей, які відпадають далі: уточнити в креативі, що саме буде далі (чесніша обіцянка).`, preliminary: !!i.preliminary });
  }
  res.json({ ok: true, data: { wishes } });
}));

const FORMATS = { image: 'картинка 4:5 у стрічку', story: 'сторіз/рілс 9:16', video: 'коротке відео' };

router.post('/creatives/order', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const count = Math.max(1, Math.min(10, Math.round(Number(b.count) || 3)));
  const format = FORMATS[b.format] ? b.format : 'image';
  const extra = String(b.note || '').trim().slice(0, 1500);
  const wishes = (Array.isArray(b.wishes) ? b.wishes : []).map((w) => String(w).trim().slice(0, 400)).filter(Boolean).slice(0, 12);
  let bundle = null; let aud = null;
  if (b.bundleId) {
    bundle = await db.bundle.findFirst({ where: { id: String(b.bundleId), projectId: req.project.id }, include: { audience: true } });
    if (!bundle) throw new ValidationError('Зв\'язку не знайдено');
    aud = bundle.audience;
  } else if (b.audienceId) aud = await db.audience.findFirst({ where: { id: String(b.audienceId), projectId: req.project.id } });
  if (!bundle && !aud && !wishes.length && !extra) throw new ValidationError('Оберіть зв\'язку чи аудиторію або напишіть, що потрібно');
  const lines = [
    `Зроби ${count} рекламн${count === 1 ? 'ий креатив' : count < 5 ? 'і креативи' : 'их креативів'} для Facebook/Instagram (мережа «Реклама FB/IG», meta_ads). Формат: ${FORMATS[format]}.`,
    bundle && `Зв'язка: ${bundle.name}${bundle.code ? ` [${bundle.code}]` : ''}.`,
    bundle?.product && `Продукт: ${bundle.product}.`,
    aud && `Аудиторія: ${aud.name}.${aud.description ? `\n${aud.description}` : ''}`,
    bundle?.promise && `Обіцянка: ${bundle.promise}`,
    bundle?.angle && `Біль / кут: ${bundle.angle}`,
    wishes.length && `Побажання:\n${wishes.map((w) => `• ${w}`).join('\n')}`,
    extra && `Від власника: ${extra}`,
    'Це креативи для реклами: не став їх у чергу публікації в соцмережах. Вони мають пройти перевірку правил реклами. Я затверджу їх на платформі реклами.',
  ].filter(Boolean);
  const text = lines.join('\n');
  const { url, key, pid } = await link(req.project);
  const r = await c2.order(url, key, pid, text, !!b.dryRun);
  if (!b.dryRun) await logAction(req.project.id, req.actor, 'creatives_ordered', { target: bundle ? bundle.name : aud ? aud.name : 'без зв\'язки', after: { count, format, wishes: wishes.length } });
  res.json({ ok: true, data: { ...r, text } });
}));

module.exports = router;
module.exports.link = link;
