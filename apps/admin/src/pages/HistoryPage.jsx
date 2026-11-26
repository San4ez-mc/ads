// «Історія»: усі варіанти воронок — заплановані, ті, що йдуть, і перевірені. Тут видно, що змінювали, які цифри вийшли
// і який висновок, щоб не тестувати те саме двічі й покращувати саме те, що спрацювало.
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api, fmt } from '../api/client';
import { useAuthStore } from '../stores/authStore';

const ST = {
  planned: ['заплановано', 'bg-slate-800 text-slate-300'], running: ['тестуємо', 'bg-sky-900/50 text-sky-200'],
  won: ['спрацювало', 'bg-emerald-900/50 text-emerald-200'], lost: ['не спрацювало', 'bg-red-900/50 text-red-200'], stopped: ['зупинено', 'bg-amber-900/40 text-amber-200'],
};
const FILTERS = [['all', 'Усі'], ['running', 'Тестуємо'], ['planned', 'Заплановані'], ['done', 'Перевірені']];
const FIELDS = [['audience', 'Кому'], ['pain', 'Біль'], ['offer', 'Пропозиція'], ['creative', 'Креатив'], ['site', 'Сайт'], ['bot', 'Бот']];
const LONG = [['title', 'Назва варіанта'], ['changed', 'Що змінено порівняно з попереднім'], ['hypothesis', 'Припущення: що має вийти й чому']];
const empty = { code: '', title: '', changed: '', hypothesis: '', audience: '', pain: '', offer: '', creative: '', site: '', bot: '', budgetUah: '', adExtIds: [], parentId: '' };

function Form({ start, ads, onClose, onSaved }) {
  const [f, setF] = useState({ ...empty, ...start, budgetUah: start.budgetUah ?? '', adExtIds: start.adExtIds || [] });
  const [errs, setErrs] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrs({ ...errs, [k]: '' }); setError(null); };
  const toggle = (id) => setF({ ...f, adExtIds: f.adExtIds.includes(id) ? f.adExtIds.filter((x) => x !== id) : [...f.adExtIds, id] });

  async function save(e, force) {
    e?.preventDefault();
    const er = {};
    if (!f.code.trim()) er.code = 'Наприклад V6';
    if (!f.title.trim()) er.title = 'Назвіть варіант';
    setErrs(er); if (Object.keys(er).length) return;
    setBusy(true); setError(null);
    const body = { ...f, force };
    try { if (f.id) await api.patchExperiment(f.id, body); else await api.createExperiment(body); onSaved(); } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} noValidate className="card p-5 space-y-4">
      <div className="flex items-center gap-3"><h2 className="font-medium">{f.id ? `Варіант ${f.code}` : 'Новий варіант'}</h2><button type="button" className="btn-ghost !py-1 text-xs ml-auto" onClick={onClose}>Закрити форму</button></div>
      <div className="grid gap-3 md:grid-cols-4">
        <div><label className="lbl" htmlFor="x-code">Код</label><input id="x-code" className="inp" value={f.code} onChange={set('code')} maxLength={12} />{errs.code && <p className="text-red-300 text-xs mt-1">{errs.code}</p>}</div>
        {LONG.map(([k, label]) => <div key={k} className={k === 'title' ? 'md:col-span-3' : 'md:col-span-4'}><label className="lbl" htmlFor={`x-${k}`}>{label}</label><input id={`x-${k}`} className="inp" value={f[k] || ''} onChange={set(k)} />{errs[k] && <p className="text-red-300 text-xs mt-1">{errs[k]}</p>}</div>)}
        {FIELDS.map(([k, label]) => <div key={k} className="md:col-span-2"><label className="lbl" htmlFor={`x-${k}`}>{label}</label><input id={`x-${k}`} className="inp" value={f[k] || ''} onChange={set(k)} /></div>)}
        <div><label className="lbl" htmlFor="x-b">Бюджет тесту, грн</label><input id="x-b" className="inp" inputMode="decimal" value={f.budgetUah} onChange={set('budgetUah')} /></div>
      </div>
      <fieldset><legend className="lbl">Оголошення цього варіанта (за ними рахуються цифри)</legend>
        {ads.length === 0 ? <p className="text-sm text-slate-500">Оголошень ще нема: позначите після створення.</p> : (
          <div className="grid gap-1 max-h-48 overflow-y-auto sm:grid-cols-2">{ads.map((a) => <label key={a.externalId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.adExtIds.includes(a.externalId)} onChange={() => toggle(a.externalId)} /><span className="truncate">{a.name} <span className="text-slate-500">· {a.campaign.name}</span></span></label>)}</div>
        )}
      </fieldset>
      {error && <div className="text-sm text-red-300">{error.message}{error.status === 409 && !error.message.startsWith('Код') && <button type="button" className="btn-ghost !py-1 text-xs ml-2" onClick={() => save(null, true)}>Все одно зберегти</button>}</div>}
      <button className="btn-primary" disabled={busy}>{busy ? 'Зберігаю…' : 'Зберегти'}</button>
    </form>
  );
}

