import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '../api/client';

const SEV = { high: ['Важливо', 'bg-red-900/50 text-red-200'], mid: ['Варто зробити', 'bg-amber-900/40 text-amber-200'], low: ['Для інформації', 'bg-slate-800 text-slate-300'], info: ['Нотатка', 'bg-slate-800 text-slate-400'] };
const KIND = { pause: 'Вимкнути', scale: 'Підсилити', watch: 'Почекати', funnel: 'Воронка', no_clicks: 'Креатив', no_source: 'Джерело', limit: 'Ліміт', connection: 'Підключення', setup: 'Налаштування', learning: 'Навчання', few_data: 'Мало даних' };

// Кнопка дії: спершу перевірка запобіжників, потім явне підтвердження. Нічого не виконується одним кліком.
function ActionButton({ action, onDone }) {
  const [state, setState] = useState('idle'); // idle | checking | confirm | running | done
  const [check, setCheck] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const payload = { kind: action.kind, adId: action.adId, adSetId: action.adSetId, dailyBudget: action.dailyBudget };

  async function start() {
    setState('checking'); setError(''); setResult(null);
    try { setCheck(await api.checkAction(payload)); setState('confirm'); } catch (e) { setError(e.message); setState('idle'); }
  }
  async function run() {
    setState('running'); setError('');
    try { const r = await api.runAction(payload); setResult(r); setState('done'); onDone && onDone(r); } catch (e) { setError(e.message); setState('confirm'); }
  }

  if (state === 'done' && result) {
    const tone = result.status === 'done' ? 'text-emerald-300' : result.status === 'dry_run' ? 'text-amber-200' : 'text-red-300';
    return <div className={clsx('mt-3 text-sm', tone)}>{result.message || (result.reasons || []).join(' ')}</div>;
  }
  return (
    <div className="mt-3">
      {state === 'idle' && <button className="btn-ghost" onClick={start}>{action.label}</button>}
      {state === 'checking' && <span className="text-sm text-slate-400">Перевіряю запобіжники…</span>}
      {(state === 'confirm' || state === 'running') && check && (
        <div className="rounded-lg border border-slate-700 p-3 space-y-2">
          {check.ok ? (
            <>
              <div className="text-sm">Запобіжники пропускають дію.{check.dryRun ? ' Зараз режим «проба»: у кабінеті нічого не зміниться, дію лише запишуть у журнал.' : ' Зміна відбудеться в рекламному кабінеті одразу.'}</div>
              {check.notes.map((n, i) => <div key={i} className="text-xs text-slate-400">{n}</div>)}
              <div className="flex gap-2">
                <button className="btn-primary" onClick={run} disabled={state === 'running'}>{state === 'running' ? 'Виконую…' : check.dryRun ? 'Записати як «зробив би»' : 'Підтвердити'}</button>
                <button className="btn-ghost" onClick={() => setState('idle')} disabled={state === 'running'}>Скасувати</button>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-red-300">Запобіжники не дозволяють:</div>
              <ul className="text-sm text-slate-300 list-disc pl-5 space-y-1">{check.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <button className="btn-ghost" onClick={() => setState('idle')}>Зрозуміло</button>
            </>
          )}
        </div>
      )}
      {error && <div className="text-sm text-red-300 mt-2">{error}</div>}
    </div>
  );
}

export default function AdvicePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [hist, setHist] = useState([]);
  const load = () => api.advice().then(setData).then(() => api.adviceHistory()).then((h) => setHist(h.items)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (error) return <div className="card p-6 text-red-300 text-sm">{error}</div>;
  if (!data) return <div className="text-slate-500 text-sm">Завантаження…</div>;
  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-medium">Рекомендації</h1>
        <p className="text-sm text-slate-400">За {data.from} — {data.to}. Рахуються за простими правилами. Зміна в кабінеті — лише після вашого підтвердження.</p>
      </div>
      {data.items.length === 0 ? (
        <div className="card p-8 text-center text-slate-400 text-sm">Порад немає: або всі оголошення в межах правил, або даних ще нема. <Link className="text-brand-light hover:underline" to="/connections">Підключення</Link></div>
      ) : data.items.map((i, n) => {
        const [label, cls] = SEV[i.severity] || SEV.low;
        return (
          <article key={n} className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={clsx('text-xs px-2 py-1 rounded-md', cls)}>{label}</span>
              <span className="text-xs text-slate-500">{KIND[i.kind] || i.kind}</span>
              {i.preliminary && <span className="text-xs px-2 py-1 rounded-md bg-slate-800 text-slate-300">попередньо: даних мало</span>}
            </div>
            <h2 className="text-sm font-medium mt-2">{i.title}</h2>
            <p className="text-sm text-slate-400 mt-1">{i.text}</p>
            {i.action && <ActionButton action={i.action} onDone={() => setTimeout(load, 800)} />}
          </article>
        );
      })}
      {hist.length > 0 && (
        <section className="pt-4">
          <h2 className="text-base font-medium">Що було з порадами</h2>
          <p className="text-sm text-slate-400 mb-3">Через 7 днів платформа дописує, що сталося після поради. Так видно, чи їй можна довіряти.</p>
          <div className="space-y-2">
            {hist.map((h) => (
              <article key={h.id} className="card p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><span>{new Date(h.createdAt).toLocaleDateString('uk-UA')}</span>{h.preliminary && <span>попередньо</span>}</div>
                <div className="text-sm mt-1">{h.title}</div>
                <div className="text-sm text-slate-400 mt-1">{h.outcome ? h.outcome.text : 'Підсумок буде за 7 днів після поради.'}</div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
