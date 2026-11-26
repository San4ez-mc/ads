// «Сайти»: версії для A/B (з посиланням для реклами) і правки, які платформа передає виконавцю сайтів.
import { useEffect, useState } from 'react';
import { api, fmt } from '../api/client';

const ACTIONS = { text: 'текст', text_color: 'колір тексту', bg_color: 'колір фону', hide: 'сховано', show: 'показано', image: 'зображення', link: 'посилання' };

function CopyLink({ url }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={async () => { try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 2000); } catch { window.prompt('Скопіюйте посилання', url); } }}>{done ? 'Скопійовано' : 'Копіювати посилання'}</button>;
}

export default function SitesPage() {
  const [data, setData] = useState(null);
  const [f, setF] = useState({ site: '', kind: 'edit', message: '' });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.sites().then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (!data) return <div className="text-slate-500 text-sm">{error || 'Завантаження…'}</div>;

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setAsking(false); setResult(null); };
  async function send() {
    setBusy(true);
    try {
      const r = await api.sendSiteEdit({ ...f, confirm: true });
      setResult(r); setAsking(false);
      if (r.status === 'done') { setF({ ...f, message: '' }); await load(); }
    } catch (e) { setResult({ status: 'failed', message: e.message }); } finally { setBusy(false); }
  }
  const options = data.sites.length ? data.sites : data.versions.map((v) => ({ id: v.site, name: v.name }));
  const withVersions = data.versions.filter((s) => s.versions?.length);
  const versionOfEdit = (id) => data.versions.flatMap((s) => s.versions || []).filter((v) => id && v.edit_id === id).map((v) => v.variant);

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-lg font-medium">Сайти</h1>
      {!data.connected && <div className="card p-4 text-sm text-amber-200">Сайти не підключені. Додайте їх у «Підключеннях».</div>}
      {data.error && <div className="card p-4 text-sm text-amber-200">Не вдалося прочитати версії: {data.error}</div>}

      <form className="card p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); if (f.site && f.message.trim()) setAsking(true); else setResult({ status: 'failed', message: 'Оберіть сайт і напишіть, що змінити' }); }}>
        <div>
          <h2 className="font-medium">Надіслати правку</h2>
          <p className="text-xs text-slate-500 mt-1">Правка нічого на сайті не змінює: вона потрапляє в адмінку сайтів і приходить вам у Telegram. Далі з неї роблять версію.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="lbl" htmlFor="e-site">Сайт</label><select id="e-site" className="inp" value={f.site} onChange={set('site')}><option value="">оберіть…</option>{options.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}</select></div>
          <div><label className="lbl" htmlFor="e-kind">Що це</label><select id="e-kind" className="inp" value={f.kind} onChange={set('kind')}><option value="edit">Змінити сайт</option><option value="ab">Перевірити варіант (A/B)</option></select></div>
        </div>
        <div>
          <label className="lbl" htmlFor="e-msg">Що змінити</label>
          <textarea id="e-msg" className="inp min-h-[110px]" maxLength={4000} value={f.message} onChange={set('message')} placeholder="Проблема, цифри, що саме змінити і як перевірити" />
          <p className="text-xs text-slate-500 mt-1">{f.message.length} із 4000</p>
        </div>
        {asking
          ? <div className="flex flex-wrap items-center gap-2"><span className="text-sm">Надіслати цю правку?</span><button type="button" className="btn-primary !py-1.5" disabled={busy} onClick={send}>{busy ? 'Надсилаю…' : 'Так, надіслати'}</button><button type="button" className="btn-ghost !py-1.5" onClick={() => setAsking(false)}>Ні</button></div>
          : <button className="btn-primary" disabled={!data.connected}>Надіслати</button>}
        {result && <p className={result.status === 'done' ? 'text-sm text-emerald-300' : 'text-sm text-red-300'}>{result.message}</p>}
      </form>

      <section className="card p-5 space-y-3">
        <div>
          <h2 className="font-medium">Версії сторінок</h2>
          <p className="text-xs text-slate-500 mt-1">Щоб реклама вела на версію, візьміть її посилання для «Запуску». Без параметра людина бачить оригінал. Версії створюються й вмикаються в адмінці сайтів.</p>
        </div>
        {!withVersions.length && <p className="text-sm text-slate-400">Увімкнених версій поки нема: усі бачать оригінали.</p>}
        {withVersions.map((s) => (
          <div key={s.site} className="space-y-2">
            <h3 className="text-sm font-medium">{s.name} <span className="text-slate-500">({s.site})</span></h3>
            {s.versions.map((v) => (
              <div key={v.variant} className="rounded-lg border border-slate-800 p-3 text-sm space-y-1">
                <div className="flex flex-wrap items-center gap-2"><span className="px-2 py-0.5 rounded bg-slate-800 text-xs">{v.variant}</span><span className="font-medium">{v.name}</span>{v.status !== 'active' && <span className="text-xs text-amber-200">вимкнена</span>}<span className="ml-auto"><CopyLink url={v.url} /></span></div>
                <a className="text-xs text-brand-light break-all" href={v.url} target="_blank" rel="noreferrer">{v.url}</a>
                <ul className="list-disc pl-5 text-slate-300 text-xs">{(v.changes || []).map((c, i) => <li key={i}>{c.element}: {ACTIONS[c.action] || c.action}{c.after ? ` → ${c.after}` : ''}{c.before ? ` (було: ${c.before})` : ''}</li>)}</ul>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="card p-5 space-y-2">
        <h2 className="font-medium">Надіслані правки</h2>
        {!data.edits.length && <p className="text-sm text-slate-400">Ще нічого не надсилали.</p>}
        {data.edits.map((e) => (
          <div key={`${e.id}-${e.at}`} className="rounded-lg border border-slate-800 p-3 text-sm space-y-1">
            <div className="text-xs text-slate-500">№{e.id} · {e.site} · {e.kind === 'ab' ? 'перевірити варіант' : 'змінити сайт'} · {fmt.dt(e.at)}{versionOfEdit(e.id).length ? <span className="text-emerald-300"> · зроблено версію {versionOfEdit(e.id).join(', ')}</span> : null}</div>
            <div className="whitespace-pre-wrap">{e.message}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
