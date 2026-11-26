// «Запуск»: нова кампанія з платформи. Порядок: заповнити → перевірити → створити в кабінеті (вимкненою) → увімкнути показ.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { api, fmt } from '../api/client';
import { useAuthStore } from '../stores/authStore';

const ST = {
  draft: ['чернетка', 'bg-slate-800 text-slate-300'],
  creating: ['створюється…', 'bg-sky-900/50 text-sky-200'],
  created: ['створена, вимкнена', 'bg-amber-900/40 text-amber-200'],
  live: ['увімкнена', 'bg-emerald-900/40 text-emerald-200'],
  stopped: ['зупинена', 'bg-slate-800 text-slate-300'],
  failed: ['не створена до кінця', 'bg-red-900/50 text-red-200'],
};
const EVENT = { LEAD: 'Лід', CONTACT: 'Звернення', SCHEDULE: 'Запис на зустріч', COMPLETE_REGISTRATION: 'Реєстрація', PURCHASE: 'Покупка' };
const part = (text, label) => new RegExp(`${label}:[ \\t]*(.+)`).exec(text || '')?.[1] || '';

function Field({ id, label, error, hint, className, children }) {
  return (
    <div className={className}>
      <label className="lbl" htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
      {error && <p className="text-red-300 text-xs mt-1">{error}</p>}
    </div>
  );
}

