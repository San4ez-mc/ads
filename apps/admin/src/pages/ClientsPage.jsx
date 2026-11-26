import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api, fmt } from '../api/client';

const SRC = { site: 'Сайт', flows: 'Бот', calendar: 'Календар', instagram: 'Instagram', manual: 'Вручну' };
const OUTCOMES = [['came', 'Зустріч була'], ['no_show', 'Не прийшли'], ['thinking', 'Думають'], ['refused', 'Відмова']];
const STAGES = [['wrote', 'Написав'], ['answered', 'Отримав відповідь'], ['offer', 'Отримав пропозицію'], ['paid', 'Оплатив консультацію']];

function SaleForm({ client, onDone }) {
  const [f, setF] = useState({ product: '', amount: '' });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrs({ ...errs, [k]: '' }); setMsg(''); };
  async function save(e) {
    e.preventDefault();
    const er = {};
    if (!f.product.trim()) er.product = 'Що купив';
    if (!(Number(f.amount) > 0)) er.amount = 'Сума більше нуля';
    setErrs(er); if (Object.keys(er).length) return;
    setBusy(true);
    try { await api.addSale(client.id, { product: f.product, amount: Number(f.amount) }); setF({ product: '', amount: '' }); onDone(); } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="flex flex-wrap gap-2 items-start mt-2">
      <div><input aria-label="Що купив" className="inp !w-56" placeholder="Що купив (наприклад, супровід)" value={f.product} onChange={set('product')} />{errs.product && <p className="text-red-300 text-xs mt-1">{errs.product}</p>}</div>
      <div><input aria-label="Сума, грн" className="inp !w-32" inputMode="decimal" placeholder="Сума, грн" value={f.amount} onChange={set('amount')} />{errs.amount && <p className="text-red-300 text-xs mt-1">{errs.amount}</p>}</div>
      <button className="btn-ghost" disabled={busy}>{busy ? '…' : 'Додати продаж'}</button>
      {msg && <span className="text-sm text-red-300">{msg}</span>}
    </form>
  );
}

/** Чим закінчилась зустріч; покупку записують продажем нижче. */
function Outcome({ c, run }) {
  const [reason, setReason] = useState(c.refusalReason || '');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Результат зустрічі">
        <span className="text-xs text-slate-500 mr-1">Зустріч:</span>
        {OUTCOMES.map(([k, label]) => <button key={k} type="button" aria-pressed={c.outcome === k} className={clsx('btn !py-1 text-xs', c.outcome === k ? 'bg-brand/20 text-brand-light' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')} onClick={() => run(() => api.patchClient(c.id, { outcome: c.outcome === k ? null : k }))}>{label}</button>)}
      </div>
      {c.outcome === 'refused' && (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api.patchClient(c.id, { refusalReason: reason })); }}>
          <input aria-label="Чому відмовились" className="inp !w-80" placeholder="Чому відмовились" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn-ghost">{reason.trim() === (c.refusalReason || '') ? 'Збережено' : 'Зберегти причину'}</button>
        </form>
      )}
    </div>
  );
}

