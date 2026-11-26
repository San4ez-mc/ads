import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, useStore } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import clsx from 'clsx';
import { api, fmt } from '../api/client';
import { buildMap, buildPlanMap, buildCreativeMap, COLOR } from '../lib/mapLayout';
import { EditAdModal, HintNode, HintList } from '../components/MapActions';
import { useAuthStore } from '../stores/authStore';

const PERIODS = [{ d: 1, label: 'Сьогодні' }, { d: 7, label: '7 днів' }, { d: 14, label: '14 днів' }, { d: 30, label: '30 днів' }];
const range = (days) => { const to = new Date(); const from = new Date(to.getTime() - (days - 1) * 86400000); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }; };
const STATUS = { ACTIVE: 'крутиться', PAUSED: 'вимкнено', ADSET_PAUSED: 'групу вимкнено', CAMPAIGN_PAUSED: 'кампанію вимкнено', PENDING_REVIEW: 'на перевірці', DISAPPROVED: 'відхилено', WITH_ISSUES: 'є проблеми' };
const TYPE = { site: 'Сайт', flows: 'Бот (Flows)', calendar: 'Календар', instagram: 'Instagram', manual: 'Вручну' };
const zoomSel = (s) => s.transform[2];
const hidden = { opacity: 0, width: 1, height: 1, border: 0 };

function Chip({ v, children }) {
  return <span className="text-[11px] px-2 py-0.5 rounded-md whitespace-nowrap" style={{ background: `${COLOR[v]}26`, color: COLOR[v] }}>{children}</span>;
}

function AdNode({ data }) {
  const zoom = useStore(zoomSel);
  const a = data.ad; const img = a.creative.imageUrl || a.creative.thumbnailUrl;
  const far = zoom < 0.32;
  return (
    <div className={clsx('h-full w-full rounded-xl overflow-hidden bg-slate-900 border-2 flex flex-col cursor-pointer transition-opacity', data.dim && 'opacity-30')} style={{ borderColor: data.picked ? '#c4b5fd' : `${COLOR[a.verdict]}99` }} title={a.creative.body || a.name}>
      {far ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4" style={{ background: `${COLOR[a.verdict]}22` }}>
          <div className="text-[44px] leading-tight font-medium" style={{ color: COLOR[a.verdict] }}>{a.saleCost ? fmt.money(a.saleCost) : a.verdictLabel}</div>
          <div className="text-[30px] text-slate-300 mt-3">{a.sales} продаж · {fmt.money(a.spend)}</div>
          <div className="text-[26px] text-slate-400 mt-3 line-clamp-2">{a.name}</div>
        </div>
      ) : (
        <>
          <div className="h-[375px] bg-slate-950 flex items-center justify-center shrink-0">
            {img ? <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} className="max-h-full max-w-full object-contain" /> : <div className="px-6 text-center text-sm text-slate-400 leading-relaxed">{a.creative.body || 'Креатив без зображення'}</div>}
          </div>
          <div className="p-3 flex-1 flex flex-col gap-2 min-h-0">
            <div className="flex items-start gap-2">
              <div className="text-sm font-medium leading-snug line-clamp-2 flex-1">{a.name}</div>
              <Chip v={a.verdict}>{a.verdictLabel}</Chip>
            </div>
            <div className="grid grid-cols-3 gap-x-2 text-[11px] text-slate-400 mt-auto">
              <div>Витрачено<div className="text-sm text-slate-100">{fmt.money(a.spend)}</div></div>
              <div>Переходи<div className="text-sm text-slate-100">{fmt.int(a.linkClicks)}{a.cpc ? <span className="text-[11px] text-slate-400"> · {Math.round(a.cpc)} грн</span> : null}</div></div>
              <div>Продаж<div className="text-sm" style={{ color: COLOR[a.verdict] }}>{a.sales ? `${a.sales} · ${fmt.money(a.saleCost)}` : '0'}</div>{a.upsellCount > 0 && <div className="text-[11px] text-violet-300">далі: {a.upsellCount} · {fmt.money(a.upsellRevenue)}</div>}</div>
            </div>
            <div className="text-[11px] leading-snug border-t border-slate-800 pt-2">
              <div className="line-clamp-2" title={a.audience?.text}><span className="text-slate-500">Кому: </span><span className="text-slate-300">{a.audience?.text || 'немає даних'}</span></div>
              <div className="line-clamp-2 mt-0.5" title={a.placements?.text}><span className="text-slate-500">Де: </span><span className="text-slate-300">{a.placements?.text || 'немає даних'}</span></div>
            </div>
            <div className="text-[11px] text-slate-500">{STATUS[a.effectiveStatus] || a.effectiveStatus || '—'}</div>
            {data.onEdit && <button type="button" style={{ pointerEvents: 'all' }} className="nodrag nopan btn-primary !py-1.5 w-full" onClick={(e) => { e.stopPropagation(); data.onEdit(a); }}>Внести правки</button>}
          </div>
        </>
      )}
      <Handle type="source" position={Position.Right} style={hidden} />
    </div>
  );
}

