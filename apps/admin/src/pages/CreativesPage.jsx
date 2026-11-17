import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '../api/client';

const STATUS = { draft: 'чернетка', scheduled: 'заплановано', published: 'у роботі', archived: 'в архіві' };
const GEN = { pending: 'ще створюється', processing: 'створюється', done: 'готово', failed: 'помилка' };

function Order({ bundles, wishes, onDone }) {
  const [f, setF] = useState({ bundleId: '', format: 'image', count: '3', note: '' });
  const [picked, setPicked] = useState(() => new Set());
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrs({ ...errs, [k]: '' }); setMsg(''); };
  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function send(e) {
    e.preventDefault();
    const er = {};
    const count = Number(f.count);
    if (!(count >= 1 && count <= 10)) er.count = 'Від 1 до 10';
    if (!f.bundleId && !picked.size && !f.note.trim()) er.bundleId = 'Оберіть зв\'язку, позначте побажання або напишіть своє';
    setErrs(er); if (Object.keys(er).length) return;
    setBusy(true); setMsg('');
    try {
      await api.orderCreatives({ bundleId: f.bundleId || undefined, format: f.format, count, note: f.note, wishes: wishes.filter((w) => picked.has(w.id)).map((w) => w.text) });
      setMsg('Запит передано контент-менеджеру. Готові креативи зʼявляться тут зі статусом «чернетка»; відповідь менеджера — у чаті контент-платформи.');
      setPicked(new Set()); setF({ ...f, note: '' }); onDone();
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={send} className="card p-5 space-y-4">
      <h2 className="font-medium">Замовити нові креативи</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="lbl" htmlFor="o-b">Для якої зв'язки</label>
          <select id="o-b" className="inp" value={f.bundleId} onChange={set('bundleId')}><option value="">без зв'язки (лише за побажаннями)</option>{bundles.map((b) => <option key={b.id} value={b.id}>{b.code ? `[${b.code}] ` : ''}{b.name}</option>)}</select>
          {errs.bundleId && <p className="text-red-300 text-xs mt-1">{errs.bundleId}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="lbl" htmlFor="o-f">Формат</label><select id="o-f" className="inp" value={f.format} onChange={set('format')}><option value="image">Картинка 4:5</option><option value="story">Сторіз 9:16</option><option value="video">Відео</option></select></div>
          <div><label className="lbl" htmlFor="o-c">Скільки</label><input id="o-c" className="inp" inputMode="numeric" value={f.count} onChange={set('count')} />{errs.count && <p className="text-red-300 text-xs mt-1">{errs.count}</p>}</div>
        </div>
      </div>
      {wishes.length > 0 && (
        <fieldset>
          <legend className="lbl">Побажання, складені з рекомендацій (приберіть зайве)</legend>
          <div className="space-y-2">
            {wishes.map((w) => (
              <label key={w.id} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={picked.has(w.id)} onChange={() => toggle(w.id)} /><span>{w.text}{w.preliminary && <span className="text-xs text-slate-500"> (попередньо)</span>}</span></label>
            ))}
          </div>
        </fieldset>
      )}
      <div><label className="lbl" htmlFor="o-n">Ваші побажання</label><textarea id="o-n" rows={3} className="inp" value={f.note} onChange={set('note')} placeholder="Наприклад: без людей на фото, більше цифр у заголовку, тон спокійний" /></div>
      <div className="flex items-center gap-3"><button className="btn-primary" disabled={busy}>{busy ? 'Надсилаю…' : 'Створити креативи'}</button>{msg && <span className="text-sm text-slate-300">{msg}</span>}</div>
      <p className="text-xs text-slate-500">Запит іде контент-менеджеру в контент-платформі. Креативи створюються і зберігаються там, у кабінет Meta вони самі не потрапляють.</p>
    </form>
  );
}

export default function CreativesPage() {
  const [list, setList] = useState(null);
  const [wishes, setWishes] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [error, setError] = useState('');
  const load = () => api.creatives().then((d) => setList(d.creatives)).catch((e) => setError(e.message));
  useEffect(() => { load(); api.wishes().then((d) => setWishes(d.wishes)).catch(() => {}); api.bundles().then((d) => setBundles(d.bundles)).catch(() => {}); }, []);

  if (error) return <div className="card p-8 text-center"><p className="text-sm text-slate-300 mb-4">{error}</p><Link to="/connections" className="btn-primary">До підключень</Link></div>;
  if (!list) return <div className="text-slate-500 text-sm">Завантаження…</div>;
  return (
    <div className="space-y-5">
      <Order bundles={bundles} wishes={wishes} onDone={() => setTimeout(load, 1500)} />
      <div className="flex items-baseline gap-3"><h1 className="text-lg font-medium">Креативи з контент-платформи</h1><span className="text-sm text-slate-400">{list.length}</span></div>
      {list.length === 0 ? <div className="card p-8 text-center text-slate-400 text-sm">Рекламних креативів ще нема. Замовте перші формою вище.</div> : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {list.map((c) => (
            <article key={c.id} className="card overflow-hidden flex flex-col">
              <div className="aspect-[4/5] bg-slate-950 flex items-center justify-center">
                {c.mediaUrl && c.mediaType === 'video' ? <video src={c.mediaUrl} className="max-h-full max-w-full" controls preload="none" /> : c.mediaUrl ? <img src={c.mediaUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain" /> : <div className="px-4 text-center text-sm text-slate-400">{GEN[c.generationStatus] || 'Зображення ще нема'}</div>}
              </div>
              <div className="p-3 space-y-1">
                <div className="flex items-center gap-2"><span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">№{c.number}</span><span className="text-[11px] text-slate-400">{STATUS[c.status] || c.status}</span>{c.violations && <span className={clsx('text-[11px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-200')}>порушує правила</span>}</div>
                {c.hook && <div className="text-sm font-medium leading-snug">{c.hook}</div>}
                {c.text && <div className="text-xs text-slate-400 line-clamp-3">{c.text}</div>}
                {c.persona && <div className="text-[11px] text-brand-light">{c.persona.name}</div>}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
