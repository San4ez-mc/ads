import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api, fmt } from '../api/client';

const ST = { ok: ['Працює', 'bg-emerald-900/40 text-emerald-200'], new: ['Не перевірено', 'bg-slate-800 text-slate-300'], error: ['Помилка', 'bg-red-900/50 text-red-200'], blocked: ['Кабінет обмежено', 'bg-red-900/50 text-red-200'] };

// Покрокова інструкція: куди зайти і що натиснути. Назви пунктів — як у кабінеті Meta українською, в дужках англійською.
const GUIDES = {
  meta: {
    title: 'Рекламний кабінет Meta (Facebook / Instagram)',
    intro: 'Потрібен ключ «системного користувача» вашого бізнес-кабінету. Це окремий технічний користувач: він не прив\'язаний до вашого особистого входу і має права лише на рекламу.',
    steps: [
      ['Відкрийте налаштування бізнес-кабінету', 'Зайдіть на business.facebook.com → шестерня «Налаштування» (Settings) зліва внизу.'],
      ['Перевірте, що є додаток', 'Розділ «Облікові записи» (Accounts) → «Додатки» (Apps). Якщо порожньо: на developers.facebook.com натисніть «Створити додаток» (Create app), тип «Бізнес» (Business), і прив\'яжіть його до цього бізнес-кабінету. Додаток публікувати не треба.'],
      ['Створіть системного користувача', '«Користувачі» (Users) → «Системні користувачі» (System users) → «Додати» (Add). Назва: FINEKO Ads читання. Роль: «Співробітник» (Employee).'],
      ['Дайте йому доступ до кабінету', 'Виділіть створеного користувача → «Призначити об\'єкти» (Assign assets) → «Рекламні облікові записи» (Ad accounts) → позначте потрібний кабінет → увімкніть лише «Перегляд результатів» (View performance) → «Зберегти».'],
      ['Згенеруйте ключ', 'Кнопка «Згенерувати маркер» (Generate token) → оберіть додаток → термін дії «Ніколи» (Never) → позначте один дозвіл: ads_read → «Згенерувати». Скопіюйте ключ одразу: вдруге його не покажуть.'],
      ['Знайдіть номер кабінету', 'Відкрийте Ads Manager. Номер — це цифри після «act=» в адресному рядку, або під назвою кабінету у випадаючому списку зверху.'],
    ],
    idLabel: 'Номер рекламного кабінету', idPlaceholder: '1234567890123456', keyLabel: 'Ключ на читання (ads_read)',
    note: 'Цей ключ уміє лише читати. Щоб платформа створювала кампанії, вмикала й вимикала їх, додайте нижче ще й ключ керування.',
  },
  flows: {
    title: 'Flows (етапи ботів-воронок)',
    intro: 'Платформа забирає з Flows етапи воронок: скільки людей дійшло до кожного і з якого оголошення вони прийшли.',
    steps: [
      ['Задайте ключ у Flows', 'На сервері Flows у файлі .env має бути рядок ADS_FEED_KEY з довгим випадковим значенням. Це робиться один раз при викладанні.'],
      ['Вкажіть воронки', 'Короткі назви воронок (slug) через кому — ті, що в адресі запуску бота, наприклад bot-karta-sales.'],
      ['Вставте адресу і ключ нижче', 'Адреса: https://flows.fineko.space/api/ads-feed'],
    ],
    idLabel: 'Адреса видачі етапів', idPlaceholder: 'https://flows.fineko.space/api/ads-feed', keyLabel: 'Ключ (ADS_FEED_KEY)',
    note: 'Імена й контакти людей із Flows не забираються — лише етапи і код джерела.',
  },
  content2: {
    title: 'Контент-платформа (креативи й аудиторії)',
    intro: 'Тут зберігаються й створюються всі креативи, звідси беруться аудиторії (персони). Платформа реклами їх показує, замовляє нові і записує результати тестів.',
    steps: [
      ['Задайте ключ у контент-платформі', 'На сервері content2 у файлі .env має бути рядок ADS_SYNC_KEY з довгим випадковим значенням. Це робиться один раз при викладанні.'],
      ['Знайдіть номер проєкту', 'У content2 відкрийте потрібний проєкт: номер проєкту видно в адресі або в розділі налаштувань проєкту.'],
      ['Вставте адресу, ключ і номер проєкту нижче', 'Адреса: https://content2.fineko.space/api/webhooks/ads-sync'],
    ],
    idLabel: 'Адреса входу контент-платформи', idPlaceholder: 'https://content2.fineko.space/api/webhooks/ads-sync', keyLabel: 'Ключ (ADS_SYNC_KEY)',
    note: 'Ключ дає лише ці дії: персони, креативи реклами, замовлення, запис підсумків. Нічого не видаляє.',
  },
  calendar: {
    title: 'Календар (записи на консультацію)',
    intro: 'Платформа бачить, скільки людей записалось на консультацію, і з якого оголошення. Імена й телефони з календаря не забираються.',
    steps: [
      ['Знайдіть ключ календаря', 'Відкрийте calendar.fineko.space → «Налаштування» → ключ API вашої компанії.'],
      ['Додайте джерело у посилання на запис', 'На публічну сторінку запису додавайте параметр джерела з кодом заходу: …/book/matsuk?s=c<код заходу>. Тоді запис звʼяжеться з оголошенням.'],
      ['Вставте адресу і ключ нижче', 'Адреса: https://calendar.fineko.space/api'],
    ],
    idLabel: 'Адреса АПІ календаря', idPlaceholder: 'https://calendar.fineko.space/api', keyLabel: 'Ключ API календаря',
    note: 'Записи без коду заходу (наприклад, зроблені в боті) рахуються як записи, але без оголошення.',
  },
  site: {
    title: 'Сайти (кроки людей на лендінгах)',
    intro: 'Платформа забирає з ваших сайтів події: зайшов, натиснув, заповнив форму, оплатив — разом із номером оголошення.',
    steps: [
      ['Доробіть АПІ на хостингу', 'Методи описані у файлі «АПІ-сайтів-для-платформи-реклами.md». Мінімум: /ping, /sites, /events.'],
      ['Скопіюйте токен', 'Адмінка сайтів (leads.fineko.space/admin) → «API реклами» → «Показати ключ».'],
      ['Вставте адресу і токен нижче', 'Адреса: https://leads.fineko.space/api/ads/v1'],
    ],
    idLabel: 'Адреса АПІ', idPlaceholder: 'https://leads.fineko.space/api/ads/v1', keyLabel: 'Токен API сайтів',
    note: 'Імена, телефони й пошта з сайтів не забираються — лише кроки і номер заявки.',
  },
};

