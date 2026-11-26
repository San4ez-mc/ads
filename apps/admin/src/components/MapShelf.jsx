// Полиця креативів зліва від карти і «Зміни»: що людина накидала на карті, те платформа вносить у кабінет —
// після перевірки запобіжниками й одного підтвердження. Креатив можна перетягнути на оголошення (заміна) або на групу (нове).
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { create } from 'zustand';
import { api } from '../api/client';

export const DRAG = 'application/x-fineko-creative';

/** Накидані зміни живуть окремо від виду карти: перемикання «по зв'язках / по кампаніях» їх не губить. */
export const useChanges = create((set) => ({ changes: [], setChanges: (fn) => set((s) => ({ changes: typeof fn === 'function' ? fn(s.changes) : fn })) }));

export function CreativeShelf({ data, onAdd }) {
  const [all, setAll] = useState(() => { try { return localStorage.getItem('ads_shelf_all') !== '0'; } catch { return true; } });
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState('');
  const toggle = (v) => { setAll(v); try { localStorage.setItem('ads_shelf_all', v ? '1' : '0'); } catch { /* приватний режим */ } };
  if (!open) return <button className="btn-ghost !px-2 self-start" onClick={() => setOpen(true)}>Креативи</button>;
  const items = (data?.items || []).filter((c) => (all || c.ads.length) && (!q || `${c.number || ''} ${c.headline}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <aside className="w-[260px] shrink-0 card flex flex-col min-h-0" aria-label="Креативи">
      <div className="p-3 space-y-2 border-b border-slate-800">
        <div className="flex items-center gap-2"><h2 className="text-sm font-medium">Креативи</h2><span className="text-xs text-slate-500">{items.length}</span><button className="btn-ghost !px-2 !py-0.5 text-xs ml-auto" onClick={() => setOpen(false)}>Сховати</button></div>
        <div className="grid grid-cols-2 gap-1" role="group" aria-label="Які креативи показувати">
          {[[true, 'Усі'], [false, 'У рекламі']].map(([v, label]) => <button key={label} aria-pressed={all === v} className={clsx('btn !py-1 text-xs', all === v ? 'bg-brand/20 text-brand-light' : 'bg-slate-800 text-slate-300')} onClick={() => toggle(v)}>{label}</button>)}
        </div>
        <input aria-label="Пошук креативу" className="inp !py-1" placeholder="Пошук: номер або заголовок" value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="text-[11px] text-slate-500">Перетягніть на оголошення, щоб замінити креатив, або на групу, щоб додати нове.</p>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {!data ? <div className="text-sm text-slate-500">Завантаження…</div> : null}
        {data?.error && <div className="text-xs text-amber-200">{data.error}</div>}
        {items.map((c) => (
          <div key={c.id} draggable={c.usable} onDragStart={(e) => { e.dataTransfer.setData(DRAG, JSON.stringify({ id: c.id, number: c.number, headline: c.headline })); e.dataTransfer.effectAllowed = 'copy'; }}
            className={clsx('rounded-lg border p-2 flex gap-2', c.ads.length ? 'border-emerald-700 bg-emerald-950/30' : 'border-slate-800', c.usable && 'cursor-grab')}>
            {c.mediaUrl ? (c.mediaType === 'video' ? <video src={`${c.mediaUrl}#t=0.5`} muted preload="metadata" className="w-14 h-[70px] object-cover rounded shrink-0" /> : <img src={c.mediaUrl} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} className="w-14 h-[70px] object-cover rounded shrink-0" />) : <div className="w-14 h-[70px] rounded bg-slate-800 shrink-0" />}
            <div className="min-w-0 text-xs space-y-0.5">
              <div className="flex flex-wrap gap-1 items-center"><span className="text-slate-500">{c.number ? `№${c.number}` : 'з кабінету'}</span>{c.ads.length > 0 && <span className="px-1.5 rounded bg-emerald-800 text-emerald-100">в рекламі{c.ads.length > 1 ? ` ×${c.ads.length}` : ''}</span>}{c.bundles.map((b) => <span key={b} className="px-1.5 rounded bg-brand/20 text-brand-light">{b}</span>)}</div>
              <div className="line-clamp-2 leading-snug">{c.headline}</div>
              {c.ads.length > 0 && <div className="text-slate-500 truncate" title={c.ads.map((a) => `${a.campaign} · ${a.name}`).join('\n')}>{c.ads.some((a) => a.status === 'ACTIVE') ? 'крутиться' : 'не крутиться'} · {c.ads[0].campaign}</div>}
              {c.problem && <div className="text-red-300 line-clamp-2" title={c.problem}>{c.problem}</div>}
              {onAdd && c.usable && (adding === c.id ? (
                <select aria-label="У яку групу додати" className="inp !py-1 text-xs" defaultValue="" onChange={(e) => { const s = data.adSets.find((x) => x.id === e.target.value); if (s) onAdd(c, s); setAdding(''); }}>
                  <option value="">у яку групу…</option>
                  {data.adSets.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.campaign}</option>)}
                </select>
              ) : <button className="text-brand-light hover:underline" onClick={() => setAdding(c.id)}>Додати в рекламу</button>)}
            </div>
          </div>
        ))}
        {data && !items.length && <div className="text-sm text-slate-500 p-2">{all ? 'Нічого не знайдено.' : 'У рекламі зараз нема креативів.'}</div>}
      </div>
    </aside>
  );
}