function Form({ accounts, bundles, creatives, goals, pixelEvents, onSaved }) {
  const usable = accounts.filter((a) => a.canWrite);
  const first = usable[0] || accounts[0];
  const d = first?.defaults || {};
  const [f, setF] = useState({
    connectionId: first?.id || '', bundleId: '', name: '', goal: 'clicks', destType: 'telegram', bot: d.bot || '', slug: 'bot-karta-sales', url: d.url || '',
    dailyBudget: '5', countries: 'UA', ageMin: '25', ageMax: '55', advantageAudience: false,
    pageId: d.pageId || first?.pages?.[0]?.id || '', instagramId: d.instagramId || '', pixelId: d.pixelId || '', pixelEvent: 'LEAD',
  });
  const [picked, setPicked] = useState([]);
  const [errs, setErrs] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const account = accounts.find((a) => a.id === f.connectionId);
  const bundle = bundles.find((b) => b.id === f.bundleId);
  const set = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setF((s) => ({ ...s, [k]: v, ...(k === 'destType' && v === 'telegram' ? { goal: 'clicks' } : {}) })); setErrs((s) => ({ ...s, [k]: '' })); setError(''); };
  const chooseBundle = (e) => { set('bundleId')(e); const b = bundles.find((x) => x.id === e.target.value); setPicked((b?.creativeIds || []).filter((id) => creatives.some((c) => c.id === id && usableCreative(c)))); };
  const toggle = (id) => { setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); setErrs((s) => ({ ...s, creatives: '' })); };

  // Спершу креативи цієї зв'язки, далі решта.
  const inBundle = new Set(bundle?.creativeIds || []);
  const sorted = [...creatives].sort((a, b) => (inBundle.has(b.id) - inBundle.has(a.id)) || (usableCreative(b) - usableCreative(a)) || (b.number - a.number));

  async function save(e) {
    e.preventDefault();
    const er = {};
    if (!f.connectionId) er.connectionId = 'Оберіть кабінет';
    if (!f.bundleId) er.bundleId = 'Оберіть зв\'язку';
    else if (!bundle?.code) er.bundleId = 'У цієї зв\'язки нема коду: задайте його в «Зв\'язках»';
    if (f.destType === 'telegram' && !f.bot.trim()) er.bot = 'Вкажіть імʼя бота';
    if (f.destType === 'telegram' && !f.slug.trim()) er.slug = 'Вкажіть код воронки';
    if (f.destType === 'site' && !/^https:\/\//i.test(f.url.trim())) er.url = 'Адреса має починатися з https://';
    if (!(Number(f.dailyBudget) >= 1)) er.dailyBudget = 'Число від 1';
    if (!/^\d{5,25}$/.test(f.pageId.trim())) er.pageId = 'Номер сторінки — лише цифри';
    if (f.goal === 'leads' && !/^\d{5,25}$/.test(f.pixelId.trim())) er.pixelId = 'Номер пікселя — лише цифри';
    if (!picked.length) er.creatives = 'Оберіть хоча б один креатив';
    setErrs(er); if (Object.keys(er).length) return;
    setBusy(true); setError('');
    try {
      await api.createLaunch({ ...f, pageId: f.pageId.trim(), destination: f.destType === 'telegram' ? { type: 'telegram', bot: f.bot.trim(), slug: f.slug.trim() } : { type: 'site', url: f.url.trim() }, creativeIds: picked });
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} noValidate className="card p-5 space-y-5">
      <h2 className="font-medium">Нова кампанія</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <Field id="l-acc" label="Рекламний кабінет" error={errs.connectionId} hint={account && !account.canWrite ? 'У цього кабінету нема ключа керування: додайте його в «Підключеннях».' : account?.currency ? `Валюта кабінету: ${account.currency}` : null}>
          <select id="l-acc" className="inp" value={f.connectionId} onChange={set('connectionId')}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.canWrite ? '' : ' (лише читання)'}</option>)}</select>
        </Field>
        <Field id="l-b" label="Зв'язка" error={errs.bundleId} hint="За кодом зв'язки в назві кампанії платформа привʼязує цифри.">
          <select id="l-b" className="inp" value={f.bundleId} onChange={chooseBundle}><option value="">оберіть…</option>{bundles.map((b) => <option key={b.id} value={b.id}>{b.code ? `[${b.code}] ` : '[без коду] '}{b.name}</option>)}</select>
        </Field>
        <Field id="l-n" label="Назва кампанії (необовʼязково)" hint={bundle?.code ? `Буде: [${bundle.code}] ${f.name || bundle.name}` : null}>
          <input id="l-n" className="inp" value={f.name} onChange={set('name')} maxLength={180} />
        </Field>

        <Field id="l-dt" label="Куди вести">
          <select id="l-dt" className="inp" value={f.destType} onChange={set('destType')}><option value="telegram">Telegram-бот</option><option value="site">Сайт</option></select>
        </Field>
        {f.destType === 'telegram' ? (
          <>
            <Field id="l-bot" label="Імʼя бота" error={errs.bot}><input id="l-bot" className="inp" value={f.bot} onChange={set('bot')} placeholder="@my_bot" /></Field>
            <Field id="l-slug" label="Код воронки у Flows" error={errs.slug} hint="Номер оголошення платформа впише в посилання сама."><input id="l-slug" className="inp font-mono" value={f.slug} onChange={set('slug')} /></Field>
          </>
        ) : (
          <Field id="l-url" label="Адреса сторінки" error={errs.url} className="md:col-span-2" hint="Мітки й номери кампанії, групи та оголошення платформа допише сама."><input id="l-url" className="inp" value={f.url} onChange={set('url')} placeholder="https://…" /></Field>
        )}

        <Field id="l-goal" label="Мета" className="md:col-span-2" hint={f.destType === 'telegram' ? 'Для бота доступні лише кліки: пікселя на t.me немає.' : null}>
          <select id="l-goal" className="inp" value={f.goal} onChange={set('goal')} disabled={f.destType === 'telegram'}>{goals.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select>
        </Field>
        <Field id="l-budget" label={`Денний бюджет${account?.currency ? `, ${account.currency}` : ''}`} error={errs.dailyBudget}><input id="l-budget" className="inp" inputMode="decimal" value={f.dailyBudget} onChange={set('dailyBudget')} /></Field>
        {f.goal === 'leads' && (
          <>
            <Field id="l-px" label="Номер пікселя (набору даних)" error={errs.pixelId}><input id="l-px" className="inp font-mono" inputMode="numeric" value={f.pixelId} onChange={set('pixelId')} /></Field>
            <Field id="l-ev" label="Подія, яку шукати"><select id="l-ev" className="inp" value={f.pixelEvent} onChange={set('pixelEvent')}>{pixelEvents.map((e) => <option key={e} value={e}>{EVENT[e] || e}</option>)}</select></Field>
          </>
        )}

        <Field id="l-geo" label="Країни (коди через кому)"><input id="l-geo" className="inp" value={f.countries} onChange={set('countries')} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field id="l-a1" label="Вік від"><input id="l-a1" className="inp" inputMode="numeric" value={f.ageMin} onChange={set('ageMin')} /></Field>
          <Field id="l-a2" label="Вік до"><input id="l-a2" className="inp" inputMode="numeric" value={f.advantageAudience ? '65' : f.ageMax} onChange={set('ageMax')} disabled={f.advantageAudience} /></Field>
        </div>
        <label className="flex items-start gap-2 text-sm self-center"><input type="checkbox" className="mt-1" checked={f.advantageAudience} onChange={set('advantageAudience')} /><span>Дозволити Meta розширювати аудиторію<span className="block text-xs text-slate-500">Тоді вік стає підказкою: від не більше 25 і без верхньої межі.</span></span></label>

        <Field id="l-page" label="Facebook-сторінка, від якої реклама" error={errs.pageId} hint={account?.pagesError ? `Список сторінок не отримано: ${account.pagesError}` : null}>
          {account?.pages?.length ? (
            <select id="l-page" className="inp" value={f.pageId} onChange={set('pageId')}><option value="">оберіть…</option>{account.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          ) : <input id="l-page" className="inp font-mono" inputMode="numeric" value={f.pageId} onChange={set('pageId')} placeholder="Номер сторінки" />}
        </Field>
        <Field id="l-ig" label="Номер Instagram-акаунта (необовʼязково)"><input id="l-ig" className="inp font-mono" inputMode="numeric" value={f.instagramId} onChange={set('instagramId')} /></Field>
      </div>

      <fieldset>
        <legend className="lbl">Креативи (обрано {picked.length}; кожен стане окремим оголошенням)</legend>
        {errs.creatives && <p className="text-red-300 text-xs mb-2">{errs.creatives}</p>}
        {sorted.length === 0 ? <p className="text-sm text-slate-400">Креативів нема. <Link to="/creatives" className="text-brand-light underline">Замовити</Link></p> : (
          <div className="grid gap-2 max-h-[420px] overflow-y-auto pr-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {sorted.map((c) => {
              const ok = usableCreative(c); const on = picked.includes(c.id);
              return (
                <label key={c.id} className={clsx('flex gap-3 p-2 rounded-lg border text-sm', on ? 'border-brand bg-brand/10' : 'border-slate-800', ok ? 'cursor-pointer' : 'opacity-60')}>
                  <input type="checkbox" className="mt-1" checked={on} disabled={!ok} onChange={() => toggle(c.id)} />
                  {c.mediaUrl && (c.mediaType === 'video' ? <video src={`${c.mediaUrl}#t=0.5`} preload="metadata" muted className="w-16 h-20 object-cover rounded" /> : <img src={c.mediaUrl} alt="" loading="lazy" className="w-16 h-20 object-cover rounded" />)}
                  <span className="min-w-0">
                    <span className="block text-xs text-slate-500">№{c.number}{inBundle.has(c.id) ? ' · у цій зв\'язці' : ''}</span>
                    <span className="block line-clamp-2">{part(c.text, 'Заголовок') || 'без заголовка'}</span>
                    {!ok && <span className="block text-xs text-red-300 line-clamp-3">{c.violations?.length ? c.violations.join('; ') : !c.mediaUrl ? 'нема картинки' : 'чернетка в контент-платформі'}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      {error && <div className="text-sm text-red-300">{error}</div>}
      <button className="btn-primary" disabled={busy}>{busy ? 'Зберігаю…' : 'Зберегти чернетку'}</button>
    </form>
  );
}

const usableCreative = (c) => !!c.mediaUrl && !c.violations?.length && c.status !== 'draft';

function Row({ l, dryRun, canApprove, reload }) {
  const [busy, setBusy] = useState('');
  const [verdict, setVerdict] = useState(null);
  const [msg, setMsg] = useState(null); // { text, bad }
  const [ask, setAsk] = useState('');
  const [label, cls] = ST[l.status] || [l.status, 'bg-slate-800'];
  const dest = l.spec.destination.type === 'telegram' ? `@${l.spec.destination.bot} · ${l.spec.destination.slug}` : l.spec.destination.url;

  async function act(kind, fn) {
    setBusy(kind); setMsg(null); setAsk('');
    try {
      const r = await fn();
      if (kind === 'check') setVerdict(r);
      else {
        setVerdict(r.status === 'blocked' ? { ok: false, reasons: r.reasons, notes: [] } : null);
        if (r.message) setMsg({ text: r.message, bad: r.status === 'failed' });
        await reload();
      }
    } catch (e) { setMsg({ text: e.message, bad: true }); } finally { setBusy(''); }
  }

  const CONFIRM = {
    create: [`Створити в кабінеті ${l.spec.creativeIds.length} оголошень? Усе буде вимкненим, гроші не витрачаються.`, 'Так, створити', () => api.launchAct(l.id, 'create')],
    start: [`Увімкнути показ? Почнуться витрати до ${l.spec.dailyBudget} на добу.`, 'Так, увімкнути', () => api.launchAct(l.id, 'start')],
    remove: [l.campaignId ? 'Прибрати зі списку? Недороблена кампанія лишиться в кабінеті вимкненою.' : 'Прибрати чернетку?', 'Так, прибрати', () => api.deleteLaunch(l.id).then(() => ({ status: 'done' }))],
  };

  return (
    <div className="card p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{l.name}</span>
        <span className={clsx('text-xs px-2 py-0.5 rounded-md', cls)}>{label}</span>
        <span className="text-xs text-slate-500 ml-auto">{fmt.dt(l.createdAt)}</span>
      </div>
      <div className="text-xs text-slate-400 break-all">{dest} · {l.spec.dailyBudget} на добу · оголошень: {l.adsCreated || 0} з {l.spec.creativeIds.length}{l.campaignId ? ` · кампанія ${l.campaignId}` : ''}</div>
      {l.error && <div className="text-sm text-red-300">{l.error}</div>}
      {verdict && (
        <div className={clsx('text-sm rounded-lg p-3', verdict.ok ? 'bg-emerald-900/20' : 'bg-red-900/20')}>
          {verdict.ok ? <div className="text-emerald-200">Перевірку пройдено{dryRun ? '. Увімкнено режим «проба»: у кабінеті нічого не створиться.' : '.'}</div> : <ul className="list-disc pl-5 text-red-200">{verdict.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          {verdict.notes?.map((n) => <div key={n} className="text-slate-400 text-xs mt-1">{n}</div>)}
        </div>
      )}
      {l.status === 'creating' && <div className="text-sm text-sky-200">Створюю в кабінеті. Відео Meta обробляє кілька хвилин, сторінка оновиться сама.</div>}
      {msg && <div className={clsx('text-sm', msg.bad ? 'text-red-300' : 'text-slate-300')}>{msg.text}</div>}
      {canApprove && (ask ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{CONFIRM[ask][0]}</span>
          <button className="btn-primary" onClick={() => act(ask, CONFIRM[ask][2])}>{CONFIRM[ask][1]}</button>
          <button className="btn-ghost" onClick={() => setAsk('')}>Скасувати</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {['draft', 'failed'].includes(l.status) && <button className="btn-ghost" disabled={!!busy} onClick={() => act('check', () => api.launchAct(l.id, 'check'))}>{busy === 'check' ? 'Перевіряю…' : 'Перевірити'}</button>}
          {['draft', 'failed'].includes(l.status) && <button className="btn-primary" disabled={!!busy} onClick={() => setAsk('create')}>{l.status === 'failed' ? 'Продовжити' : 'Створити в кабінеті'}</button>}
          {['created', 'stopped'].includes(l.status) && <button className="btn-primary" disabled={!!busy} onClick={() => setAsk('start')}>{busy === 'start' ? 'Вмикаю…' : 'Увімкнути показ'}</button>}
          {l.status === 'live' && <button className="btn-danger" disabled={!!busy} onClick={() => act('stop', () => api.launchAct(l.id, 'stop'))}>{busy === 'stop' ? 'Зупиняю…' : 'Зупинити'}</button>}
          {['draft', 'failed'].includes(l.status) && <button className="btn-ghost ml-auto" disabled={!!busy} onClick={() => setAsk('remove')}>Прибрати</button>}
        </div>
      ))}
    </div>
  );
}

export default function LaunchPage() {
  const canApprove = useAuthStore((s) => s.can('approve'));
  const [data, setData] = useState(null);
  const [refs, setRefs] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(false);
  const timer = useRef(null);

  const load = () => api.launches().then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  // Поки щось створюється — оновлюємо стан самі.
  useEffect(() => {
    clearTimeout(timer.current);
    if (data?.launches.some((l) => l.status === 'creating')) timer.current = setTimeout(load, 4000);
    return () => clearTimeout(timer.current);
  }, [data]);

  async function open() {
    setForm(true);
    if (refs) return;
    try {
      const [a, b] = await Promise.all([api.launchAccounts(), api.bundles()]);
      let creatives = []; let creativesError = '';
      try { creatives = (await api.creatives()).creatives; } catch (e) { creativesError = e.message; }
      setRefs({ accounts: a.accounts, bundles: b.bundles, creatives, creativesError });
    } catch (e) { setError(e.message); setForm(false); }
  }

  if (!data) return <div className="text-slate-500 text-sm">{error || 'Завантаження…'}</div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-medium">Запуск реклами</h1>
        <span className="text-sm text-slate-400">денний ліміт проєкту: {data.dailyLimitUsd} дол.</span>
        {canApprove && !form && <button className="btn-primary ml-auto" onClick={open}>Нова кампанія</button>}
        {form && <button className="btn-ghost ml-auto" onClick={() => setForm(false)}>Закрити форму</button>}
      </div>
      {data.dryRun && <div className="text-sm rounded-lg p-3 bg-amber-900/30 text-amber-200">Режим «проба»: можна заповнити й перевірити кампанію, але в кабінеті нічого не створиться. Вимикається в <Link to="/settings" className="underline">налаштуваннях</Link>.</div>}
      {error && <div className="text-sm text-red-300">{error}</div>}
      {form && (!refs ? <div className="text-slate-500 text-sm">Завантаження…</div> : refs.accounts.length === 0 ? (
        <div className="card p-6 text-center text-sm text-slate-300">Спершу підключіть рекламний кабінет Meta з ключем керування. <Link to="/connections" className="text-brand-light underline">До підключень</Link></div>
      ) : (
        <>
          {refs.creativesError && <div className="text-sm text-red-300">{refs.creativesError}</div>}
          <Form accounts={refs.accounts} bundles={refs.bundles} creatives={refs.creatives} goals={data.goals} pixelEvents={data.pixelEvents} onSaved={() => { setForm(false); load(); }} />
        </>
      ))}
      {data.launches.length === 0 ? (!form && <div className="card p-8 text-center text-slate-400 text-sm">Кампаній, створених із платформи, ще нема. Порядок: заповнити → перевірити → створити в кабінеті (вимкненою) → увімкнути показ.</div>)
        : data.launches.map((l) => <Row key={l.id} l={l} dryRun={data.dryRun} canApprove={canApprove} reload={load} />)}
    </div>
  );
}