function Close({ x, onDone, onCancel }) {
  const [status, setStatus] = useState('lost');
  const [conclusion, setConclusion] = useState(x.conclusion || '');
  const [error, setError] = useState('');
  async function save() {
    if (!conclusion.trim()) return setError('Запишіть, що дізнались: без цього тест не закривається');
    try { await api.patchExperiment(x.id, { status, conclusion }); return onDone(); } catch (e) { return setError(e.message); }
  }
  return (
    <div className="space-y-2 border-t border-slate-800 pt-3">
      <select aria-label="Підсумок" className="inp !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="won">Спрацювало</option><option value="lost">Не спрацювало</option><option value="stopped">Зупинили без висновку про ідею</option></select>
      <textarea aria-label="Висновок" rows={3} className="inp" value={conclusion} onChange={(e) => { setConclusion(e.target.value); setError(''); }} placeholder="Що дізнались: що спрацювало, що ні, що пробуємо далі" />
      {error && <p className="text-red-300 text-xs">{error}</p>}
      <div className="flex gap-2"><button className="btn-primary" onClick={save}>Закрити тест</button><button className="btn-ghost" onClick={onCancel}>Скасувати</button></div>
    </div>
  );
}

function Card({ x, parent, canEdit, onEdit, onCopy, reload }) {
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const [label, cls] = ST[x.status];
  const r = x.result;
  const run = async (fn) => { setError(''); try { await fn(); await reload(); } catch (e) { setError(e.message); } };
  const open = x.status === 'planned' || x.status === 'running';
  return (
    <article className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs px-2 py-0.5 rounded bg-slate-800">{x.code}</span>
        <h2 className="font-medium">{x.title}</h2>
        <span className={clsx('text-xs px-2 py-0.5 rounded-md', cls)}>{label}</span>
        <span className="text-xs text-slate-500 ml-auto">{x.dateFrom ? `${x.dateFrom} – ${x.dateTo || 'зараз'}` : x.budgetUah ? `бюджет ${fmt.money(x.budgetUah)}` : ''}</span>
      </div>
      {x.changed && <div className="text-sm"><span className="text-slate-500">Що змінено{parent ? ` порівняно з ${parent.code}` : ''}: </span>{x.changed}</div>}
      {x.hypothesis && <div className="text-sm text-slate-400">{x.hypothesis}</div>}
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {FIELDS.filter(([k]) => x[k]).map(([k, name]) => <div key={k} className="flex gap-2"><dt className="text-slate-500 shrink-0 w-24">{name}</dt><dd className="min-w-0">{x[k]}</dd></div>)}
      </dl>
      {r && (
        <div className="rounded-lg bg-slate-950/60 p-3 space-y-2">
          <div className="text-sm">Витрачено <b>{fmt.money(r.spend)}</b> · покази {fmt.int(r.impressions)} · переходи {fmt.int(r.linkClicks)}{r.linkClicks ? ` · ${fmt.money2(r.spend / r.linkClicks)} за перехід` : ''}</div>
          {r.steps?.length > 0 && <div className="flex flex-wrap gap-2">{r.steps.map((s) => <div key={`${s.element}|${s.title}`} className="rounded-md border border-slate-800 px-2 py-1 text-xs"><span className="text-slate-500">{s.element}: </span>{s.title} <b>{fmt.int(s.people)}</b>{s.people ? <span className="text-slate-500"> · {fmt.money(r.spend / s.people)}</span> : null}</div>)}</div>}
          {r.note && <div className="text-xs text-slate-400">{r.note}</div>}
        </div>
      )}
      {x.conclusion && <div className="text-sm"><span className="text-slate-500">Висновок: </span>{x.conclusion}</div>}
      {error && <div className="text-sm text-red-300">{error}</div>}
      {canEdit && (closing ? <Close x={x} onDone={() => { setClosing(false); reload(); }} onCancel={() => setClosing(false)} /> : (
        <div className="flex flex-wrap gap-2">
          {x.status === 'planned' && <button className="btn-primary !py-1.5" onClick={() => run(() => api.patchExperiment(x.id, { status: 'running' }))}>Почали тестувати</button>}
          {x.status === 'running' && <button className="btn-primary !py-1.5" onClick={() => setClosing(true)}>Закрити з висновком</button>}
          {open && <button className="btn-ghost !py-1.5" onClick={() => onEdit(x)}>Редагувати</button>}
          <button className="btn-ghost !py-1.5" onClick={() => onCopy(x)}>Новий варіант на основі цього</button>
          {x.status === 'planned' && <button className="btn-ghost !py-1.5 ml-auto" onClick={() => run(() => api.deleteExperiment(x.id))}>Прибрати</button>}
        </div>
      ))}
    </article>
  );
}

