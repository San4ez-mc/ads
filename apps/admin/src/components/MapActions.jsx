// Дії просто з карти: підказки під блоками (з копіюванням) і вікно «Внести правки» для оголошення.
// Будь-яка зміна в кабінеті проходить ті самі запобіжники: спершу перевірка, потім підтвердження.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '../api/client';

const SEV = { high: ['#f87171', 'важливо'], mid: ['#fbbf24', 'варто'], info: ['#94a3b8', 'до відома'] };
const PLACEMENTS = [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['messenger', 'Messenger'], ['threads', 'Threads'], ['audience_network', 'Audience Network (сторонні додатки)']];
const clickable = { pointerEvents: 'all' };
const nameOf = (k) => (PLACEMENTS.find((p) => p[0] === k) || [k, k])[1];

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" style={clickable} className="nodrag nopan btn-ghost !px-2 !py-1 text-xs shrink-0" title="Скопіювати завдання для виконавця"
      onClick={async (e) => { e.stopPropagation(); if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 2000); } }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
      {done ? 'Скопійовано' : 'Копіювати'}
    </button>
  );
}

export function HintList({ hints, onAction }) {
  return (
    <ul className="space-y-2">
      {hints.map((h) => (
        <li key={h.title} className="rounded-lg bg-slate-950/70 border-l-4 px-3 py-2" style={{ borderColor: (SEV[h.severity] || SEV.mid)[0] }}>
          <div className="flex items-start gap-2">
            <div className="text-sm font-medium leading-snug flex-1">{h.title}</div>
            {h.copy && <CopyButton text={h.copy} />}
          </div>
          <div className="text-xs text-slate-300 leading-snug mt-1">{h.text}</div>
          {h.action && onAction && <button type="button" style={clickable} className="nodrag nopan btn-primary !px-2 !py-1 text-xs mt-2" onClick={(e) => { e.stopPropagation(); onAction(h.action); }}>{h.action.label}</button>}
        </li>
      ))}
    </ul>
  );
}

/** Вузол карти з підказками: стоїть просто під блоком, якого стосується. */
export function HintNode({ data }) {
  return (
    <div className="nowheel nodrag nopan h-full w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-2" style={clickable}>
      <HintList hints={data.hints} onAction={data.onAction} />
    </div>
  );
}