function ClientCard({ c, onChange }) {
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fn) => { setErr(''); try { await fn(); onChange(); } catch (e) { setErr(e.message); } };
  return (
    <article className="card p-4">
      <div className="flex flex-wrap items-center gap-2 cursor-pointer" onClick={() => setOpen(!open)}>
        <h3 className="text-sm font-medium">{c.label}</h3>
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{SRC[c.source] || c.source}</span>
        {c.outcome === 'no_show' ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-200">не прийшли</span> : c.outcome === 'refused' ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-200" title={c.refusalReason || ''}>відмова{c.refusalReason ? `: ${c.refusalReason.slice(0, 40)}` : ''}</span> : c.consultDone && <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-200">{c.outcome === 'thinking' ? 'зустріч була, думають' : 'зустріч була'}</span>}
        {c.sales.length > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-200">продажі: {fmt.money(c.salesTotal)}</span>}
        <span className="text-xs text-slate-500 ml-auto">{c.adName ? `оголошення «${c.adName}»` : c.adExtId ? `оголошення ${c.adExtId}` : 'оголошення невідоме'}</span>
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-800 pt-3" onClick={(e) => e.stopPropagation()}>
          {c.source === 'instagram' && (
            <div className="flex flex-wrap gap-1">{STAGES.map(([k, label]) => <button key={k} className={clsx('btn !py-1 text-xs', c.stage === k ? 'bg-brand/20 text-brand-light' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')} onClick={() => run(() => api.patchClient(c.id, { stage: k }))}>{label}</button>)}</div>
          )}
          <Outcome c={c} run={run} />
          {c.sales.length > 0 && (
            <ul className="text-sm space-y-1">
              {c.sales.map((s) => <li key={s.id} className="flex items-center gap-2"><span>{s.product}: {fmt.money(s.amount)} · {new Date(s.soldAt).toLocaleDateString('uk-UA')}</span><button className="text-xs text-slate-500 hover:text-red-300" onClick={() => run(() => api.deleteSale(c.id, s.id))}>прибрати</button></li>)}
            </ul>
          )}
          <SaleForm client={c} onDone={onChange} />
          {c.note && <p className="text-xs text-slate-400">{c.note}</p>}
          <div className="flex items-center gap-2">
            {confirmDel ? <><span className="text-xs text-amber-200">Видалити клієнта разом із його продажами в обліку?</span><button className="btn-danger !py-1 text-xs" onClick={() => run(() => api.deleteClient(c.id))}>Так, видалити</button><button className="btn-ghost !py-1 text-xs" onClick={() => setConfirmDel(false)}>Ні</button></> : <button className="btn-ghost !py-1 text-xs" onClick={() => setConfirmDel(true)}>Видалити</button>}
          </div>
          {err && <div className="text-sm text-red-300">{err}</div>}
        </div>
      )}
    </article>
  );
}

function NewClient({ onDone }) {
  const [f, setF] = useState({ label: '', source: 'instagram', adExtId: '', note: '' });
  const [errs, setErrs] = useState({});
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrs({ ...errs, [k]: '' }); setMsg(''); };
  async function save(e) {
    e.preventDefault();
    if (!f.label.trim()) { setErrs({ label: 'Введіть підпис' }); return; }
    try { await api.createClient(f); setF({ ...f, label: '', note: '' }); onDone(); } catch (err) { setMsg(err.message); }
  }
  return (
    <form onSubmit={save} className="card p-4 space-y-3">
      <h2 className="text-sm font-medium">Додати клієнта вручну</h2>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2"><label className="lbl" htmlFor="nc-l">Підпис (імʼя чи нік, як вам зручно)</label><input id="nc-l" className="inp" value={f.label} onChange={set('label')} />{errs.label && <p className="text-red-300 text-xs mt-1">{errs.label}</p>}</div>
        <div><label className="lbl" htmlFor="nc-s">Звідки</label><select id="nc-s" className="inp" value={f.source} onChange={set('source')}><option value="instagram">Повідомлення в Instagram</option><option value="manual">Інше</option></select></div>
        <div><label className="lbl" htmlFor="nc-a">Номер оголошення (якщо знаєте)</label><input id="nc-a" className="inp font-mono" value={f.adExtId} onChange={set('adExtId')} placeholder="необовʼязково" /></div>
      </div>
      <div className="flex items-center gap-3"><button className="btn-primary">Додати</button>{msg && <span className="text-sm text-red-300">{msg}</span>}</div>
    </form>
  );
}

export default function ClientsPage() {
  const [data, setData] = useState(null);
  const [cands, setCands] = useState([]);
  const [labels, setLabels] = useState({});
  const [error, setError] = useState('');
  const load = () => Promise.all([api.clients(), api.clientCandidates()]).then(([c, k]) => { setData(c); setCands(k.candidates); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (error) return <div className="card p-6 text-red-300 text-sm">{error}</div>;
  if (!data) return <div className="text-slate-500 text-sm">Завантаження…</div>;
  const t = data.totals;

  async function adopt(c) {
    const label = (labels[c.eventId] || '').trim();
    if (!label) { setLabels({ ...labels, [c.eventId]: '' }); setError('Введіть підпис, щоб додати людину в список'); return; }
    setError('');
    try { await api.createClient({ label, fromEventId: c.eventId }); load(); } catch (e) { setError(e.message); }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div><h1 className="text-lg font-medium">Клієнти</h1><p className="text-sm text-slate-400">Тут ви позначаєте, хто провів консультацію і що купив далі. Ці позначки потрапляють у карту, ціну продажу і звіти. Імен і телефонів із сайтів платформа не бере.</p></div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {[['Людей у списку', t.clients], ['Зустрічей було', t.consults], ['Не прийшли', t.noShow], ['Відмов', t.refused], ['Продажів далі', t.upsells], ['Дохід з продажів далі', fmt.money(t.upsellRevenue)]].map(([k, v]) => <div key={k} className="bg-slate-900 rounded-lg p-4"><div className="text-xs text-slate-400">{k}</div><div className="text-2xl font-medium mt-1">{v}</div></div>)}
      </div>

      {cands.length > 0 && (
        <section className="card p-4 space-y-3">
          <h2 className="text-sm font-medium">Записи й оплати без позначки</h2>
          <p className="text-xs text-slate-400">Останні записи на зустріч і оплати з сайту, бота й календаря. Дайте підпис (ви впізнаєте людину за часом), щоб відмітити, чим закінчилась зустріч і що купили.</p>
          <div className="space-y-2">
            {cands.slice(0, 12).map((c) => (
              <div key={c.eventId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-400 w-40">{fmt.dt(c.ts)}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{SRC[c.source] || c.source}</span>
                <span>{c.kind === 'booking' ? 'запис на зустріч' : c.amount ? fmt.money(c.amount) : 'оплата'}</span>
                <span className="text-xs text-slate-500">{c.adName || (c.adExtId ? `оголошення ${c.adExtId}` : 'оголошення невідоме')}</span>
                <input aria-label="Підпис клієнта" className="inp !w-44 ml-auto" placeholder="Підпис" value={labels[c.eventId] || ''} onChange={(e) => setLabels({ ...labels, [c.eventId]: e.target.value })} />
                <button className="btn-ghost !py-1.5" onClick={() => adopt(c)}>Додати</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <NewClient onDone={load} />
      {data.clients.length === 0 ? <div className="card p-8 text-center text-slate-400 text-sm">Клієнтів ще нема. Додайте першого вручну або з оплати вище.</div> : <div className="space-y-2">{data.clients.map((c) => <ClientCard key={c.id} c={c} onChange={load} />)}</div>}
    </div>
  );
}