function CampaignNode({ data }) {
  const c = data.campaign;
  return (
    <div className="h-full w-full rounded-2xl border border-dashed border-slate-600 bg-slate-900/30">
      <div className="px-5 pt-3 cursor-pointer" title="Клік — показати шлях лише для цієї кампанії">
        <div className="text-xl font-medium truncate">{c.name}</div>
        <div className="text-sm text-slate-400 truncate">витрачено {fmt.money(c.spend)} · продажів {c.sales} · ціна продажу <span style={{ color: COLOR[c.verdict] }}>{fmt.money(c.saleCost)}</span></div>
      </div>
    </div>
  );
}

function SetLabel({ data }) {
  const about = [data.audience, data.placements].filter(Boolean).join(' | ');
  return (
    <div className="text-xs text-slate-400 leading-tight">
      <div className="truncate">Група: <span className="text-slate-200">{data.name}</span>{data.dailyBudget ? ` · ${data.dailyBudget} на день` : ''}{data.learning ? ' · навчається' : ''}</div>
      {about && <div className="truncate text-[10px]" title={about}>{about}</div>}
    </div>
  );
}

function ElementNode({ data }) {
  const e = data.element;
  return (
    <div className="h-full w-full rounded-2xl border border-slate-700 bg-slate-900/40">
      <Handle type="target" position={Position.Left} style={hidden} />
      <Handle type="source" position={Position.Right} style={hidden} />
      <div className="px-5 pt-4"><span className="text-base text-brand-light mr-3">{TYPE[e.type] || e.type}</span><span className="text-2xl font-medium">{e.name}</span>{e.domain && <span className="text-base text-slate-500 ml-3">{e.domain}</span>}</div>
    </div>
  );
}

function StepNode({ data }) {
  const s = data.step;
  return (
    <div className={clsx('h-full w-full rounded-2xl border-2 px-5 py-4 flex flex-col', s.isSale ? 'border-emerald-600 bg-emerald-950/50' : data.side ? 'border-dashed border-slate-700 bg-slate-900/60' : 'border-slate-600 bg-slate-900')}>
      <Handle type="target" position={Position.Left} style={hidden} />
      <div className="text-lg text-slate-300 truncate">{s.title}</div>
      <div className="text-5xl font-medium leading-tight mt-1">{data.people === null || data.people === undefined ? '—' : fmt.int(data.people)}{data.people !== null && data.people !== undefined && <span className="text-base text-slate-400 font-normal"> людей</span>}</div>
      <div className="text-base text-slate-400 mt-auto">
        {data.people === null || data.people === undefined ? (data.side ? 'бічний вихід · ще нема даних' : 'ще нема даних') : data.side ? (data.fromFirst !== null ? <>бічний вихід · {data.fromFirst}% від входу</> : 'бічний вихід') : data.fromPrev !== null ? <>{data.fromPrev}% від попереднього</> : 'вхід'}
        {s.isSale && data.amount ? <> · {fmt.money(data.amount)}</> : null}
      </div>
      <Handle type="source" position={Position.Right} style={hidden} />
    </div>
  );
}

