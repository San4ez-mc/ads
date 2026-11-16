// Розкладка карти: зліва креативи в рамках кампаній, далі елементи шляху з кроками, справа продаж.
// Чиста функція (без React) — щоб її можна було перевіряти окремо.
export const AD_W = 300; export const AD_H = 520; export const GAP = 24;
export const STEP_W = 280; export const STEP_H = 170; export const STEP_GAP_X = 90; export const STEP_GAP_Y = 36;
const FRAME_PAD = 20; const FRAME_HEAD = 64; const SET_HEAD = 34; const EL_HEAD = 76; const COL_GAP = 260;

export const COLOR = { good: '#34d399', pricey: '#fbbf24', bad: '#f87171', few: '#94a3b8', none: '#94a3b8' };

/** Скільки людей на кроці з урахуванням вибору оголошень (порожній вибір = усі, разом із «джерело невідоме»). */
export function stepPeople(step, selected) {
  if (!selected || !selected.size) return step.total;
  let n = 0; for (const ad of selected) n += step.byAd[ad] || 0; return n;
}
export function stepAmount(step, selected) {
  if (!selected || !selected.size) return step.amount;
  let n = 0; for (const ad of selected) n += step.amountByAd[ad] || 0; return n;
}

/** Попередній крок для підрахунку відсотка: той самий напрямок, якщо є; інакше останній спільний крок перед розгалуженням. */
function prevStep(steps, s) {
  const before = steps.filter((x) => x.order < s.order);
  if (!before.length) return null;
  const same = before.filter((x) => (x.branch || null) === (s.branch || null));
  const common = before.filter((x) => !x.branch);
  const pool = s.branch && same.length ? same : (common.length ? common : before);
  return pool.reduce((a, b) => (b.order > a.order ? b : a));
}

