import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { api, fmt } from '../api/client';
import { COLOR } from '../lib/mapLayout';

const COLS = [['draft', 'Чернетка', 'Ще не запускали'], ['test', 'Тест', 'Крутиться, збираємо дані'], ['works', 'Працює', 'Ціна продажу в межах цілі'], ['scale', 'Масштабуємо', 'Додаємо бюджет'], ['fails', 'Не працює', 'Закрито з підсумком']];
const EMPTY = { name: '', code: '', hypothesis: '', audienceId: '', product: '', promise: '', angle: '', pathText: '', testBudgetUsd: '', stopRule: '', verdict: '', status: 'draft' };

function Editor({ bundle, audiences, elements, onClose, onSaved }) {
  const [f, setF] = useState(() => (bundle ? { name: bundle.name, code: bundle.code || '', hypothesis: bundle.hypothesis || '', audienceId: bundle.audience?.id || '', product: bundle.product || '', promise: bundle.promise || '', angle: bundle.angle || '', path: bundle.path || [], testBudgetUsd: bundle.testBudgetUsd ?? '', stopRule: bundle.stopRule?.text || '', verdict: bundle.verdict || '', status: bundle.status } : { ...EMPTY, path: [] }));
  const [errs, setErrs] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newAud, setNewAud] = useState('');
  const [auds, setAuds] = useState(audiences);
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrs({ ...errs, [k]: '' }); setError(''); };
  const closing = ['works', 'fails'].includes(f.status);

  async function addAudience() {
    if (!newAud.trim()) return;
    try { const a = await api.createAudience({ name: newAud }); setAuds([...auds, a]); setF({ ...f, audienceId: a.id }); setNewAud(''); } catch (e) { setError(e.message); }
  }
  const setPath = (i, patch) => setF({ ...f, path: f.path.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  async function save(e) {
    e.preventDefault();
    const er = {};
    if (!f.name.trim()) er.name = 'Введіть назву';
    if (f.code && !/^[A-Za-zА-Яа-яІіЇїЄєҐґ0-9-]{1,12}$/.test(f.code.trim())) er.code = 'До 12 літер, цифр або дефісів';
    if (f.testBudgetUsd !== '' && !(Number(f.testBudgetUsd) >= 0)) er.testBudgetUsd = 'Число від 0';
    if (closing && !f.verdict.trim()) er.verdict = 'Запишіть, що дізнались, — без цього тест не закривається';
    setErrs(er); if (Object.keys(er).length) return;
    setBusy(true); setError('');
    const body = { name: f.name, code: f.code, hypothesis: f.hypothesis, audienceId: f.audienceId || null, product: f.product, promise: f.promise, angle: f.angle, path: f.path, testBudgetUsd: f.testBudgetUsd === '' ? null : Number(f.testBudgetUsd), stopRule: { text: f.stopRule }, verdict: f.verdict, status: f.status };
    try { if (bundle) await api.patchBundle(bundle.id, body); else await api.createBundle(body); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  }
  async function remove() { setBusy(true); try { await api.deleteBundle(bundle.id); onSaved(); } catch (err) { setError(err.message); setBusy(false); } }

  return (
    <form onSubmit={save} className="card p-5 space-y-4 max-w-4xl">
      <div className="flex items-center gap-3"><h2 className="text-lg font-medium flex-1">{bundle ? 'Зв\'язка' : 'Нова зв\'язка'}</h2><button type="button" className="btn-ghost" onClick={onClose}>Закрити</button></div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2"><label className="lbl" htmlFor="b-name">Назва</label><input id="b-name" className="inp" value={f.name} onChange={set('name')} placeholder="Лендінг → бот · рутина · власники бізнесу" />{errs.name && <p className="text-red-300 text-xs mt-1">{errs.name}</p>}</div>
        <div><label className="lbl" htmlFor="b-code">Код</label><input id="b-code" className="inp" value={f.code} onChange={set('code')} placeholder="A1" />{errs.code ? <p className="text-red-300 text-xs mt-1">{errs.code}</p> : <p className="text-xs text-slate-500 mt-1">Кампанія з «[{f.code || 'A1'}]» у назві потрапить у цю зв'язку.</p>}</div>
      </div>
      <div><label className="lbl" htmlFor="b-hyp">Що перевіряємо (одним реченням)</label><textarea id="b-hyp" rows={2} className="inp" value={f.hypothesis} onChange={set('hypothesis')} placeholder="Власники малого бізнесу відгукнуться на біль «усе роблю вручну» і куплять розбір за 1 500 грн" /></div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="lbl" htmlFor="b-aud">Аудиторія</label>
          <select id="b-aud" className="inp" value={f.audienceId} onChange={set('audienceId')}><option value="">не вибрано</option>{auds.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <div className="flex gap-2 mt-2"><input className="inp" aria-label="Нова аудиторія" value={newAud} onChange={(e) => setNewAud(e.target.value)} placeholder="Нова аудиторія" /><button type="button" className="btn-ghost whitespace-nowrap" onClick={addAudience}>Додати</button></div>
        </div>
        <div><label className="lbl" htmlFor="b-prod">Продукт і ціна</label><input id="b-prod" className="inp" value={f.product} onChange={set('product')} placeholder="Розбір процесу, 1 500 грн" /></div>
        <div><label className="lbl" htmlFor="b-prom">Обіцянка</label><textarea id="b-prom" rows={2} className="inp" value={f.promise} onChange={set('promise')} placeholder="1 зустріч → план автоматизації" /></div>
        <div><label className="lbl" htmlFor="b-angle">Біль / кут креативів</label><textarea id="b-angle" rows={2} className="inp" value={f.angle} onChange={set('angle')} placeholder="Одна людина робить усе вручну" /></div>
      </div>
      <fieldset>
        <legend className="lbl">Шлях (зліва направо)</legend>
        <div className="space-y-2">
          {f.path.map((p, i) => (
            <div key={i} className="flex gap-2 items-center">
              <span className="text-xs text-slate-500 w-5">{i + 1}.</span>
              <select aria-label={`Елемент ${i + 1}`} className="inp !w-64" value={p.key || ''} onChange={(e) => setPath(i, { key: e.target.value || null })}><option value="">без даних (лише опис)</option>{elements.map((el) => <option key={el.key} value={el.key}>{el.name}</option>)}</select>
              <input aria-label={`Опис кроку ${i + 1}`} className="inp" value={p.note || ''} onChange={(e) => setPath(i, { note: e.target.value })} placeholder="Що тут відбувається" />
              <button type="button" className="btn-ghost !px-2" onClick={() => setF({ ...f, path: f.path.filter((_, j) => j !== i) })} aria-label="Прибрати крок">✕</button>
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={() => setF({ ...f, path: [...f.path, { key: null, note: '' }] })}>Додати крок шляху</button>
        </div>
      </fieldset>
      <div className="grid gap-4 md:grid-cols-3">
        <div><label className="lbl" htmlFor="b-bud">Бюджет тесту, доларів</label><input id="b-bud" className="inp" inputMode="decimal" value={f.testBudgetUsd} onChange={set('testBudgetUsd')} placeholder="30" />{errs.testBudgetUsd && <p className="text-red-300 text-xs mt-1">{errs.testBudgetUsd}</p>}</div>
        <div className="md:col-span-2"><label className="lbl" htmlFor="b-stop">Правило зупинки (задається до запуску)</label><input id="b-stop" className="inp" value={f.stopRule} onChange={set('stopRule')} placeholder="Стоп, якщо 40 заходів на лендінг не дали жодної заявки" /></div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div><label className="lbl" htmlFor="b-st">Стан</label><select id="b-st" className="inp" value={f.status} onChange={set('status')}>{COLS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></div>
        <div className="md:col-span-2"><label className="lbl" htmlFor="b-ver">Підсумок: що дізнались</label><textarea id="b-ver" rows={2} className="inp" value={f.verdict} onChange={set('verdict')} placeholder="Заповнюється, коли тест закрито" />{errs.verdict && <p className="text-red-300 text-xs mt-1">{errs.verdict}</p>}</div>
      </div>
      {error && <div className="text-sm text-red-300">{error}</div>}
      <div className="flex flex-wrap gap-2 items-center">
        <button className="btn-primary" disabled={busy}>{busy ? 'Зберігаю…' : 'Зберегти'}</button>
        {bundle && (confirmDel ? <><span className="text-xs text-amber-200 ml-auto">Видалити зв'язку назавжди? Оголошення в кабінеті не зміняться.</span><button type="button" className="btn-danger" onClick={remove} disabled={busy}>Так, видалити</button><button type="button" className="btn-ghost" onClick={() => setConfirmDel(false)}>Ні</button></> : <button type="button" className="btn-ghost ml-auto" onClick={() => setConfirmDel(true)}>Видалити</button>)}
      </div>
    </form>
  );
}

export default function BundlesPage() {
  const [data, setData] = useState(null);
  const [auds, setAuds] = useState([]);
  const [els, setEls] = useState([]);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  async function syncAud() {
    setSyncing(true); setSyncMsg('');
    try { const r = await api.syncAudiences(); setSyncMsg(`Готово: оновлено ${r.pulled}, повʼязано ${r.linked}, створено в контент-платформі ${r.pushed}`); await load(); }
    catch (e) { setSyncMsg(e.message); } finally { setSyncing(false); }
  }

  const load = () => Promise.all([api.bundles(), api.audiences(), api.elements()]).then(([b, a, e]) => { setData(b); setAuds(a.audiences); setEls(e.elements); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (error && !data) return <div className="card p-6 text-red-300 text-sm">{error}</div>;
  if (!data) return <div className="text-slate-500 text-sm">Завантаження…</div>;
  if (edit) return <Editor bundle={edit === 'new' ? null : edit} audiences={auds} elements={els} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />;

  const elName = (key) => els.find((e) => e.key === key)?.name;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-medium">Зв'язки</h1>
        <p className="text-sm text-slate-400">Кому показуємо × що обіцяємо × яким шляхом ведемо. Одна зміна за раз.</p>
        <span className="ml-auto text-xs text-slate-400 max-w-xs">{syncMsg}</span>
        <button className="btn-ghost" onClick={syncAud} disabled={syncing}>{syncing ? 'Синхронізую…' : 'Аудиторії з контент-платформи'}</button>
        <button className="btn-primary" onClick={() => setEdit('new')}>Нова зв'язка</button>
      </div>
      {data.bundles.length === 0 ? <div className="card p-8 text-center text-slate-400 text-sm">Зв'язок ще нема. Створіть першу: аудиторія, обіцянка, шлях і бюджет тесту.</div> : (
        <div className="grid gap-3 items-start" style={{ gridTemplateColumns: 'repeat(5, minmax(230px, 1fr))', overflowX: 'auto' }}>
          {COLS.map(([key, label, hint]) => {
            const list = data.bundles.filter((b) => b.status === key).sort((a, b) => (a.metrics.saleCost ?? 1e12) - (b.metrics.saleCost ?? 1e12));
            return (
              <section key={key} className="bg-slate-900/50 rounded-xl p-2 min-h-[120px]">
                <header className="px-2 py-1.5"><div className="text-sm font-medium">{label} <span className="text-slate-500 font-normal">{list.length}</span></div><div className="text-[11px] text-slate-500">{hint}</div></header>
                <div className="space-y-2">
                  {list.map((b) => {
                    const m = b.metrics;
                    return (
                      <article key={b.id} className="card p-3 cursor-pointer hover:border-slate-600" onClick={() => setEdit(b)}>
                        <div className="flex items-start gap-2"><h3 className="text-sm font-medium leading-snug flex-1">{b.name}</h3>{b.code && <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">[{b.code}]</span>}</div>
                        {b.audience && <div className="text-[11px] text-brand-light mt-1">{b.audience.name}</div>}
                        {b.path?.length > 0 && <div className="text-[11px] text-slate-400 mt-1 leading-snug">{b.path.map((p) => p.note || elName(p.key) || p.key).join(' → ')}</div>}
                        {m.ads > 0 ? (
                          <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-400 mt-2">
                            <div>Витрачено<div className="text-sm text-slate-100">{fmt.money(m.spend)}</div></div>
                            <div>Продажі<div className="text-sm text-slate-100">{m.sales}</div></div>
                            <div>Ціна продажу<div className="text-sm" style={{ color: COLOR[m.state] }}>{m.saleCost ? fmt.money(m.saleCost) : m.stateLabel}</div></div>
                          </div>
                        ) : null}
                        {m.upsellCount > 0 ? (
                          <div className="text-[11px] text-violet-300 mt-1">Продажі далі: {m.upsellCount} на {fmt.money(m.upsellRevenue)} · дохід на один продаж {fmt.money(m.returnPerSale)}</div>
                        ) : null}
                        {m.ads === 0 && <div className="text-[11px] text-slate-500 mt-2">Оголошень ще нема{b.code ? ` — назвіть кампанію з «[${b.code}]»` : ''}</div>}
                        {b.testBudgetUsd !== null && <div className="mt-2"><div className="h-1.5 rounded bg-slate-800 overflow-hidden"><div className={clsx('h-full', m.budgetUsedPct >= 100 ? 'bg-red-400' : 'bg-brand')} style={{ width: `${Math.min(100, m.budgetUsedPct || 0)}%` }} /></div><div className="text-[11px] text-slate-500 mt-1">бюджет тесту: {m.spendUsd} з {b.testBudgetUsd} дол.</div></div>}
                        {b.stopRule?.text && <div className="text-[11px] text-slate-500 mt-1">Стоп: {b.stopRule.text}</div>}
                        {b.verdict && <div className="text-[11px] text-slate-300 mt-2 border-t border-slate-800 pt-2">{b.verdict}</div>}
                        <Link to={`/?bundle=${b.id}`} onClick={(e) => e.stopPropagation()} className="text-[11px] text-brand-light hover:underline mt-2 inline-block">Відкрити на карті</Link>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