function GhostNode({ data }) {
  let head; let text;
  if (data.unknown) { head = `${fmt.int(data.unknown)} людей`; text = 'Джерело невідоме: прийшли без номера оголошення'; }
  else if (data.nopath) { head = 'Шлях не визначено'; text = `${data.nopath} оголошень ведуть туди, звідки ще нема даних`; }
  else { head = String(data.ref).replace(/^flows:/, 'Бот: ').replace(/^calendar:/, 'Календар: ').replace(/^site:/, 'Сайт: '); text = 'Ще не підключено — кроки далі не видно'; }
  return (
    <div className="h-full w-full rounded-2xl border-2 border-dashed border-slate-600 bg-slate-900/60 px-5 py-4">
      <Handle type="target" position={Position.Left} style={hidden} />
      <div className="text-xl font-medium truncate">{head}</div>
      <div className="text-base text-slate-400 leading-snug mt-2">{text}</div>
      <Handle type="source" position={Position.Right} style={hidden} />
    </div>
  );
}

function SaleNode({ data }) {
  const tone = data.cost && data.target ? (data.cost <= data.target ? COLOR.good : data.cost <= data.target * 1.5 ? COLOR.pricey : COLOR.bad) : '#e2e8f0';
  return (
    <div className="h-full w-full rounded-3xl border-2 border-emerald-600 bg-emerald-950/60 p-6 flex flex-col">
      <Handle type="target" position={Position.Left} style={hidden} />
      <div className="text-xl text-emerald-200">Продаж</div>
      <div className="text-6xl font-medium leading-tight">{data.people === null || data.people === undefined ? '—' : fmt.int(data.people)}</div>
      <div className="text-lg text-slate-300">на {fmt.money(data.amount)}</div>
      <div className="mt-auto text-base text-slate-400">ціна продажу</div>
      <div className="text-4xl font-medium" style={{ color: tone }}>{fmt.money(data.cost)}</div>
      <div className="text-base text-slate-400">{data.target ? `ціль ${fmt.money(data.target)}` : 'ціль не задано'}</div>
    </div>
  );
}

const STATUS_NAME = { draft: 'чернетка', test: 'тест', works: 'працює', scale: 'масштабуємо', fails: 'не працює' };

function LaneNode({ data }) {
  const { lane, target, metaConnected } = data; const b = lane.bundle; const m = lane.metrics;
  return (
    <div className="h-full w-full rounded-2xl border border-slate-700 bg-slate-900/70 px-5 py-3 flex flex-col justify-center gap-1">
      <div className="flex items-center gap-3">
        {b.code && <span className="text-sm px-2 py-0.5 rounded bg-slate-800 text-slate-200">[{b.code}]</span>}
        <span className="text-2xl font-medium">{b.name}</span>
        <span className="text-sm px-2 py-0.5 rounded bg-brand/20 text-brand-light">{STATUS_NAME[b.status] || b.status}</span>
      </div>
      <div className="text-base text-slate-400 truncate">{b.hypothesis || b.promise || ''}</div>
      <div className="flex items-center gap-4 text-sm text-slate-400">
        {b.audience && <span>Аудиторія: <span className="text-slate-200">{b.audience.name}</span></span>}
        <span>{m.hasAds ? `Витрачено ${fmt.money(m.spend)} · продажів ${m.sales}` : metaConnected ? 'Оголошень зв\'язки ще нема' : 'Цифри реклами зʼявляться після підключення кабінету'}</span>
        <Link to={'/creatives?bundle=' + b.id} className="text-brand-light hover:underline ml-auto">Замовити креативи</Link>
        <Link to="/bundles" className="text-brand-light hover:underline">Редагувати зв'язку</Link>
      </div>
    </div>
  );
}

function PlannedNode({ data }) {
  const c = data.c; const img = c.mediaUrl;
  return (
    <div className="h-full w-full rounded-xl overflow-hidden bg-slate-900 border-2 border-dashed border-slate-600 flex flex-col">
      <div className="h-[300px] bg-slate-950 flex items-center justify-center shrink-0">
        {img && c.mediaType === 'image' ? <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} className="max-h-full max-w-full object-contain" /> : img && c.mediaType === 'video' ? <video src={img} muted playsInline preload="metadata" className="max-h-full max-w-full object-contain" /> : <div className="px-6 text-center text-sm text-slate-400">{c.mediaType === 'video' ? 'Відео' : 'Зображення ще створюється'}</div>}
      </div>
      <div className="p-3 flex-1 min-h-0">
        <div className="flex items-center gap-2"><span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">№{c.number}</span><span className="text-[11px] text-slate-500">не запущено в рекламі</span></div>
        <div className="text-sm font-medium leading-snug mt-1 line-clamp-2">{c.hook || c.topic || 'Без заголовка'}</div>
      </div>
      <Handle type="source" position={Position.Right} style={hidden} />
    </div>
  );
}