export function buildMap(data, selected) {
  const nodes = []; const edges = [];
  const sel = selected && selected.size ? selected : null;

  // ── Ліва колонка: кампанії → групи → креативи ──
  let y = 0; let leftW = 0; const adPos = new Map();
  for (const c of data.campaigns) {
    const frameId = `camp:${c.id}`;
    let innerY = FRAME_HEAD; let frameW = 0;
    const children = [];
    for (const s of c.adSets) {
      const cols = s.ads.length > 1 ? 2 : 1;
      const w = cols * AD_W + (cols - 1) * GAP;
      children.push({ id: `set:${s.id}`, type: 'setLabel', parentId: frameId, extent: 'parent', draggable: false, selectable: false, position: { x: FRAME_PAD, y: innerY }, data: { name: s.name, dailyBudget: s.dailyBudget, learning: s.learningStage === 'LEARNING', width: w }, style: { width: w, height: SET_HEAD - 8 } });
      innerY += SET_HEAD;
      s.ads.forEach((a, i) => {
        const x = FRAME_PAD + (i % cols) * (AD_W + GAP); const ay = innerY + Math.floor(i / cols) * (AD_H + GAP);
        children.push({ id: `ad:${a.externalId}`, type: 'ad', parentId: frameId, extent: 'parent', draggable: false, position: { x, y: ay }, data: { ad: a, target: data.target, picked: !!sel && sel.has(a.externalId), dim: !!sel && !sel.has(a.externalId) }, style: { width: AD_W, height: AD_H } });
        adPos.set(a.externalId, a);
      });
      innerY += Math.ceil(s.ads.length / cols) * (AD_H + GAP);
      frameW = Math.max(frameW, w);
    }
    const width = frameW + FRAME_PAD * 2; const height = innerY + FRAME_PAD - GAP;
    nodes.push({ id: frameId, type: 'campaign', position: { x: 0, y }, draggable: false, data: { campaign: c, target: data.target, adIds: c.adSets.flatMap((s) => s.ads.map((a) => a.externalId)) }, style: { width, height } });
    nodes.push(...children);
    y += height + 60; leftW = Math.max(leftW, width);
  }
  const leftH = Math.max(0, y - 60);

  // ── Порядок елементів: спершу ті, куди ведуть оголошення, далі ті, куди ведуть кроки ──
  const byKey = new Map(data.elements.map((e) => [e.key, e]));
  const entryKeys = new Set(data.campaigns.flatMap((c) => c.adSets.flatMap((s) => s.ads.map((a) => a.entry))).filter(Boolean));
  const ordered = []; const queue = data.elements.filter((e) => entryKeys.has(e.key)).map((e) => e.key);
  const seen = new Set(); const ghosts = new Map();
  while (queue.length) {
    const k = queue.shift(); if (seen.has(k)) continue; seen.add(k);
    const e = byKey.get(k); if (!e) continue; ordered.push(e);
    for (const s of e.steps) if (s.leadsTo) { if (byKey.has(s.leadsTo)) queue.push(s.leadsTo); else ghosts.set(s.leadsTo, { from: e.key }); }
  }
  for (const e of data.elements) if (!seen.has(e.key)) { ordered.push(e); for (const s of e.steps) if (s.leadsTo && !byKey.has(s.leadsTo)) ghosts.set(s.leadsTo, { from: e.key }); }

  // ── Елементи шляху ──
  let x = leftW + COL_GAP; const firstStepId = new Map(); const saleStepIds = [];
  let salePeople = 0; let saleAmount = 0; let elBottom = 0;
  for (const e of ordered) {
    const side = e.steps.filter((s) => s.branch === 'side'); const main = e.steps.filter((s) => s.branch !== 'side');
    const orders = [...new Set(main.map((s) => s.order))].sort((a, b) => a - b);
    const rows = Math.max(1, ...orders.map((o) => main.filter((s) => s.order === o).length));
    const cols = Math.max(orders.length, side.length, 1);
    const width = FRAME_PAD * 2 + cols * STEP_W + Math.max(0, cols - 1) * STEP_GAP_X;
    const mainH = rows * STEP_H + (rows - 1) * STEP_GAP_Y;
    const height = EL_HEAD + mainH + (side.length ? STEP_GAP_Y + 30 + STEP_H : 0) + FRAME_PAD;
    const frameId = `el:${e.key}`;
    const top = Math.max(0, leftH / 2 - height / 2);
    nodes.push({ id: frameId, type: 'element', position: { x, y: top }, draggable: false, selectable: false, data: { element: e }, style: { width, height } });
    const first = main.length ? main.reduce((a, b) => (b.order < a.order ? b : a)) : null;
    const firstPeople = first ? stepPeople(first, sel) : 0;
    side.forEach((s, i) => {
      const people = stepPeople(s, sel);
      nodes.push({ id: `step:${e.key}|${s.key}`, type: 'step', parentId: frameId, extent: 'parent', draggable: false, selectable: false, position: { x: FRAME_PAD + i * (STEP_W + STEP_GAP_X), y: EL_HEAD + mainH + STEP_GAP_Y + 30 },
        data: { step: s, side: true, people, unknown: 0, amount: 0, fromPrev: null, fromFirst: firstPeople ? Math.round((people / firstPeople) * 1000) / 10 : null }, style: { width: STEP_W, height: STEP_H } });
    });
    for (const s of main) {
      const col = orders.indexOf(s.order); const same = main.filter((q) => q.order === s.order); const row = same.indexOf(s);
      const offset = (rows - same.length) * (STEP_H + STEP_GAP_Y) / 2;
      const id = `step:${e.key}|${s.key}`;
      const people = stepPeople(s, sel); const prev = prevStep(main, s); const prevPeople = prev ? stepPeople(prev, sel) : null;
      nodes.push({ id, type: 'step', parentId: frameId, extent: 'parent', draggable: false, selectable: false, position: { x: FRAME_PAD + col * (STEP_W + STEP_GAP_X), y: EL_HEAD + offset + row * (STEP_H + STEP_GAP_Y) },
        data: { step: s, people, unknown: sel ? 0 : s.unknown, amount: stepAmount(s, sel), fromPrev: prevPeople ? Math.round((people / prevPeople) * 1000) / 10 : null, fromFirst: first && s !== first && firstPeople ? Math.round((people / firstPeople) * 1000) / 10 : null },
        style: { width: STEP_W, height: STEP_H } });
      if (prev) edges.push({ id: `e:${id}`, source: `step:${e.key}|${prev.key}`, target: id, style: { stroke: '#475569', strokeWidth: 1.5 } });
      if (s.isSale) { saleStepIds.push(id); salePeople += people; saleAmount += stepAmount(s, sel); }
    }
    if (first) firstStepId.set(e.key, `step:${e.key}|${first.key}`);
    elBottom = Math.max(elBottom, top + height);
    x += width + 200;
  }

  // ── Куди веде крок далі (інший елемент або ще не підключений) ──
  let gy = elBottom + 60;
  for (const e of ordered) for (const s of e.steps) {
    if (!s.leadsTo) continue;
    const src = `step:${e.key}|${s.key}`;
    if (firstStepId.has(s.leadsTo)) edges.push({ id: `lead:${src}`, source: src, target: firstStepId.get(s.leadsTo), animated: true, style: { stroke: '#8b5cf6', strokeWidth: 1.5 } });
    else if (ghosts.has(s.leadsTo)) {
      const gid = `ghost:${s.leadsTo}`;
      if (!nodes.some((n) => n.id === gid)) { nodes.push({ id: gid, type: 'ghost', position: { x, y: gy }, draggable: false, selectable: false, data: { ref: s.leadsTo }, style: { width: 320, height: 130 } }); gy += 160; }
      edges.push({ id: `lead:${src}`, source: src, target: gid, style: { stroke: '#64748b', strokeWidth: 1.5, strokeDasharray: '6 5' } });
    }
  }

  // ── Продаж ──
  const totalSpend = data.campaigns.reduce((a, c) => a + c.adSets.reduce((b, s) => b + s.ads.filter((ad) => !sel || sel.has(ad.externalId)).reduce((q, ad) => q + ad.spend, 0), 0), 0);
  if (ordered.length) {
    const saleX = x + (ghosts.size ? 320 : 0);
    nodes.push({ id: 'sale', type: 'sale', position: { x: saleX, y: Math.max(0, leftH / 2 - 150) }, draggable: false, selectable: false, data: { people: salePeople, amount: saleAmount, spend: totalSpend, cost: salePeople ? totalSpend / salePeople : null, target: data.target }, style: { width: 320, height: 300 } });
    for (const id of saleStepIds) edges.push({ id: `sale:${id}`, source: id, target: 'sale', style: { stroke: '#34d399', strokeWidth: 2 } });
  }

  // ── Лінії від креативів до входу їхнього шляху; товщина = скільки людей привів, колір = стан ──
  let lost = 0; const maxFlow = Math.max(1, ...[...adPos.values()].map((a) => flow(a, byKey)));
  for (const a of adPos.values()) {
    const target = a.entry && firstStepId.get(a.entry);
    if (!target) { lost += 1; continue; }
    const f = flow(a, byKey);
    edges.push({ id: `ad:${a.externalId}`, source: `ad:${a.externalId}`, target, style: { stroke: COLOR[a.verdict] || COLOR.few, strokeWidth: 1.5 + (f / maxFlow) * 6, opacity: sel && !sel.has(a.externalId) ? 0.12 : 0.9 } });
  }
  if (lost) {
    nodes.push({ id: 'nopath', type: 'ghost', position: { x: leftW + COL_GAP, y: Math.max(elBottom, 0) + (ordered.length ? 60 : 0) + (gy > elBottom + 60 ? gy - elBottom - 60 : 0) }, draggable: false, selectable: false, data: { nopath: lost }, style: { width: 320, height: 130 } });
    for (const a of adPos.values()) if (!(a.entry && firstStepId.get(a.entry))) edges.push({ id: `ad:${a.externalId}`, source: `ad:${a.externalId}`, target: 'nopath', style: { stroke: '#64748b', strokeWidth: 1.5, strokeDasharray: '6 5', opacity: sel && !sel.has(a.externalId) ? 0.12 : 0.8 } });
  }
  // Люди без відомого оголошення — окремим вузлом, а не розмазані по креативах.
  for (const e of ordered) {
    const mainSteps = e.steps.filter((s) => s.branch !== 'side');
    const first = mainSteps.length ? mainSteps.reduce((a, b) => (b.order < a.order ? b : a)) : null;
    if (!sel && first && first.unknown > 0) {
      const id = `unknown:${e.key}`;
      nodes.push({ id, type: 'ghost', position: { x: leftW + 40, y: leftH + 60 }, draggable: false, selectable: false, data: { unknown: first.unknown }, style: { width: 320, height: 130 } });
      edges.push({ id: `u:${id}`, source: id, target: firstStepId.get(e.key), style: { stroke: '#64748b', strokeWidth: 1.5, strokeDasharray: '2 5' } });
      break;
    }
  }
  return { nodes, edges };
}

function flow(a, byKey) {
  const e = a.entry && byKey.get(a.entry);
  const ms = e ? e.steps.filter((s) => s.branch !== 'side') : [];
  if (ms.length) { const first = ms.reduce((x, y) => (y.order < x.order ? y : x)); const n = first.byAd[a.externalId] || 0; if (n) return n; }
  return a.linkClicks || 0;
}