function CheckResult({ channel, r }) {
  if (!r) return null;
  if (!r.ok) return <div className="rounded-lg border border-red-800 bg-red-900/20 p-3 text-sm text-red-200">Не вдалося: {r.message}<div className="text-xs text-red-300/80 mt-1">Перевірте, що ключ скопійовано повністю і що користувачу призначено саме цей кабінет.</div></div>;
  const i = r.info;
  if (channel === 'calendar') return <div className="rounded-lg border border-emerald-800 bg-emerald-900/20 p-3 text-sm text-emerald-100">Працює. Календар «{i.name}», записів у період: {i.bookingsFound}.</div>;
  if (channel === 'content2') return <div className="rounded-lg border border-emerald-800 bg-emerald-900/20 p-3 text-sm text-emerald-100">Працює. Проєкт «{i.project}»: персон {i.personas}, рекламних креативів {i.creatives}.</div>;
  if (channel === 'flows') return <div className={clsx('rounded-lg border p-3 text-sm', i.missing.length ? 'border-amber-700 bg-amber-900/20 text-amber-100' : 'border-emerald-800 bg-emerald-900/20 text-emerald-100')}>Працює. Знайдено воронок: {i.funnels.length}{i.funnels.length ? ` (${i.funnels.map((x) => `${x.name}: ${x.stages} етапів`).join('; ')})` : ''}.{i.missing.length ? ` Не знайдено: ${i.missing.join(', ')} — перевірте назву.` : ''}</div>;
  if (channel === 'site') return <div className="rounded-lg border border-emerald-800 bg-emerald-900/20 p-3 text-sm text-emerald-100">Працює. Сайтів знайдено: {i.sites.length}{i.sites.length ? ` (${i.sites.map((s) => s.name || s.domain).join(', ')})` : ''}.</div>;
  return (
    <div className={clsx('rounded-lg border p-3 text-sm', i.healthy ? 'border-emerald-800 bg-emerald-900/20 text-emerald-100' : 'border-amber-700 bg-amber-900/20 text-amber-100')}>
      <div>Кабінет «{i.accountName}» · валюта {i.currency} · час {i.timezone} · стан: {i.accountStatusText}.</div>
      {!i.healthy && <div className="mt-1">Кабінет зараз не активний — автоматика по ньому працювати не буде, доки стан не зміниться.</div>}
      {i.canManage && <div className="mt-1 text-amber-200">Увага: цей ключ має право керувати рекламою (ads_management). Для читання досить ads_read — безпечніше перевипустити ключ лише з цим дозволом.</div>}
      {i.expiresAt && <div className="mt-1 text-amber-200">Ключ діє до {fmt.dt(i.expiresAt)}. Краще згенерувати безстроковий, інакше синхронізація зупиниться.</div>}
    </div>
  );
}