function AddCreativeNode({ data }) {
  return (
    <div className="h-full w-full rounded-xl border-2 border-dashed border-slate-600 bg-slate-900/40 p-5 flex flex-col items-center justify-center text-center gap-3">
      <Handle type="source" position={Position.Right} style={hidden} />
      <div className="text-lg text-slate-300">Креативи ще не додано</div>
      <div className="text-sm text-slate-500">{data.content ? 'Оберіть готові з контент-платформи у зв\'язці або замовте нові.' : 'Підключіть контент-платформу, щоб підбирати креативи.'}</div>
      <div className="flex gap-3 text-sm"><Link className="text-brand-light hover:underline" to={'/creatives?bundle=' + data.bundleId}>Замовити</Link><Link className="text-brand-light hover:underline" to="/bundles">Підібрати</Link></div>
    </div>
  );
}

function NoteNode({ data }) {
  return (
    <div className="h-full w-full rounded-2xl border-2 border-dashed border-slate-600 bg-slate-900/40 px-5 py-4 flex flex-col justify-center">
      <Handle type="target" position={Position.Left} style={hidden} />
      <Handle type="source" position={Position.Right} style={hidden} />
      <div className="text-sm text-slate-500 mb-1">Крок без підключених даних</div>
      <div className="text-lg text-slate-200">{data.note || 'Без опису'}</div>
    </div>
  );
}

function AudienceNode({ data }) {
  return (
    <div className="h-full w-full rounded-2xl border border-brand/50 bg-brand/10 px-5 py-3 flex flex-col justify-center">
      <Handle type="source" position={Position.Right} style={hidden} />
      <div className="text-xs uppercase tracking-wide text-brand-light mb-1">Аудиторія</div>
      <div className="text-2xl font-medium leading-tight">{data.name || 'Біль не визначено'}</div>
      <div className="text-sm text-slate-400 mt-1">{data.pains} {data.pains === 1 ? 'біль' : 'болі'} · {data.count} креативів</div>
    </div>
  );
}

function PainNode({ data }) {
  const p = data.pain;
  return (
    <div className="h-full w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-5 py-3 flex flex-col justify-center">
      <Handle type="target" position={Position.Left} style={hidden} />
      <Handle type="source" position={Position.Right} style={hidden} />
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Біль</div>
      <div className="text-lg font-medium leading-snug">{p ? p.title : 'Біль у тексті не визначено'}</div>
      {p && p.planned
        ? <div className="text-sm text-slate-400 mt-1">Креативів ще нема · <Link className="text-brand-light hover:underline" to={'/creatives?note=' + encodeURIComponent(p.orderNote || '')}>Замовити</Link></div>
        : <div className="text-sm text-slate-400 mt-1">{data.count} креативів · у воронках: {data.inFunnels}</div>}
    </div>
  );
}

function CreativeCardNode({ data }) {
  const c = data.c;
  return (
    <div className="h-full w-full rounded-xl overflow-hidden bg-slate-900 border border-slate-700 flex flex-col">
      <Handle type="target" position={Position.Left} style={hidden} />
      <div className="h-[240px] bg-slate-950 flex items-center justify-center shrink-0">
        {c.mediaUrl && c.mediaType === 'image' ? <img src={c.mediaUrl} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} className="max-h-full max-w-full object-contain" /> : c.mediaUrl && c.mediaType === 'video' ? <video src={c.mediaUrl} muted playsInline preload="metadata" className="max-h-full max-w-full object-contain" /> : <div className="px-4 text-center text-sm text-slate-400">{c.mediaType === 'video' ? 'Відео' : 'Зображення ще створюється'}</div>}
      </div>
      <div className="p-2 flex-1 min-h-0 overflow-hidden">
        <div className="flex items-center gap-1.5"><span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">№{c.number}</span>{c.mediaType === 'video' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">відео</span>}</div>
        <div className="text-xs text-slate-300 leading-snug mt-1 line-clamp-2">{c.hook || c.text}</div>
        <div className="mt-1 flex flex-wrap gap-1">{c.bundles.length ? c.bundles.map((b) => <span key={b.id} className="text-[11px] px-1.5 py-0.5 rounded bg-brand/20 text-brand-light">{b.code ? `[${b.code}]` : b.name}</span>) : <span className="text-[11px] text-slate-500">ще не в воронці</span>}</div>
      </div>
    </div>
  );
}

