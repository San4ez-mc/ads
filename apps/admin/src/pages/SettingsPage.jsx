import { useEffect, useState } from 'react';
import { api, fmt } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import PaymentSteps from '../components/PaymentSteps';

const LEVELS = [
  [0, 'Лише дивиться', 'Збирає дані й показує цифри. Нічого не радить і не змінює.'],
  [1, 'Радить', 'Показує рекомендації. Дія виконується лише після вашого «Підтвердити».'],
  [2, 'Сам вимикає те, що зливає', 'Вимикає оголошення за правилами без підтвердження. Усе інше — як на рівні 1.'],
  [3, 'Сам міняє бюджети', 'Додатково підіймає й знижує бюджети в межах запобіжників.'],
];

// ключ, назва поля, найменше значення, пояснення
const RULES = [
  ['priceyUpTo', '«Дорого», поки клієнт дорожчий не більше ніж у … раза', 1, 'Дорожче за це — «зливає».'],
  ['noClientTargets', 'Без клієнтів «зливає» після витрат у … цілей', 0.5, 'До цієї суми платформа каже «мало даних».'],
  ['brokenSpend', 'Тривога «щось зламано»: витрачено, грн', 0, '0 — тривогу вимкнено. Рахується за останні 7 днів.'],
  ['brokenPeople', '…а людей на сайті чи в боті менше ніж', 1, 'Скільки людей має прийти за ці гроші.'],
];