function Wizard({ channel, onDone, onCancel }) {
  const g = GUIDES[channel];
  const [f, setF] = useState({ name: '', externalId: '', readKey: '', slugs: '', c2project: '', writeKey: '' });
  const [errs, setErrs] = useState({});
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrs({ ...errs, [k]: '' }); setTest(null); };

  function validate() {
    const e = {};
    if (!f.externalId.trim()) e.externalId = channel === 'meta' ? 'Вставте номер кабінету' : 'Вставте адресу';
    if (!f.readKey.trim()) e.readKey = 'Вставте ключ';
    if (channel === 'flows' && !f.slugs.trim()) e.slugs = 'Вкажіть хоча б одну воронку';
    if (channel === 'content2' && !f.c2project.trim()) e.c2project = 'Вкажіть номер проєкту';
    setErrs(e); return !Object.keys(e).length;
  }
  async function runTest() {
    if (!validate()) return;
    setBusy('test'); setError('');
    try { setTest(await api.testConnection({ channel, externalId: f.externalId, readKey: f.readKey, slugs: f.slugs, c2project: f.c2project })); } catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  async function save() {
    if (!validate()) return;
    setBusy('save'); setError('');
    try { await api.createConnection({ channel, ...f }); onDone(); } catch (err) { setError(err.message); setBusy(''); }
  }

  return (
    <div className="card p-5 space-y-5">
      <div>
        <h2 className="text-lg font-medium">{g.title}</h2>
        <p className="text-sm text-slate-400 mt-1">{g.intro}</p>
      </div>
      <ol className="space-y-3">
        {g.steps.map(([head, text], i) => (
          <li key={head} className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-brand/20 text-brand-light text-xs flex items-center justify-center mt-0.5">{i + 1}</span>
            <div><div className="text-sm font-medium">{head}</div><div className="text-sm text-slate-400">{text}</div></div>
          </li>
        ))}
      </ol>
      <div className="grid gap-4 md:grid-cols-2 border-t border-slate-800 pt-5">
        <div>
          <label className="lbl" htmlFor="c-ext">{g.idLabel}</label>
          <input id="c-ext" className="inp" value={f.externalId} onChange={set('externalId')} placeholder={g.idPlaceholder} autoComplete="off" />
          {errs.externalId && <p className="text-red-300 text-xs mt-1">{errs.externalId}</p>}
        </div>
        <div>
          <label className="lbl" htmlFor="c-name">Назва для себе (необов'язково)</label>
          <input id="c-name" className="inp" value={f.name} onChange={set('name')} placeholder={channel === 'meta' ? 'Основний кабінет' : channel === 'flows' ? 'Боти' : channel === 'content2' ? 'Контент-платформа' : channel === 'calendar' ? 'Календар' : 'Лендінги'} />
        </div>
        {channel === 'content2' && (
          <div className="md:col-span-2">
            <label className="lbl" htmlFor="c-c2">Номер проєкту в контент-платформі</label>
            <input id="c-c2" className="inp font-mono" value={f.c2project} onChange={set('c2project')} placeholder="cmq8cyn660001knxri1ly2f3g" />
            {errs.c2project && <p className="text-red-300 text-xs mt-1">{errs.c2project}</p>}
          </div>
        )}
        {channel === 'flows' && (
          <div className="md:col-span-2">
            <label className="lbl" htmlFor="c-slugs">Воронки (через кому)</label>
            <input id="c-slugs" className="inp" value={f.slugs} onChange={set('slugs')} placeholder="bot-karta-sales, sell-ai-seller" />
            {errs.slugs && <p className="text-red-300 text-xs mt-1">{errs.slugs}</p>}
          </div>
        )}
        {channel === 'meta' && (
          <div className="md:col-span-2">
            <label className="lbl" htmlFor="c-wkey">Ключ керування (необов'язково, для кнопок «Вимкнути» й «Підняти бюджет»)</label>
            <input id="c-wkey" type="password" className="inp font-mono" value={f.writeKey} onChange={set('writeKey')} placeholder="Залиште порожнім, поки платформа лише читає" autoComplete="new-password" />
            <p className="text-xs text-slate-500 mt-1">Другий ключ того самого системного користувача з дозволами ads_management, pages_show_list і pages_read_engagement. Системному користувачу дайте кабінет (керування кампаніями) і вашу Facebook-сторінку (створення реклами). Щоб платформа створювала оголошення, додаток на developers.facebook.com може знадобитись перевести в робочий режим (Live). Усі дії йдуть через запобіжники і ваше підтвердження.</p>
          </div>
        )}
        {channel === 'site' && (
          <div className="md:col-span-2">
            <label className="lbl" htmlFor="c-wsite">Окремий токен для правок (необов'язково)</label>
            <input id="c-wsite" type="password" className="inp font-mono" value={f.writeKey} onChange={set('writeKey')} placeholder="Ключ із дозволом писати" autoComplete="new-password" />
            <p className="text-xs text-slate-500 mt-1">Адмінка сайтів → «API реклами» → біля ключа «Дозволити писати». Якщо поле порожнє, для правок береться ключ на читання.</p>
          </div>
        )}
        <div className="md:col-span-2">
          <label className="lbl" htmlFor="c-key">{g.keyLabel}</label>
          <input id="c-key" type="password" className="inp font-mono" value={f.readKey} onChange={set('readKey')} placeholder="Вставте ключ" autoComplete="new-password" />
          {errs.readKey && <p className="text-red-300 text-xs mt-1">{errs.readKey}</p>}
          <p className="text-xs text-slate-500 mt-1">Ключ зберігається зашифрованим на сервері. Після збереження його не можна побачити — лише замінити.</p>
        </div>
      </div>
      <CheckResult channel={channel} r={test} />
      {error && <div className="text-sm text-red-300">{error}</div>}
      <p className="text-xs text-slate-500">{g.note}</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={runTest} disabled={!!busy}>{busy === 'test' ? 'Перевіряю…' : 'Перевірити'}</button>
        <button className="btn-primary" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Зберігаю…' : 'Зберегти підключення'}</button>
        <button className="btn-ghost ml-auto" onClick={onCancel} disabled={!!busy}>Скасувати</button>
      </div>
    </div>
  );
}

// Заміна ключів уже підключених сайтів: поля порожні, збережене назад не показується.
function SiteKeys({ c, onSaved }) {
  const [f, setF] = useState({ readKey: '', writeKey: '' });
  const [msg, setMsg] = useState('');
  async function save(e) {
    e.preventDefault();
    const data = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    if (!Object.keys(data).length) { setMsg('Вставте токен'); return; }
    try { await api.patchConnection(c.id, data); setF({ readKey: '', writeKey: '' }); setMsg('Збережено. Стан підключення перевірено — дивіться позначку вище.'); await onSaved(); } catch (err) { setMsg(err.message); }
  }
  return (
    <form onSubmit={save} className="mt-3 border-t border-slate-800 pt-3 space-y-2">
      <p className="text-xs text-slate-500">Токен беруть в адмінці сайтів: «API реклами» → «Показати ключ». Щоб платформа надсилала правки, увімкніть там біля нього «Дозволити писати». Зараз збережений токен: {c.readKey || 'нема'}.</p>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end">
        <div>
          <label className="lbl" htmlFor={`t-${c.id}`}>Токен API сайтів</label>
          <input id={`t-${c.id}`} type="password" className="inp font-mono" placeholder="Вставте токен" value={f.readKey} onChange={(e) => setF({ ...f, readKey: e.target.value })} autoComplete="new-password" />
        </div>
        <div>
          <label className="lbl" htmlFor={`w-${c.id}`}>Окремий токен для правок (необов'язково)</label>
          <input id={`w-${c.id}`} type="password" className="inp font-mono" placeholder="Порожньо — той самий" value={f.writeKey} onChange={(e) => setF({ ...f, writeKey: e.target.value })} autoComplete="new-password" />
        </div>
        <button className="btn-primary">Зберегти токен</button>
      </div>
      {msg && <p className="text-xs text-slate-300">{msg}</p>}
    </form>
  );
}

export default function ConnectionsPage() {
  const [list, setList] = useState(null);
  const [wizard, setWizard] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [confirmId, setConfirmId] = useState('');

  const load = () => api.connections().then((d) => setList(d.connections)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function check(id) { setBusyId(id); try { await api.checkConnection(id); await load(); } catch (e) { setError(e.message); } finally { setBusyId(''); } }
  async function pause(c) { setBusyId(c.id); setError(''); try { await api.patchConnection(c.id, { paused: !c.config?.paused }); await load(); } catch (e) { setError(e.message); } finally { setBusyId(''); } }
  async function remove(id) { setBusyId(id); try { await api.deleteConnection(id); setConfirmId(''); await load(); } catch (e) { setError(e.message); } finally { setBusyId(''); } }

  if (wizard) return <Wizard channel={wizard} onCancel={() => setWizard(null)} onDone={() => { setWizard(null); load(); }} />;
  if (!list) return <div className="text-slate-500 text-sm">{error || 'Завантаження…'}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-medium">Підключення</h1>
        <div className="ml-auto flex gap-2">
          <button className="btn-primary" onClick={() => setWizard('meta')}>Додати кабінет Meta</button>
          <button className="btn-ghost" onClick={() => setWizard('site')}>Додати сайти</button>
          <button className="btn-ghost" onClick={() => setWizard('flows')}>Додати боти Flows</button>
          <button className="btn-ghost" onClick={() => setWizard('content2')}>Додати контент-платформу</button>
          <button className="btn-ghost" onClick={() => setWizard('calendar')}>Додати календар</button>
        </div>
      </div>
      {error && <div className="text-sm text-red-300">{error}</div>}
      {list.length === 0 && <div className="card p-8 text-center text-slate-400 text-sm">Ще нічого не підключено. Почніть з рекламного кабінету — інструкція відкриється після натискання кнопки.</div>}
      {list.map((c) => {
        const [label, cls] = ST[c.status] || ST.new;
        const info = c.config?.check;
        return (
          <div key={c.id} className="card p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0">
                <div className="font-medium">{c.name} <span className={clsx('ml-2 text-xs px-2 py-1 rounded-md', cls)}>{label}</span></div>
                <div className="text-xs text-slate-400 mt-1">{c.channelLabel} · {c.externalId}</div>
                <div className="text-xs text-slate-500 mt-1">
                  Ключ на читання: {c.readKey || 'нема'} · ключ керування: {c.writeKey || 'не додано'} · перевірено {fmt.dt(c.lastCheckAt)} · дані оновлено {fmt.dt(c.lastSyncAt)}
                </div>
                {info?.accountName && <div className="text-xs text-slate-400 mt-1">Кабінет «{info.accountName}», {info.currency}, {info.timezone}, стан: {info.accountStatusText}</div>}
                {c.config?.paused && <div className="text-xs text-amber-200 mt-1">Звернення до Meta призупинені: платформа нічого не читає й не міняє (крім вашого «Вимкнути»). Реклама в кабінеті від цього не зупиняється.</div>}
                {c.lastError && <div className="text-xs text-red-300 mt-1">{c.lastError}</div>}
              </div>
              <div className="ml-auto flex gap-2">
                {c.channel === 'meta' && <button className={c.config?.paused ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'} onClick={() => pause(c)} disabled={busyId === c.id}>{c.config?.paused ? 'Відновити звернення' : 'Призупинити звернення'}</button>}
                <button className="btn-ghost !py-1.5" hidden={!!c.config?.paused} onClick={() => check(c.id)} disabled={busyId === c.id}>{busyId === c.id ? 'Перевіряю…' : 'Перевірити'}</button>
                {confirmId === c.id
                  ? <><button className="btn-danger !py-1.5" onClick={() => remove(c.id)} disabled={busyId === c.id}>Так, видалити</button><button className="btn-ghost !py-1.5" onClick={() => setConfirmId('')}>Ні</button></>
                  : <button className="btn-ghost !py-1.5" onClick={() => setConfirmId(c.id)}>Видалити</button>}
              </div>
            </div>
            {c.channel === 'site' && <SiteKeys c={c} onSaved={load} />}
            {confirmId === c.id && <p className="text-xs text-amber-200 mt-2">Разом із підключенням зникнуть завантажені з нього кампанії, оголошення і статистика. У самому кабінеті нічого не зміниться.</p>}
          </div>
        );
      })}
    </div>
  );
}