const nodeTypes = { hint: HintNode, audience: AudienceNode, pain: PainNode, crCard: CreativeCardNode, ad: AdNode, campaign: CampaignNode, setLabel: SetLabel, element: ElementNode, step: StepNode, ghost: GhostNode, sale: SaleNode, lane: LaneNode, planned: PlannedNode, addCreative: AddCreativeNode, note: NoteNode };

/** Кнопка «Аналізувати» і стан вікна правок — спільні для обох карт з цифрами. */
function useMapTools(query, reload) {
  const canApprove = useAuthStore((s) => s.can('approve'));
  const [advice, setAdvice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(null); // { ad, preset }
  const key = JSON.stringify(query);
  useEffect(() => { setAdvice(null); setError(''); }, [key]);
  const analyze = async () => {
    setBusy(true); setError('');
    try { setAdvice(await api.analyze(query)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const onEdit = useCallback((ad, action) => setEdit({ ad, preset: action && action.kind !== 'edit' ? action : null }), []);
  const handlers = useMemo(() => ({ onEdit: canApprove ? onEdit : undefined }), [canApprove, onEdit]);
  const count = advice ? [...Object.values(advice.ads), ...Object.values(advice.elements), advice.general].reduce((n, l) => n + l.length, 0) : 0;
  const button = <button className="btn-primary !py-1.5" disabled={busy} onClick={analyze}>{busy ? 'Аналізую…' : advice ? 'Аналізувати ще раз' : 'Аналізувати'}</button>;
  const summary = (error || advice) && (
    <div className="space-y-2">
      {error && <div className="text-sm text-red-300">{error}</div>}
      {advice && <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300"><span>{count ? `Підказок: ${count}. Вони стоять під блоками на карті.` : 'Підказок немає: за цими цифрами все гаразд або даних ще замало.'}</span><button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setAdvice(null)}>Сховати</button></div>}
      {advice?.warnings.map((w) => <div key={w} className="text-sm text-amber-200">{w}</div>)}
      {advice?.general.length > 0 && <div className="max-w-[640px]"><HintList hints={advice.general} /></div>}
    </div>
  );
  const modal = edit && <EditAdModal ad={edit.ad} preset={edit.preset} onClose={() => setEdit(null)} onChanged={reload} />;
  return { advice, handlers, button, summary, modal };
}

function AdPanel({ ad, onClose }) {
  const rows = [['Витрачено', fmt.money(ad.spend)], ['Покази', fmt.int(ad.impressions)], ['Переходи', fmt.int(ad.linkClicks)], ['Ціна переходу', fmt.money2(ad.cpc)], ['Частка переходів', ad.ctr !== null ? `${ad.ctr}%` : '—'], ['Продажі', ad.sales], ['Виручка', fmt.money(ad.revenue)], ['Ціна продажу', fmt.money(ad.saleCost)]];
  return (
    <aside className="absolute right-3 top-3 bottom-3 w-[300px] card p-4 overflow-y-auto z-10">
      <div className="flex items-start gap-2">
        <h2 className="text-sm font-medium flex-1">{ad.name}</h2>
        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={onClose} aria-label="Закрити">Закрити</button>
      </div>
      <div className="mt-2"><Chip v={ad.verdict}>{ad.verdictLabel}</Chip> <span className="text-xs text-slate-400 ml-1">{STATUS[ad.effectiveStatus] || ad.effectiveStatus}</span></div>
      {ad.creative.title && <p className="text-sm mt-3">{ad.creative.title}</p>}
      {ad.creative.body && <p className="text-sm text-slate-300 mt-2 whitespace-pre-wrap">{ad.creative.body}</p>}
      <dl className="mt-4 text-sm">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between py-1 border-t border-slate-800"><dt className="text-slate-400">{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="mt-3 text-xs text-slate-400 break-all">{ad.creative.linkUrl ? <>Веде на: {ad.creative.linkUrl}</> : 'Посилання не вказано'}</div>
      {ad.creative.previewUrl && <a className="text-xs text-brand-light hover:underline mt-2 inline-block" href={ad.creative.previewUrl} target="_blank" rel="noreferrer">Переглянути оголошення у Facebook</a>}
      <p className="text-[11px] text-slate-500 mt-4">Шлях на карті зараз показує лише людей із цього оголошення.</p>
    </aside>
  );
}

function AdsMapView() {
  const [days, setDays] = useState(7);
  const [all, setAll] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [params, setParams] = useSearchParams();
  const bundleId = params.get('bundle') || '';
  const [bundles, setBundles] = useState([]);
  const [version, setVersion] = useState(0);
  const tools = useMapTools({ ...range(days), bundle: bundleId || undefined }, () => setVersion((v) => v + 1));
  useEffect(() => { api.bundles().then((d) => setBundles(d.bundles)).catch(() => {}); }, []);

  useEffect(() => {
    setError('');
    api.map({ ...range(days), all: all ? 1 : undefined, bundle: bundleId || undefined }).then((d) => { setData(d); setSelected(new Set()); }).catch((e) => setError(e.message));
  }, [days, all, bundleId, version]);

  const { nodes, edges } = useMemo(() => (data ? buildMap(data, selected, tools.advice, tools.handlers) : { nodes: [], edges: [] }), [data, selected, tools.advice, tools.handlers]);
  const allAds = useMemo(() => (data ? data.campaigns.flatMap((c) => c.adSets.flatMap((s) => s.ads)) : []), [data]);
  const one = selected.size === 1 ? allAds.find((a) => selected.has(a.externalId)) : null;

  const onNodeClick = useCallback((ev, node) => {
    if (node.type === 'ad') {
      const id = node.data.ad.externalId;
      setSelected((prev) => {
        const next = new Set(ev.shiftKey || ev.ctrlKey || ev.metaKey ? prev : []);
        if (prev.has(id) && (prev.size === 1 || ev.shiftKey || ev.ctrlKey || ev.metaKey)) next.delete(id); else next.add(id);
        return next;
      });
    } else if (node.type === 'campaign') setSelected(new Set(node.data.adIds));
  }, []);

  if (error) return <div className="card p-6 text-red-300 text-sm">{error}</div>;
  if (!data) return <div className="text-slate-500 text-sm">Завантаження…</div>;
  const empty = allAds.length === 0;

  return (
    <div className="flex flex-col gap-3" style={{ height: 'calc(100vh - 150px)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {PERIODS.map((p) => <button key={p.d} className={clsx('btn !py-1.5', days === p.d ? 'bg-brand/20 text-brand-light' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')} onClick={() => setDays(p.d)}>{p.label}</button>)}
        </div>
        <select aria-label="Зв'язка" className="inp !w-auto max-w-[260px] ml-2" value={bundleId} onChange={(e) => setParams(e.target.value ? { bundle: e.target.value } : {})}>
          <option value="">Увесь проєкт</option>
          {bundles.map((b) => <option key={b.id} value={b.id}>{b.code ? `[${b.code}] ` : ''}{b.name}</option>)}
        </select>
        {tools.button}
        <label className="flex items-center gap-2 text-sm text-slate-400 ml-2"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Показати й ті, що без витрат</label>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          {selected.size > 0 ? <><span>Шлях показано для {selected.size} з {allAds.length} оголошень</span><button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setSelected(new Set())}>Показати всі</button></> : <span>Клік на креатив — шлях лише його людей. Shift+клік — додати ще один.</span>}
          {['good', 'pricey', 'bad', 'few'].map((v) => <span key={v} className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 rounded" style={{ background: COLOR[v] }} />{{ good: 'працює', pricey: 'дорого', bad: 'зливає', few: 'мало даних' }[v]}</span>)}
        </div>
      </div>
      {tools.summary}
      {tools.modal}
      {empty ? (
        <div className="card p-8 text-center">
          <h2 className="text-lg font-medium mb-2">{data.bundle ? "У цієї зв'язки ще нема оголошень" : 'На карті поки порожньо'}</h2>
          <p className="text-slate-400 text-sm mb-4">{data.bundle ? `Назвіть кампанію в кабінеті так, щоб у назві було «[${data.bundle.code || 'код'}]», і оновіть дані — її оголошення з'являться тут.` : "Підключіть рекламний кабінет і оновіть дані — креативи з'являться зліва, а кроки сайту й бота справа."}</p>
          <Link to={data.bundle ? '/bundles' : '/connections'} className="btn-primary">{data.bundle ? "До зв'язок" : 'Підключити кабінет'}</Link>
        </div>
      ) : (
        <div className="relative flex-1 rounded-xl overflow-hidden border border-slate-800">
          <ReactFlow key={tools.advice ? 'hints' : 'plain'} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} onPaneClick={() => setSelected(new Set())} colorMode="dark" fitView fitViewOptions={{ padding: 0.08 }} minZoom={0.05} maxZoom={2} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}>
            <Background gap={32} color="#1e293b" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'ad' ? COLOR[n.data.ad.verdict] : n.type === 'sale' ? '#34d399' : '#334155')} maskColor="rgba(2,6,23,.7)" />
          </ReactFlow>
          {one && <AdPanel ad={one} onClose={() => setSelected(new Set())} />}
        </div>
      )}
    </div>
  );
}

