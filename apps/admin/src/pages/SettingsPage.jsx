import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';

const LEVELS = [
  [0, 'Лише дивиться', 'Збирає дані й показує цифри. Нічого не радить і не змінює.'],
  [1, 'Радить', 'Показує рекомендації. Дія виконується лише після вашого «Підтвердити».'],
  [2, 'Сам вимикає те, що зливає', 'Вимикає оголошення за правилами без підтвердження. Усе інше — як на рівні 1.'],
  [3, 'Сам міняє бюджети', 'Додатково підіймає й знижує бюджети в межах запобіжників.'],
];

export default function SettingsPage() {
  const role = useAuthStore((s) => s.role);
  const [p, setP] = useState(null);
  const [f, setF] = useState(null);
  const [errs, setErrs] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => { api.project().then((d) => { setP(d); setF({ name: d.name, dailyLimitUsd: String(d.dailyLimitUsd), usdRate: String(d.usdRate), targetSaleCost: d.targetSaleCost ?? '', autonomyLevel: d.autonomyLevel, dryRun: d.dryRun, reportChatId: d.reportChatId || '' }); }).catch((e) => setMsg(e.message)); }, []);
  if (!f) return <div className="text-slate-500 text-sm">{msg || 'Завантаження…'}</div>;

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); setErrs({ ...errs, [k]: '' }); setMsg(''); };

  async function save(e) {
    e.preventDefault();
    const er = {};
    if (!f.name.trim()) er.name = 'Введіть назву';
    if (!(Number(f.dailyLimitUsd) >= 0) || f.dailyLimitUsd === '') er.dailyLimitUsd = 'Число від 0';
    if (!(Number(f.usdRate) >= 1)) er.usdRate = 'Число від 1';
    if (f.targetSaleCost !== '' && !(Number(f.targetSaleCost) >= 0)) er.targetSaleCost = 'Число від 0 або порожньо';
    setErrs(er); if (Object.keys(er).length) return;
    setBusy(true); setMsg('');
    try {
      const d = await api.patchProject({ name: f.name, dailyLimitUsd: Number(f.dailyLimitUsd), usdRate: Number(f.usdRate), targetSaleCost: f.targetSaleCost === '' ? null : Number(f.targetSaleCost), autonomyLevel: Number(f.autonomyLevel), dryRun: f.dryRun, reportChatId: f.reportChatId || null });
      setP(d); setMsg('Збережено');
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }

  const owner = role === 'superadmin';
  return (
    <form onSubmit={save} className="space-y-5 max-w-3xl">
      <h1 className="text-lg font-medium">Налаштування проєкту</h1>

      <section className="card p-5 grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="lbl" htmlFor="s-name">Назва проєкту</label>
          <input id="s-name" className="inp" value={f.name} onChange={set('name')} />
          {errs.name && <p className="text-red-300 text-xs mt-1">{errs.name}</p>}
        </div>
        <div>
          <label className="lbl" htmlFor="s-target">Цільова ціна продажу, грн</label>
          <input id="s-target" className="inp" inputMode="decimal" value={f.targetSaleCost} onChange={set('targetSaleCost')} placeholder="1500" />
          {errs.targetSaleCost ? <p className="text-red-300 text-xs mt-1">{errs.targetSaleCost}</p> : <p className="text-xs text-slate-500 mt-1">Скільки готові платити за одного покупця. Від цього рахуються «працює» і «дорого».</p>}
        </div>
        <div>
          <label className="lbl" htmlFor="s-rate">Курс долара, грн</label>
          <input id="s-rate" className="inp" inputMode="decimal" value={f.usdRate} onChange={set('usdRate')} />
          {errs.usdRate ? <p className="text-red-300 text-xs mt-1">{errs.usdRate}</p> : <p className="text-xs text-slate-500 mt-1">Для переведення витрат кабінету в гривні.</p>}
        </div>
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
  );
}