export default function SettingsPage() {
  const role = useAuthStore((s) => s.role);
  const [p, setP] = useState(null);
  const [f, setF] = useState(null);
  const [errs, setErrs] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => { api.project().then((d) => { setP(d); setF({ name: d.name, dailyLimitUsd: String(d.dailyLimitUsd), usdRate: String(d.usdRate), targetSaleCost: d.targetSaleCost ?? '', autonomyLevel: d.autonomyLevel, dryRun: d.dryRun, reportChatId: d.reportChatId || '', ...d.rules }); }).catch((e) => setMsg(e.message)); }, []);
  if (!f) return <div className="text-slate-500 text-sm">{msg || 'Завантаження…'}</div>;

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); setErrs({ ...errs, [k]: '' }); setMsg(''); };

  async function save(e) {
    e.preventDefault();
    const er = {};
    if (!f.name.trim()) er.name = 'Введіть назву';
    if (!(Number(f.dailyLimitUsd) >= 0) || f.dailyLimitUsd === '') er.dailyLimitUsd = 'Число від 0';
    if (!(Number(f.usdRate) >= 1)) er.usdRate = 'Число від 1';
    if (f.targetSaleCost !== '' && !(Number(f.targetSaleCost) >= 0)) er.targetSaleCost = 'Число від 0 або порожньо';
    for (const [k, , min] of RULES) if (f[k] === '' || !(Number(f[k]) >= min)) er[k] = `Число від ${String(min).replace('.', ',')}`;
    setErrs(er); if (Object.keys(er).length) return;
    setBusy(true); setMsg('');
    try {
      const d = await api.patchProject({ name: f.name, dailyLimitUsd: Number(f.dailyLimitUsd), usdRate: Number(f.usdRate), targetSaleCost: f.targetSaleCost === '' ? null : Number(f.targetSaleCost), autonomyLevel: Number(f.autonomyLevel), dryRun: f.dryRun, reportChatId: f.reportChatId || null, rules: Object.fromEntries(RULES.map(([k]) => [k, Number(f[k])])) });
      setP(d); setMsg('Збережено');
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }

  const owner = role === 'superadmin';
  const target = Number(f.targetSaleCost) || 0;
  const field = ([k, label, , hint]) => (
    <div key={k}>
      <label className="lbl" htmlFor={`s-${k}`}>{label}</label>
      <input id={`s-${k}`} className="inp" inputMode="decimal" value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value.replace(',', '.') }); setErrs({ ...errs, [k]: '' }); setMsg(''); }} />
      {errs[k] ? <p className="text-red-300 text-xs mt-1">{errs[k]}</p> : <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
  return (
    <div className="space-y-5 max-w-3xl">
    <form onSubmit={save} className="space-y-5">
      <h1 className="text-lg font-medium">Налаштування проєкту</h1>

      <section className="card p-5 grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="lbl" htmlFor="s-name">Назва проєкту</label>
          <input id="s-name" className="inp" value={f.name} onChange={set('name')} />
          {errs.name && <p className="text-red-300 text-xs mt-1">{errs.name}</p>}
        </div>
        <div>
          <label className="lbl" htmlFor="s-rate">Курс долара, грн</label>
          <input id="s-rate" className="inp" inputMode="decimal" value={f.usdRate} onChange={set('usdRate')} />
          {errs.usdRate ? <p className="text-red-300 text-xs mt-1">{errs.usdRate}</p> : <p className="text-xs text-slate-500 mt-1">Для переведення витрат кабінету в гривні.</p>}
        </div>
      </section>

      <section className="card p-5 space-y-4">
        <div>
          <h2 className="font-medium">Як визначати переможця</h2>
          <p className="text-xs text-slate-500 mt-1">Переможець — найнижча ціна клієнта: витрати поділені на людей, які заплатили. Що вважати оплатою, задається нижче.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="lbl" htmlFor="s-target">Скільки найбільше готові платити за клієнта, грн</label>
            <input id="s-target" className="inp" inputMode="decimal" value={f.targetSaleCost} onChange={set('targetSaleCost')} placeholder="1500" />
            {errs.targetSaleCost ? <p className="text-red-300 text-xs mt-1">{errs.targetSaleCost}</p> : <p className="text-xs text-slate-500 mt-1">Клієнт не дорожче цієї суми — реклама «працює». Порожньо — оцінки нема.</p>}
          </div>
          {RULES.map(field)}
        </div>
        {target > 0 && Number(f.priceyUpTo) >= 1 && Number(f.noClientTargets) > 0 && <p className="text-sm rounded-lg bg-slate-950/60 p-3">Виходить: клієнт до <b>{fmt.money(target)}</b> — «працює», до <b>{fmt.money(target * f.priceyUpTo)}</b> — «дорого», дорожче — «зливає». Без жодного клієнта «зливає» після <b>{fmt.money(target * f.noClientTargets)}</b> витрат.</p>}
      </section>

      <section className="card p-5 space-y-4">
        <h2 className="font-medium">Запобіжники</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="lbl" htmlFor="s-limit">Денний ліміт витрат на проєкт, доларів</label>
            <input id="s-limit" className="inp" inputMode="decimal" value={f.dailyLimitUsd} onChange={set('dailyLimitUsd')} />
            {errs.dailyLimitUsd ? <p className="text-red-300 text-xs mt-1">{errs.dailyLimitUsd}</p> : <p className="text-xs text-slate-500 mt-1">Платформа не виконає дію, після якої денні витрати перевищать цю суму. Підняти ліміт може лише власник.</p>}
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={f.dryRun} onChange={set('dryRun')} disabled={!owner && p.dryRun} />
            <span><span className="font-medium">Режим «проба»</span><br /><span className="text-slate-400">Дії лише записуються в журнал як «зробив би». У кабінеті нічого не змінюється.</span></span>
          </label>
        </div>
        <fieldset>
          <legend className="lbl">Що дозволено робити самостійно</legend>
          <div className="space-y-2">
            {LEVELS.map(([lv, head, text]) => (
              <label key={lv} className="flex items-start gap-3 text-sm">
                <input type="radio" name="lvl" className="mt-1" checked={Number(f.autonomyLevel) === lv} onChange={() => { setF({ ...f, autonomyLevel: lv }); setMsg(''); }} disabled={!owner && lv > p.autonomyLevel} />
                <span><span className="font-medium">{head}</span> <span className="text-slate-400">— {text}</span></span>
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">Зараз платформа вміє лише читати дані, тож рівні 1–3 почнуть діяти, коли з'являться рекомендації і дії. Створення нових кампаній завжди потребує підтвердження.</p>
        </fieldset>
      </section>

      <section className="card p-5 space-y-3">
        <h2 className="font-medium">Звіти в Telegram</h2>
        <div className="max-w-sm">
          <label className="lbl" htmlFor="s-chat">Номер чату Telegram для звітів</label>
          <input id="s-chat" className="inp" value={f.reportChatId} onChange={set('reportChatId')} placeholder="345126254" />
        </div>
      </section>

      {p.apiKey && (
        <section className="card p-5 space-y-2">
          <h2 className="font-medium">Ключ проєкту для воронок Flows</h2>
          <p className="text-xs text-slate-500">Ним воронка запускає оновлення даних і забирає цифри для звіту. Змінювати рекламу цим ключем не можна.</p>
          <div className="flex gap-2 items-center">
            <code className="inp font-mono !w-auto flex-1 truncate">{showKey ? p.apiKey : '•'.repeat(24)}</code>
            <button type="button" className="btn-ghost" onClick={() => setShowKey(!showKey)}>{showKey ? 'Сховати' : 'Показати'}</button>
          </div>
        </section>
      )}

      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy}>{busy ? 'Зберігаю…' : 'Зберегти'}</button>
        {msg && <span className="text-sm text-slate-300">{msg}</span>}
      </div>
    </form>
    <PaymentSteps />
    </div>
  );
}
