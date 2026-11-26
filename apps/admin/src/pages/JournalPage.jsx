import { useEffect, useState } from 'react';
import { api, fmt } from '../api/client';

const KIND = { project_created: 'Створено проєкт', project_settings: 'Змінено налаштування', project_key_rotated: 'Замінено ключ проєкту', connection_added: 'Додано підключення', connection_changed: 'Змінено підключення', connection_removed: 'Видалено підключення', sync_run: 'Оновлення даних', launch_draft: 'Чернетка кампанії', launch_create: 'Створення кампанії', launch_start: 'Увімкнення показу', launch_stop: 'Зупинка кампанії', launch_deleted: 'Прибрано зі списку' };
const STATE = { dry_run: 'проба', blocked: 'заблоковано', failed: 'не вдалося' };
const who = (a) => (a.startsWith('user') ? 'Людина' : a === 'flows' ? 'Воронка Flows' : a === 'ai' ? 'ШІ' : a.startsWith('rule') ? 'Правило' : a);

const FIELD = { name: 'назва', dailyLimitUsd: 'денний ліміт, дол.', usdRate: 'курс долара', autonomyLevel: 'рівень самостійності', dryRun: 'режим «проба»', targetSaleCost: 'цільова ціна продажу', reportChatId: 'чат для звітів', timezone: 'часовий пояс', content2ProjectId: 'проєкт контент-платформи' };
const show = (v) => (v === true ? 'так' : v === false ? 'ні' : v ?? '—');

function detail(a) {
  if (a.kind === 'sync_run') return (a.after?.results || []).map((r) => `${r.kind}: ${r.ok ? 'добре' : r.error}`).join(' · ') || '—';
  if (a.kind === 'project_settings' && a.before && a.after) {
    const ch = Object.keys(a.after).filter((k) => JSON.stringify(a.after[k]) !== JSON.stringify(a.before[k]));
    return ch.length ? ch.map((k) => `${FIELD[k] || k}: ${show(a.before[k])} → ${show(a.after[k])}`).join(' · ') : 'без змін';
  }
  return [a.target || a.after?.name, a.status !== 'done' && a.reason].filter(Boolean).join(' · ') || '—';
}

export default function JournalPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.journal().then((d) => setRows(d.actions)).catch((e) => setError(e.message)); }, []);
  if (!rows) return <div className="text-slate-500 text-sm">{error || 'Завантаження…'}</div>;
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium">Журнал дій</h1>
      {rows.length === 0 ? <div className="card p-8 text-center text-slate-400 text-sm">Тут з'являтиметься кожна дія: хто, що і коли зробив.</div> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400 text-left"><tr><th className="px-4 py-2 font-normal">Коли</th><th className="px-3 py-2 font-normal">Хто</th><th className="px-3 py-2 font-normal">Що</th><th className="px-4 py-2 font-normal">Подробиці</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t border-slate-800 align-top">
                  <td className="px-4 py-2 whitespace-nowrap text-slate-400">{fmt.dt(a.createdAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{who(a.actor)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{KIND[a.kind] || a.kind}{a.status !== 'done' ? ` (${STATE[a.status] || a.status})` : ''}</td>
                  <td className="px-4 py-2 text-slate-400 break-words">{detail(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