export function EditAdModal({ ad, preset, onClose, onQueue }) {
  const [added, setAdded] = useState('');
  const queue = (input, label) => { onQueue(input, label); setAdded(label); setError(''); };
  const current = ad.placements && !ad.placements.auto ? ad.placements.list : ['facebook', 'instagram', 'messenger', 'audience_network'];
  const [places, setPlaces] = useState(preset?.placements || current);
  const [budget, setBudget] = useState(ad.adSetBudget ?? '');
  const [creatives, setCreatives] = useState(null);
  const [creativeId, setCreativeId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api.creatives().then((d) => setCreatives(d.creatives.filter((c) => c.mediaType === 'image' && c.mediaUrl && !c.violations?.length && c.status !== 'draft'))).catch((e) => { setError(e.message); setCreatives([]); }); }, []);
  useEffect(() => {
    if (preset?.kind === 'set_placements') queue({ kind: 'set_placements', adSetId: ad.adSetId, placements: preset.placements }, `Площадки групи «${ad.adSetName}»: ${preset.placements.map(nameOf).join(', ')}`);
    if (preset?.kind === 'pause_ad') queue({ kind: 'pause_ad', adId: ad.id }, `Вимкнути «${ad.name}»`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const esc = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [onClose]);
  const on = ad.effectiveStatus === 'ACTIVE';
  const toggle = (p) => { setPlaces((l) => (l.includes(p) ? l.filter((x) => x !== p) : [...l, p])); setAdded(''); };
  const order = `Оголошення «${ad.name}». Потрібен новий креатив замість нього.${ad.creative.title ? ` Заголовок зараз: «${ad.creative.title}».` : ''}${ad.creative.body ? ` Текст зараз: «${ad.creative.body.slice(0, 300)}».` : ''}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Внести правки" className="card w-full max-w-[640px] p-5 space-y-5 my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="flex-1"><h2 className="font-medium">Внести правки: {ad.name}</h2>
            <div className="text-xs text-slate-400 mt-1">{ad.audience?.text}<br />{ad.placements?.text}</div></div>
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={onClose}>Закрити</button>
        </div>
        {added && <div className="text-sm rounded-lg p-3 bg-emerald-900/20 text-emerald-200">Додано до змін: {added}. Закрийте вікно й натисніть «Переглянути й застосувати» над картою.</div>}

        <section className="space-y-2"><h3 className="text-sm font-medium">Показ</h3>
          <button className={on ? 'btn-danger' : 'btn-ghost'} onClick={() => queue({ kind: on ? 'pause_ad' : 'resume_ad', adId: ad.id }, `${on ? 'Вимкнути' : 'Увімкнути'} «${ad.name}»`)}>{on ? 'Вимкнути оголошення' : 'Увімкнути оголошення'}</button>
        </section>

        <section className="space-y-2"><h3 className="text-sm font-medium">Денний бюджет групи «{ad.adSetName}»</h3>
          <div className="flex gap-2">
            <input aria-label="Денний бюджет" className="inp !w-32" inputMode="decimal" value={budget} onChange={(e) => { setBudget(e.target.value); setAdded(''); setError(''); }} />
            <button className="btn-ghost" onClick={() => (Number(budget) > 0 ? queue({ kind: 'set_adset_budget', adSetId: ad.adSetId, dailyBudget: Number(budget) }, `Бюджет групи «${ad.adSetName}»: ${budget} на день`) : setError('Бюджет — число більше нуля'))}>Змінити</button>
          </div>
        </section>

        <section className="space-y-2"><h3 className="text-sm font-medium">Площадки (для всієї групи)</h3>
          <div className="grid sm:grid-cols-2 gap-1">{PLACEMENTS.map(([k, label]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={places.includes(k)} onChange={() => toggle(k)} />{label}</label>)}</div>
          <button className="btn-ghost" onClick={() => (places.length ? queue({ kind: 'set_placements', adSetId: ad.adSetId, placements: places }, `Площадки групи «${ad.adSetName}»: ${places.map(nameOf).join(', ')}`) : setError('Оберіть хоча б одну площадку'))}>Змінити площадки</button>
        </section>

        <section className="space-y-2"><h3 className="text-sm font-medium">Картинка й тексти</h3>
          {creatives === null ? <div className="text-sm text-slate-400">Завантаження креативів…</div> : (
            <div className="flex flex-wrap gap-2">
              <select aria-label="Новий креатив" className="inp !w-auto max-w-full" value={creativeId} onChange={(e) => { setCreativeId(e.target.value); setAdded(''); setError(''); }}>
                <option value="">оберіть готовий креатив…</option>
                {creatives.map((c) => <option key={c.id} value={c.id}>№{c.number} · {(/Заголовок:[ \t]*(.+)/.exec(c.text || '')?.[1] || '').slice(0, 60)}</option>)}
              </select>
              <button className="btn-ghost" onClick={() => (creativeId ? queue({ kind: 'replace_creative', adId: ad.id, creativeId }, `Замінити креатив «${ad.name}» на №${creatives.find((c) => c.id === creativeId)?.number}`) : setError('Оберіть креатив зі списку'))}>Замінити</button>
              <Link className="btn-ghost" to={`/creatives?note=${encodeURIComponent(order)}`}>Замовити новий</Link>
            </div>
          )}
          {creativeId && creatives?.find((c) => c.id === creativeId) && <img src={creatives.find((c) => c.id === creativeId).mediaUrl} alt="Обраний креатив" className="max-h-52 rounded-lg" />}
          <p className="text-xs text-slate-500">Тексти беруться з контент-платформи разом із картинкою: там вони проходять перевірку правил реклами.</p>
        </section>
        {error && <div className="text-sm text-red-300">{error}</div>}
      </div>
    </div>
  );
}