// План воронок: працює без рекламного кабінету. Доріжка на кожну зв'язку: креативи → шлях → продаж.
function PlanView() {
  const [params, setParams] = useSearchParams();
  const bundleId = params.get('bundle') || '';
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [bundles, setBundles] = useState([]);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const tools = useMapTools({ ...range(days), bundle: bundleId || undefined }, () => setVersion((v) => v + 1));
  useEffect(() => { api.bundles().then((d) => setBundles(d.bundles)).catch(() => {}); }, []);
  useEffect(() => { setError(''); api.plan({ ...range(days), bundle: bundleId || undefined }).then(setData).catch((e) => setError(e.message)); }, [days, bundleId, version]);
  const { nodes, edges } = useMemo(() => (data ? buildPlanMap(data, tools.advice, tools.handlers) : { nodes: [], edges: [] }), [data, tools.advice, tools.handlers]);
  if (error) return <div className="card p-6 text-red-300 text-sm">{error}</div>;
  if (!data) return <div className="text-slate-500 text-sm">Завантаження…</div>;
  // Усі воронки одразу: на старті показуємо перші дві крупно, решту видно, якщо відʼїхати.
  const focusIds = (data.lanes || []).slice(0, bundleId ? 1 : 2).map((l) => `${l.bundle.id}:`);
  const focus = nodes.filter((n) => focusIds.some((p) => n.id.startsWith(p))).map((n) => ({ id: n.id }));
  return (
    <div className="flex flex-col gap-3" style={{ height: 'calc(100vh - 150px)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Зв'язка" className="inp !w-auto max-w-[320px]" value={bundleId} onChange={(e) => setParams(e.target.value ? { view: 'plan', bundle: e.target.value } : { view: 'plan' })}>
          <option value="">Усі воронки</option>
          {bundles.map((b) => <option key={b.id} value={b.id}>{b.code ? `[${b.code}] ` : ''}{b.name}</option>)}
        </select>
        <div className="flex gap-1">{PERIODS.map((p) => <button key={p.d} className={clsx('btn !py-1.5', days === p.d ? 'bg-brand/20 text-brand-light' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')} onClick={() => setDays(p.d)}>{p.label}</button>)}</div>
        {tools.button}
        <span className="text-xs text-slate-400 ml-auto">{data.metaConnected ? 'Цифри реклами додаються до кожної воронки автоматично.' : 'Рекламний кабінет не підключено: бачите план воронок, цифри зʼявляться після підключення.'}</span>
        {!data.metaConnected && <Link to="/connections" className="btn-ghost !py-1.5">Підключити кабінет</Link>}
      </div>
      {tools.summary}
      {tools.modal}
      {data.lanes.length === 0 ? (
        <div className="card p-8 text-center"><h2 className="text-lg font-medium mb-2">Воронок ще нема</h2><p className="text-slate-400 text-sm mb-4">Створіть першу зв'язку: аудиторія, обіцянка і шлях.</p><Link to="/bundles" className="btn-primary">До зв'язок</Link></div>
      ) : (
        <div className="relative flex-1 rounded-xl overflow-hidden border border-slate-800">
          <ReactFlow key={`${bundleId || 'all'}:${tools.advice ? 'hints' : 'plain'}`} nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode="dark" fitView fitViewOptions={{ padding: 0.05, nodes: focus }} minZoom={0.03} maxZoom={2} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}>
            <Background gap={32} color="#1e293b" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'sale' ? '#34d399' : n.type === 'lane' ? '#8b5cf6' : '#334155')} maskColor="rgba(2,6,23,.7)" />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}

// Карта креативів: усі креативи контент-платформи за аудиторіями й болями.
export function CreativesMapView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.creativeMap().then(setData).catch((e) => setError(e.message)); }, []);
  const { nodes, edges } = useMemo(() => (data ? buildCreativeMap(data) : { nodes: [], edges: [] }), [data]);
  if (error) return <div className="card p-6 text-sm text-slate-300">{error} <Link to="/connections" className="text-brand-light hover:underline ml-2">До підключень</Link></div>;
  if (!data) return <div className="text-slate-500 text-sm">Завантаження…</div>;
  const focus = nodes.filter((n) => n.position.y < 1000).map((n) => ({ id: n.id })); // на старті видно перші блоки повністю
  return (
    <div className="flex flex-col gap-3" style={{ height: 'calc(100vh - 150px)' }}>
      <div className="text-sm text-slate-400">Усього креативів: {data.total} · уже в воронках: {data.inFunnels}. Зліва аудиторія, далі її біль, праворуч креативи цього болю. Додати креатив у воронку: «Зв'язки» → редагувати → «Креативи цієї зв'язки».</div>
      {data.groups.length === 0 ? <div className="card p-8 text-center text-slate-400 text-sm">Креативів ще нема. Замовте перші на сторінці «Креативи».</div> : (
        <div className="relative flex-1 rounded-xl overflow-hidden border border-slate-800">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode="dark" fitView fitViewOptions={{ padding: 0.05, nodes: focus.length ? focus : undefined }} minZoom={0.03} maxZoom={2} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}>
            <Background gap={32} color="#1e293b" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'audience' ? '#8b5cf6' : n.type === 'pain' ? '#64748b' : '#334155')} maskColor="rgba(2,6,23,.7)" />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}

export default function MapPage() {
  const [params, setParams] = useSearchParams();
  // Колишня вкладка «Креативи» карти тепер живе в розділі «Креативи».
  if (params.get('view') === 'creatives') return <Navigate to="/creatives?view=map" replace />;
  const view = params.get('view') === 'ads' ? 'ads' : 'plan';
  const bundle = params.get('bundle');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-medium mr-2">Карта реклами</h1>
        <div className="inline-flex rounded-lg bg-slate-900 border border-slate-800 p-1" role="group" aria-label="Як групувати карту">
          {[['plan', 'По зв\'язках'], ['ads', 'По кампаніях']].map(([k, label]) => <button key={k} aria-pressed={view === k} className={clsx('btn !py-1', view === k ? 'bg-brand/20 text-brand-light' : 'text-slate-300 hover:bg-slate-800')} onClick={() => setParams(bundle ? { view: k, bundle } : { view: k })}>{label}</button>)}
        </div>
        <span className="text-xs text-slate-500">{view === 'plan' ? 'Кожна зв\'язка окремою смугою: реклама → шлях → продаж. Видно й ті, що ще не запущені.' : 'Лише те, що є в кабінеті: кампанії, групи, оголошення і хто з них прийшов.'}</span>
      </div>
      {view === 'plan' ? <PlanView /> : <AdsMapView />}
    </div>
  );
}
