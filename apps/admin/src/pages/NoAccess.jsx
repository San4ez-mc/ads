import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { api } from '../api/client';

// Нема жодного проєкту: суперадмін створює перший тут же, решта бачать пояснення.
export default function NoAccess() {
  const { user, role, logout, setProject, fetchMe } = useAuthStore();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Введіть назву проєкту'); return; }
    setBusy(true); setError('');
    try { const p = await api.createProject({ name }); setProject(p.id); await fetchMe(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card p-8 max-w-md w-full">
        {role === 'superadmin' ? (
          <form onSubmit={create} className="space-y-4">
            <h1 className="text-xl font-semibold">Створіть перший проєкт</h1>
            <p className="text-slate-400 text-sm">Проєкт — це один бізнес або продукт зі своїми рекламними кабінетами, лімітами і звітами.</p>
            <div>
              <label className="lbl" htmlFor="pname">Назва проєкту</label>
              <input id="pname" className="inp" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="Консультації з автоматизації" />
              {error && <p className="text-red-300 text-xs mt-1">{error}</p>}
            </div>
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Створюю…' : 'Створити проєкт'}</button>
          </form>
        ) : (
          <div className="text-center">
            <h1 className="text-xl font-semibold mb-2">Немає доступу до жодного проєкту</h1>
            <p className="text-slate-400 text-sm mb-5">Ви увійшли як {user?.email}. Попросіть адміністратора видати доступ до платформи реклами в панелі доступів SSO.</p>
          </div>
        )}
        <button className="btn-ghost w-full mt-4" onClick={logout}>Вийти</button>
      </div>
    </div>
  );
}