/** Список накиданих змін. Кожна проходить перевірку запобіжниками; застосовуються лише ті, що пройшли, по черзі. */
export function ChangesBar({ changes, onRemove, onClear, onApplied }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({}); // key → { verdict?, result?, link? }
  const [busy, setBusy] = useState(false);
  const patch = (key, v) => setState((s) => ({ ...s, [key]: { ...s[key], ...v } }));
  const inputOf = (c) => ({ ...c.input, ...(state[c.key]?.link ? { link: state[c.key].link } : {}) });

  async function check(c) {
    try { patch(c.key, { verdict: await api.checkAction(inputOf(c)), result: null }); } catch (e) { patch(c.key, { verdict: { ok: false, reasons: [e.message], notes: [] } }); }
  }
  useEffect(() => { if (open) changes.filter((c) => !state[c.key]?.verdict && !state[c.key]?.result).forEach(check); }, [open, changes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function apply() {
    setBusy(true); let changed = false;
    for (const c of changes) {
      if (!state[c.key]?.verdict?.ok || state[c.key]?.result) continue;
      try { const result = await api.runAction(inputOf(c)); patch(c.key, { result }); changed ||= result.status === 'done'; } catch (e) { patch(c.key, { result: { status: 'failed', message: e.message } }); }
    }
    setBusy(false); if (changed) onApplied();
  }
  const ready = changes.filter((c) => state[c.key]?.verdict?.ok && !state[c.key]?.result).length;
  const dryRun = Object.values(state).some((s) => s.verdict?.dryRun);
  if (!changes.length) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand/50 bg-brand/10 px-3 py-2 text-sm">
        <span>Зміни на карті: <b>{changes.length}</b>. У кабінеті ще нічого не змінено.</span>
        <button className="btn-primary !py-1.5 ml-auto" onClick={() => setOpen(true)}>Переглянути й застосувати</button>
        <button className="btn-ghost !py-1.5" onClick={() => { setState({}); onClear(); }}>Скасувати всі</button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4" onClick={() => !busy && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Зміни в кабінеті" className="card w-full max-w-[640px] p-5 space-y-3 my-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2"><h2 className="font-medium">Зміни в кабінеті</h2><button className="btn-ghost !px-2 !py-1 text-xs ml-auto" disabled={busy} onClick={() => setOpen(false)}>Закрити</button></div>
            {dryRun && <div className="text-sm text-amber-200">Увімкнено режим «проба»: у кабінеті нічого не зміниться, дії лише запишуться в журнал.</div>}
            {changes.map((c) => {
              const s = state[c.key] || {};
              return (
                <div key={c.key} className="rounded-lg border border-slate-800 p-3 text-sm space-y-1">
                  <div className="flex gap-2"><span className="flex-1">{c.label}</span>{!s.result && <button className="text-xs text-slate-400 hover:underline" disabled={busy} onClick={() => { setState((x) => ({ ...x, [c.key]: undefined })); onRemove(c.key); }}>прибрати</button>}</div>
                  {c.needsLink && !s.result && (
                    <div className="flex gap-2"><input aria-label="Куди веде оголошення" className="inp !py-1" placeholder="https://t.me/бот?start=воронка або адреса сайту" value={s.link || ''} onChange={(e) => patch(c.key, { link: e.target.value, verdict: null })} /><button className="btn-ghost !py-1" onClick={() => check(c)}>Перевірити</button></div>
                  )}
                  {s.result ? <div className={s.result.status === 'done' || s.result.status === 'dry_run' ? 'text-emerald-300' : 'text-red-300'}>{s.result.message || (s.result.reasons || []).join('; ')}</div>
                    : !s.verdict ? <div className="text-slate-500">перевіряю…</div>
                      : s.verdict.ok ? <div className="text-slate-400">✓ можна. {s.verdict.notes.join(' · ')}</div>
                        : <ul className="list-disc pl-5 text-red-300">{s.verdict.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
                </div>
              );
            })}
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy || !ready} onClick={apply}>{busy ? 'Вношу…' : `Так, застосувати ${ready}`}</button>
              {changes.every((c) => state[c.key]?.result) && <button className="btn-ghost" onClick={() => { setState({}); setOpen(false); onClear(); }}>Готово</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