export default function HistoryPage() {
  const canEdit = useAuthStore((s) => s.can('bundles'));
  const [list, setList] = useState(null);
  const [ads, setAds] = useState([]);
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const load = () => api.experiments().then((d) => setList(d.experiments)).catch((e) => setError(e.message));
  useEffect(() => { load(); api.ads({ all: 1 }).then((d) => setAds(d.ads.filter((a) => a.running || a.spend > 0))).catch(() => {}); }, []);
  if (!list) return <div className="text-slate-500 text-sm">{error || 'Завантаження…'}</div>;

  const nextCode = () => { let n = 1; while (list.some((x) => x.code === `V${n}`)) n += 1; return `V${n}`; };
  const copy = (x) => { setForm({ ...x, id: undefined, code: nextCode(), title: `${x.title} (нова версія)`, parentId: x.id, changed: '', conclusion: '', adExtIds: [], status: undefined, dateFrom: undefined, dateTo: undefined, result: undefined }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const shown = list.filter((x) => filter === 'all' || x.status === filter || (filter === 'done' && !['planned', 'running'].includes(x.status)));
  // Спершу те, що йде зараз, далі заплановане, потім перевірене (свіжі вгорі).
  const order = { running: 0, planned: 1 };
  shown.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || ((order[a.status] ?? 2) === 2 ? String(b.dateTo).localeCompare(String(a.dateTo)) : a.code.localeCompare(b.code, 'uk', { numeric: true })));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-medium">Історія тестів</h1>
        <div className="inline-flex rounded-lg bg-slate-900 border border-slate-800 p-1" role="group" aria-label="Які тести показати">{FILTERS.map(([k, label]) => <button key={k} aria-pressed={filter === k} className={clsx('btn !py-1', filter === k ? 'bg-brand/20 text-brand-light' : 'text-slate-300 hover:bg-slate-800')} onClick={() => setFilter(k)}>{label}</button>)}</div>
        {canEdit && !form && <button className="btn-primary ml-auto" onClick={() => setForm({ ...empty, code: nextCode() })}>Новий варіант</button>}
      </div>
      {error && <div className="text-sm text-red-300">{error}</div>}
      {form && <Form key={form.id || form.code} start={form} ads={ads} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
      {shown.length === 0 ? <div className="card p-8 text-center text-slate-400 text-sm">{list.length === 0 ? 'Тестів ще нема. Заведіть перший варіант: кому, який біль, яка пропозиція і яким шляхом.' : 'У цьому списку порожньо.'}</div>
        : shown.map((x) => <Card key={x.id} x={x} parent={list.find((p) => p.id === x.parentId)} canEdit={canEdit} onEdit={setForm} onCopy={copy} reload={load} />)}
    </div>
  );
}
