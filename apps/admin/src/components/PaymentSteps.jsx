// «Що вважати оплатою»: кроки сайтів і воронок, після яких людина рахується клієнтом, і сума, якщо джерело її не передає.
// Зміни зберігаються одразу. Дорожчий продукт, відмічений у «Клієнтах», рахується завжди й тут не показується.
import { useEffect, useState } from 'react';
import { api } from '../api/client';

const isUpsell = (el, s) => el.key === 'manual:consult' && s.key === 'upsell';

export default function PaymentSteps() {
  const [els, setEls] = useState(null);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const load = () => api.elements().then((d) => setEls(d.elements)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function save(el, key, data) {
    setError('');
    try { await api.patchStep(el.id, key, data); await load(); } catch (e) { setError(e.message); }
  }

  if (!els) return <section className="card p-5 text-sm text-slate-500">{error || 'Завантаження…'}</section>;
  const all = els.flatMap((el) => el.steps.filter((s) => !isUpsell(el, s)).map((s) => ({ el, s, id: `${el.id}|${s.key}` })));
  const marked = all.filter((x) => x.s.isSale);
  const rest = els.map((el) => ({ el, steps: all.filter((x) => x.el.id === el.id && !x.s.isSale) })).filter((g) => g.steps.length);

  return (
    <section className="card p-5 space-y-3">
      <div>
        <h2 className="font-medium">Що вважати оплатою</h2>
        <p className="text-xs text-slate-500 mt-1">Хто пройшов один із цих кроків, той клієнт (рахується один раз). Позначайте лише кроки, де людина справді заплатила. Дорожчий продукт із розділу «Клієнти» рахується завжди.</p>
      </div>
      {marked.length === 0 && <p className="text-sm text-amber-200">Жодного кроку не позначено: тоді оплатою вважається лише «оплатив на сайті».</p>}
      {marked.map(({ el, s, id }) => (
        <div key={id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 p-2 text-sm">
          <div className="flex-1 min-w-[200px]"><div>{s.title}</div><div className="text-xs text-slate-500">{el.name}</div></div>
          <label className="flex items-center gap-2 text-xs text-slate-400">Сума, грн
            <input key={`${id}:${s.defaultAmount}`} className="inp !w-28 !py-1" inputMode="decimal" defaultValue={s.defaultAmount ?? ''} placeholder="з джерела"
              onBlur={(e) => { const v = e.target.value.trim().replace(',', '.'); if (v !== String(s.defaultAmount ?? '')) save(el, s.key, { defaultAmount: v === '' ? null : v }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
          </label>
          <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => save(el, s.key, { isSale: false })}>Не оплата</button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <select aria-label="Крок, який вважати оплатою" className="inp !w-auto flex-1" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Оберіть ще один крок…</option>
          {rest.map((g) => <optgroup key={g.el.id} label={g.el.name}>{g.steps.map((x) => <option key={x.id} value={x.id}>{x.s.title}</option>)}</optgroup>)}
        </select>
        <button type="button" className="btn-ghost" disabled={!pick} onClick={() => { const x = all.find((y) => y.id === pick); setPick(''); if (x) save(x.el, x.s.key, { isSale: true }); }}>Вважати оплатою</button>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </section>
  );
}
