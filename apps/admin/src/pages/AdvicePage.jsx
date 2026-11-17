import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '../api/client';

const SEV = { high: ['Важливо', 'bg-red-900/50 text-red-200'], mid: ['Варто зробити', 'bg-amber-900/40 text-amber-200'], low: ['Для інформації', 'bg-slate-800 text-slate-300'], info: ['Нотатка', 'bg-slate-800 text-slate-400'] };
const KIND = { pause: 'Вимкнути', scale: 'Підсилити', watch: 'Почекати', funnel: 'Воронка', no_clicks: 'Креатив', no_source: 'Джерело', limit: 'Ліміт', connection: 'Підключення', setup: 'Налаштування', learning: 'Навчання', few_data: 'Мало даних' };

export default function AdvicePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.advice().then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <div className="card p-6 text-red-300 text-sm">{error}</div>;
  if (!data) return <div className="text-slate-500 text-sm">Завантаження…</div>;
  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-medium">Рекомендації</h1>
        <p className="text-sm text-slate-400">За {data.from} — {data.to}. Рахуються за простими правилами. Платформа лише радить, у кабінеті нічого не змінює.</p>
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
          </article>
        );
      })}
    </div>
  );
}
