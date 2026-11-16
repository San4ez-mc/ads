import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { api, fmt } from '../api/client';

const PERIODS = [{ d: 1, label: 'Сьогодні' }, { d: 7, label: '7 днів' }, { d: 14, label: '14 днів' }, { d: 30, label: '30 днів' }];
const STATUS = { ACTIVE: ['Крутиться', 'bg-emerald-900/40 text-emerald-200'], PAUSED: ['Вимкнено', 'bg-slate-800 text-slate-300'], ADSET_PAUSED: ['Групу вимкнено', 'bg-slate-800 text-slate-300'], CAMPAIGN_PAUSED: ['Кампанію вимкнено', 'bg-slate-800 text-slate-300'], PENDING_REVIEW: ['На перевірці', 'bg-sky-900/40 text-sky-200'], DISAPPROVED: ['Відхилено', 'bg-red-900/50 text-red-200'], WITH_ISSUES: ['Є проблеми', 'bg-red-900/50 text-red-200'] };

const range = (days) => { const to = new Date(); const from = new Date(to.getTime() - (days - 1) * 86400000); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }; };

function Stat({ label, value, hint, tone }) {
  return (
    <div className="bg-slate-900 rounded-lg p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={clsx('text-2xl font-medium mt-1', tone)}>{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

export default function AdsPage() {
  const [days, setDays] = useState(7);
  const [all, setAll] = useState(false);
  const [data, setData] = useState(null);
  const [ov, setOv] = useState(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  async function load() {
    setError('');
    try { const r = range(days); const [a, o] = await Promise.all([api.ads({ ...r, all: all ? 1 : undefined }), api.overview(r)]); setData(a); setOv(o); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [days, all]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sync() {
    setSyncing(true); setSyncMsg('');
    try {
      const r = await api.syncRun({ days: Math.max(7, days) });
      const bad = r.results.filter((x) => !x.ok);
      setSyncMsg(bad.length ? `Не все оновилось: ${bad.map((x) => x.error).join('; ')}` : 'Дані оновлено');
      await load();
    } catch (e) { setSyncMsg(e.message); } finally { setSyncing(false); }
  }

  const groups = useMemo(() => {
    const m = new Map();
    for (const a of data?.ads || []) { const k = a.campaign.id; if (!m.has(k)) m.set(k, { campaign: a.campaign, ads: [] }); m.get(k).ads.push(a); }
    return [...m.values()].map((g) => ({ ...g, spend: g.ads.reduce((s, a) => s + a.spend, 0), sales: g.ads.reduce((s, a) => s + a.sales, 0) })).sort((a, b) => b.spend - a.spend);
  }, [data]);

  if (error) return <div className="card p-6 text-red-300 text-sm">{error}</div>;
  if (!data || !ov) return <div className="text-slate-500 text-sm">Завантаження…</div>;

  const noConn = ov.connections.length === 0;
  const t = ov.totals;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {PERIODS.map((p) => <button key={p.d} className={clsx('btn !py-1.5', days === p.d ? 'bg-brand/20 text-brand-light' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')} onClick={() => setDays(p.d)}>{p.label}</button>)}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-400 ml-2"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Показати й ті, що без витрат</label>
        <div className="ml-auto flex items-center gap-3">
          {syncMsg && <span className="text-xs text-slate-400 max-w-md truncate" title={syncMsg}>{syncMsg}</span>}
          <span className="text-xs text-slate-500">Оновлено: {fmt.dt(ov.lastSync?.at)}</span>
          <button className="btn-ghost" onClick={sync} disabled={syncing || noConn}>{syncing ? 'Оновлюю…' : 'Оновити дані'}</button>
        </div>
      </div>

      {ov.today.overLimit && <div className="card border-red-800 p-4 text-sm text-red-200">Сьогодні витрачено {fmt.money(ov.today.spend)} — це більше за денний ліміт проєкту ({fmt.money(ov.today.limit)}).</div>}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <Stat label="Витрачено" value={fmt.money(t.spend)} hint={`сьогодні ${fmt.money(ov.today.spend)} з ${fmt.money(ov.today.limit)}`} />
        <Stat label="Переходи" value={fmt.int(t.linkClicks)} hint={`ціна переходу ${fmt.money2(t.cpc)}`} />
        <Stat label="Продажі" value={fmt.int(t.sales)} hint={t.revenue ? `на ${fmt.money(t.revenue)}` : 'за даними сайтів'} />
        <Stat label="Ціна продажу" value={fmt.money(t.saleCost)} hint={ov.target ? `ціль ${fmt.money(ov.target)}` : 'ціль не задано'} tone={t.saleCost && ov.target ? (t.saleCost <= ov.target ? 'text-emerald-300' : 'text-red-300') : undefined} />
        <Stat label="Оголошень крутиться" value={`${ov.counts.running}`} hint={`усього в базі ${ov.counts.ads}`} />
      </div>

      {noConn ? (
        <div className="card p-8 text-center">
          <h2 className="text-lg font-medium mb-2">Підключіть рекламний кабінет</h2>
          <p className="text-slate-400 text-sm mb-4">Після підключення тут з'являться оголошення, витрати і ціна продажу. Платформа лише читає дані й нічого в кабінеті не змінює.</p>
          <Link to="/connections" className="btn-primary">Підключити кабінет</Link>
        </div>
      ) : groups.length === 0 ? (
        <div className="card p-8 text-center text-slate-400 text-sm">За цей період оголошень із витратами нема. Натисніть «Оновити дані» або оберіть довший період.</div>
      ) : groups.map((g) => (
        <section key={g.campaign.id} className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="font-medium">{g.campaign.name}</h2>
            <span className="text-xs text-slate-400">витрачено {fmt.money(g.spend)} · продажів {g.sales} · ціна продажу {fmt.money(g.sales ? g.spend / g.sales : null)}</span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400 text-left">
                <tr><th className="px-4 py-2 font-normal">Креатив</th><th className="px-3 py-2 font-normal">Стан</th><th className="px-3 py-2 font-normal text-right">Витрачено</th><th className="px-3 py-2 font-normal text-right">Покази</th><th className="px-3 py-2 font-normal text-right">Переходи</th><th className="px-3 py-2 font-normal text-right">Ціна переходу</th><th className="px-3 py-2 font-normal text-right">Продажі</th><th className="px-4 py-2 font-normal text-right">Ціна продажу</th></tr>
              </thead>
              <tbody>
                {g.ads.map((a) => {
                  const [stLabel, stCls] = STATUS[a.effectiveStatus] || [a.effectiveStatus || '—', 'bg-slate-800 text-slate-300'];
                  const img = a.creative.imageUrl || a.creative.thumbnailUrl;
                  return (
                    <tr key={a.id} className="border-t border-slate-800 align-top">
                      <td className="px-4 py-3">
                        <div className="flex gap-3 min-w-[280px]">
                          {img ? <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-16 h-20 object-cover rounded-md bg-slate-800 shrink-0" /> : <div className="w-16 h-20 rounded-md bg-slate-800 shrink-0 flex items-center justify-center text-[11px] text-slate-500">без фото</div>}
                          <div className="min-w-0">
                            <div className="font-medium truncate max-w-[340px]">{a.name}</div>
                            <div className="text-xs text-slate-400 line-clamp-2 max-w-[340px]">{a.creative.body || a.creative.title || '—'}</div>
                            <div className="text-xs text-slate-500 mt-1">{a.adSet.name}{a.adSet.learningStage === 'LEARNING' ? ' · навчається' : ''}{a.creative.previewUrl && <> · <a className="text-brand-light hover:underline" href={a.creative.previewUrl} target="_blank" rel="noreferrer">переглянути</a></>}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3"><span className={clsx('text-xs px-2 py-1 rounded-md whitespace-nowrap', stCls)}>{stLabel}</span></td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">{fmt.money(a.spend)}</td>
                      <td className="px-3 py-3 text-right">{fmt.int(a.impressions)}</td>
                      <td className="px-3 py-3 text-right">{fmt.int(a.linkClicks)}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">{fmt.money2(a.cpc)}</td>
                      <td className="px-3 py-3 text-right">{a.sales}</td>
                      <td className={clsx('px-4 py-3 text-right whitespace-nowrap', a.saleCost && ov.target ? (a.saleCost <= ov.target ? 'text-emerald-300' : 'text-red-300') : '')}>{fmt.money(a.saleCost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
