// Розкладка карти: зліва креативи в рамках кампаній, далі елементи шляху з кроками, справа продаж.
// Чиста функція (без React) — щоб її можна було перевіряти окремо.
export const AD_W = 300; export const AD_H = 640; export const GAP = 24;
export const HINT_H = 280; // блок підказок під оголошенням чи елементом шляху (зʼявляється після «Аналізувати»)
export const STEP_W = 280; export const STEP_H = 170; export const STEP_GAP_X = 90; export const STEP_GAP_Y = 36;
const FRAME_PAD = 20; const FRAME_HEAD = 64; const SET_HEAD = 44; const EL_HEAD = 76; const COL_GAP = 260;

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

const hintNode = (id, hints, x, y, w, onAction, extra = {}) => ({ id, type: 'hint', position: { x, y }, draggable: false, selectable: false, data: { hints, onAction }, style: { width: w, height: HINT_H }, ...extra });

export function buildMap(data, selected, advice = null, handlers = {}) {
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
      children.push({ id: `set:${s.id}`, type: 'setLabel', parentId: frameId, extent: 'parent', draggable: false, selectable: false, position: { x: FRAME_PAD, y: innerY }, data: { name: s.name, dailyBudget: s.dailyBudget, learning: s.learningStage === 'LEARNING', audience: s.audience?.text, placements: s.placements?.text, width: w }, style: { width: w, height: SET_HEAD - 8 } });
      innerY += SET_HEAD;
      const rowH = AD_H + GAP + (s.ads.some((a) => advice?.ads[a.externalId]) ? HINT_H + GAP : 0);
      s.ads.forEach((a, i) => {
        const x = FRAME_PAD + (i % cols) * (AD_W + GAP); const ay = innerY + Math.floor(i / cols) * rowH;
        children.push({ id: `ad:${a.externalId}`, type: 'ad', parentId: frameId, extent: 'parent', draggable: false, position: { x, y: ay }, data: { ad: a, target: data.target, picked: !!sel && sel.has(a.externalId), dim: !!sel && !sel.has(a.externalId), onEdit: handlers.onEdit }, style: { width: AD_W, height: AD_H } });
        if (advice?.ads[a.externalId]) children.push(hintNode(`hint:${a.externalId}`, advice.ads[a.externalId], x, ay + AD_H + 12, AD_W, (action) => handlers.onEdit?.(a, action), { parentId: frameId, extent: 'parent' }));
        adPos.set(a.externalId, a);
      });
      innerY += Math.ceil(s.ads.length / cols) * rowH;
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
    const eh = advice?.elements[e.key];
    if (eh) nodes.push(hintNode(`hint:${e.key}`, eh, x, top + height + 16, Math.min(width, 520), null));
    elBottom = Math.max(elBottom, top + height + (eh ? HINT_H + 16 : 0));
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

// ───────────────────────────────────────────────────────────────────────────────────────────────
// План воронок (без реклами): кожна зв'язка — доріжка зліва направо: креативи → кроки шляху → продаж.
// Працює без рекламного кабінету: цифри (люди на кроках, ціна продажу) з'являються, коли є оголошення зв'язки.
const LANE_HEAD = 120; const PLAN_CARD_W = 300; const PLAN_CARD_H = 430; const LANE_GAP = 90; const PATH_GAP = 150;

function frameElement(nodes, e, x, y, pre) {
  const side = e.steps.filter((s) => s.branch === 'side'); const main = e.steps.filter((s) => s.branch !== 'side');
  const orders = [...new Set(main.map((s) => s.order))].sort((a, b) => a - b);
  const rows = Math.max(1, ...orders.map((o) => main.filter((s) => s.order === o).length));
  const cols = Math.max(orders.length, side.length, 1);
  const width = FRAME_PAD * 2 + cols * STEP_W + Math.max(0, cols - 1) * STEP_GAP_X;
  const mainH = rows * STEP_H + (rows - 1) * STEP_GAP_Y;
  const height = EL_HEAD + mainH + (side.length ? STEP_GAP_Y + 30 + STEP_H : 0) + FRAME_PAD;
  const frameId = `${pre}el:${e.key}`;
  nodes.push({ id: frameId, type: 'element', position: { x, y }, draggable: false, selectable: false, data: { element: e }, style: { width, height } });
  const first = main.length ? main.reduce((a, b) => (b.order < a.order ? b : a)) : null;
  const firstPeople = first && first.people !== null ? first.people : null;
  const inner = [];
  side.forEach((s, i) => inner.push({ id: `${pre}st:${e.key}|${s.key}`, type: 'step', parentId: frameId, extent: 'parent', draggable: false, selectable: false, position: { x: FRAME_PAD + i * (STEP_W + STEP_GAP_X), y: EL_HEAD + mainH + STEP_GAP_Y + 30 }, data: { step: s, side: true, people: s.people, unknown: 0, amount: 0, fromPrev: null, fromFirst: firstPeople ? Math.round((s.people / firstPeople) * 1000) / 10 : null }, style: { width: STEP_W, height: STEP_H } }));
  const edges = [];
  for (const s of main) {
    const col = orders.indexOf(s.order); const same = main.filter((q) => q.order === s.order); const row = same.indexOf(s);
    const offset = (rows - same.length) * (STEP_H + STEP_GAP_Y) / 2;
    const prev = prevStep(main, s);
    const id = `${pre}st:${e.key}|${s.key}`;
    const fromPrev = prev && prev.people ? Math.round(((s.people || 0) / prev.people) * 1000) / 10 : null;
    inner.push({ id, type: 'step', parentId: frameId, extent: 'parent', draggable: false, selectable: false, position: { x: FRAME_PAD + col * (STEP_W + STEP_GAP_X), y: EL_HEAD + offset + row * (STEP_H + STEP_GAP_Y) }, data: { step: s, people: s.people, unknown: 0, amount: 0, fromPrev, fromFirst: null }, style: { width: STEP_W, height: STEP_H } });
    if (prev) edges.push({ id: `${pre}e:${id}`, source: `${pre}st:${e.key}|${prev.key}`, target: id, style: { stroke: '#475569', strokeWidth: 1.5 } });
  }
  nodes.push(...inner);
  return { frameId, width, height, edges };
}

export function buildPlanMap(data, advice = null, handlers = {}) {
  const nodes = []; const edges = [];
  let y = 0;
  for (const lane of data.lanes) {
    const pre = `${lane.bundle.id}:`;
    const m = lane.metrics;
    nodes.push({ id: `${pre}lane`, type: 'lane', position: { x: 0, y }, draggable: false, selectable: false, data: { lane, target: data.target, metaConnected: data.metaConnected }, style: { width: 900, height: LANE_HEAD - 20 } });
    const bodyY = y + LANE_HEAD;

    // 1) Креативи: підібрані з контент-платформи (ще не запущені) і вже запущені оголошення зв'язки.
    const left = [];
    lane.ads.forEach((a) => left.push({ kind: 'ad', a }));
    lane.creatives.forEach((c) => left.push({ kind: 'planned', c }));
    if (!left.length) left.push({ kind: 'add' });
    const cols = left.length > 2 ? 2 : 1;
    const rowsN = Math.ceil(left.length / cols);
    const adHints = lane.ads.some((a) => advice?.ads[a.externalId]);
    const cellH = (lane.ads.length ? AD_H + GAP : PLAN_CARD_H + GAP) + (adHints ? HINT_H + GAP : 0);
    const leftNodes = [];
    left.forEach((it, i) => {
      const cx = (i % cols) * (PLAN_CARD_W + GAP); const cy = bodyY + Math.floor(i / cols) * cellH;
      if (it.kind === 'ad') { const id = `${pre}ad:${it.a.externalId}`; nodes.push({ id, type: 'ad', position: { x: cx, y: cy }, draggable: false, data: { ad: it.a, target: data.target, picked: false, dim: false, onEdit: handlers.onEdit }, style: { width: AD_W, height: AD_H } }); leftNodes.push(id);
        if (advice?.ads[it.a.externalId]) nodes.push(hintNode(`${pre}hint:${it.a.externalId}`, advice.ads[it.a.externalId], cx, cy + AD_H + 12, AD_W, (action) => handlers.onEdit?.(it.a, action))); }
      else if (it.kind === 'planned') { const id = `${pre}pc:${it.c.id}`; nodes.push({ id, type: 'planned', position: { x: cx, y: cy }, draggable: false, selectable: false, data: { c: it.c }, style: { width: PLAN_CARD_W, height: PLAN_CARD_H } }); leftNodes.push(id); }
      else { const id = `${pre}add`; nodes.push({ id, type: 'addCreative', position: { x: cx, y: cy }, draggable: false, selectable: false, data: { bundleId: lane.bundle.id, content: data.contentConnected }, style: { width: PLAN_CARD_W, height: 220 } }); leftNodes.push(id); }
    });
    const leftW = cols * PLAN_CARD_W + (cols - 1) * GAP;
    const leftH = rowsN * cellH - GAP;

    // 2) Шлях: елементи (рамки з кроками) і кроки-нотатки по порядку.
    let x = leftW + PATH_GAP; let prevId = null; let maxH = 0; const pathNodes = [];
    for (let i = 0; i < lane.path.length; i += 1) {
      const it = lane.path[i];
      let id; let w; let h;
      if (it.kind === 'element') { const r = frameElement(nodes, it.element, x, bodyY, pre); id = r.frameId; w = r.width; h = r.height; edges.push(...r.edges); }
      else { id = `${pre}note:${i}`; w = 300; h = 150; nodes.push({ id, type: 'note', position: { x, y: bodyY }, draggable: false, selectable: false, data: { note: it.note }, style: { width: w, height: h } }); }
      // Підказки під елементом шляху.
      const eh = it.kind === 'element' ? advice?.elements[it.element.key] : null;
      let hintId = null; const frameH = h;
      if (eh) { hintId = `${pre}hint:el:${it.element.key}`; nodes.push(hintNode(hintId, eh, x, bodyY, Math.min(w, 520), null)); h += HINT_H + 16; }
      pathNodes.push({ id, x, w, h, hintId, frameH });
      if (prevId) edges.push({ id: `${pre}p:${prevId}>${id}`, source: prevId, target: id, style: { stroke: '#8b5cf6', strokeWidth: 2 }, animated: true });
      prevId = id; x += w + PATH_GAP; maxH = Math.max(maxH, h);
    }
    // Вертикальне вирівнювання шляху по центру доріжки.
    const laneBody = Math.max(leftH, maxH, 320);
    for (const pn of pathNodes) {
      const n = nodes.find((q) => q.id === pn.id); n.position.y = bodyY + (laneBody - pn.h) / 2;
      if (pn.hintId) nodes.find((q) => q.id === pn.hintId).position.y = n.position.y + pn.frameH + 16;
    }

    // 3) Продаж зліва направо останнім.
    const saleId = `${pre}sale`;
    nodes.push({ id: saleId, type: 'sale', position: { x, y: bodyY + (laneBody - 300) / 2 }, draggable: false, selectable: false, data: { people: m.hasAds ? m.sales : null, amount: m.revenue, spend: m.spend, cost: m.saleCost, target: data.target }, style: { width: 320, height: 300 } });
    if (prevId) edges.push({ id: `${pre}p:${prevId}>${saleId}`, source: prevId, target: saleId, style: { stroke: '#34d399', strokeWidth: 2 } });

    // 4) Лінії від креативів до першого елемента шляху (пунктир, поки реклама не запущена).
    if (pathNodes.length) for (const id of leftNodes) {
      const launched = id.includes(':ad:');
      const ad = launched ? lane.ads.find((a) => id.endsWith(`:ad:${a.externalId}`)) : null;
      edges.push({ id: `${pre}c:${id}`, source: id, target: pathNodes[0].id, style: { stroke: ad ? (COLOR[ad.verdict] || COLOR.few) : '#64748b', strokeWidth: ad ? 3 : 1.5, strokeDasharray: ad ? undefined : '6 5' } });
    }
    y = bodyY + laneBody + LANE_GAP;
  }
  return { nodes, edges };
}

// Карта креативів: аудиторія (персона) → біль → креативи цього болю; на кожному креативі видно, у яких воронках він стоїть.
export const CM = { audW: 300, audH: 150, painX: 380, painW: 340, painH: 170, crX: 800, crW: 210, crH: 360, crGap: 20, perRow: 6, rowGap: 50, blockGap: 80 };

export function buildCreativeMap(data) {
  const nodes = []; const edges = [];
  const byAud = new Map();
  for (const g of data.groups) { const k = g.audience ? g.audience.name : ''; if (!byAud.has(k)) byAud.set(k, []); byAud.get(k).push(g); }
  let y = 0;
  for (const [aud, groups] of byAud) {
    const top = y; const audId = `aud:${aud || 'none'}`;
    const painIds = [];
    for (const g of groups) {
      const pid = `pain:${aud}:${g.pain ? g.pain.code : 'none'}`;
      const rows = Math.max(1, Math.ceil(g.creatives.length / CM.perRow));
      const blockH = rows * CM.crH + (rows - 1) * CM.crGap;
      nodes.push({ id: pid, type: 'pain', position: { x: CM.painX, y: y + (blockH - CM.painH) / 2 }, draggable: false, selectable: false, data: { pain: g.pain, count: g.creatives.length, inFunnels: g.creatives.filter((c) => c.bundles.length).length }, style: { width: CM.painW, height: CM.painH } });
      painIds.push(pid);
      g.creatives.forEach((c, i) => {
        const id = `cr:${c.id}`;
        nodes.push({ id, type: 'crCard', position: { x: CM.crX + (i % CM.perRow) * (CM.crW + CM.crGap), y: y + Math.floor(i / CM.perRow) * (CM.crH + CM.crGap) }, draggable: false, selectable: false, data: { c }, style: { width: CM.crW, height: CM.crH } });
        if (i === 0) edges.push({ id: `e:${pid}>${id}`, source: pid, target: id, style: { stroke: '#64748b', strokeWidth: 1.5 } });
      });
      y += blockH + CM.rowGap;
    }
    const mid = (top + y - CM.rowGap) / 2;
    nodes.push({ id: audId, type: 'audience', position: { x: 0, y: mid - CM.audH / 2 }, draggable: false, selectable: false, data: { name: aud, pains: groups.length, count: groups.reduce((n, g) => n + g.creatives.length, 0) }, style: { width: CM.audW, height: CM.audH } });
    for (const pid of painIds) edges.push({ id: `e:${audId}>${pid}`, source: audId, target: pid, style: { stroke: '#8b5cf6', strokeWidth: 2 } });
    y += CM.blockGap;
  }
  return { nodes, edges };
}
