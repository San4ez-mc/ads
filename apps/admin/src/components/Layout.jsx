import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { useAuthStore } from '../stores/authStore';

const NAV = [
  { to: '/', label: 'Карта', page: 'map', end: true },
  { to: '/bundles', label: "Зв'язки", page: 'bundles' },
  { to: '/ads', label: 'Оголошення', page: 'ads' },
  { to: '/connections', label: 'Підключення', page: 'connections' },
  { to: '/journal', label: 'Журнал', page: 'journal' },
  { to: '/settings', label: 'Налаштування', page: 'settings' },
];

export default function Layout() {
  const { user, projects, currentProjectId, setProject, logout, can, currentProject } = useAuthStore();
  const items = NAV.filter((n) => can(n.page));
  const project = currentProject();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1500px] mx-auto px-4 h-14 flex items-center gap-4">
          <div className="font-semibold whitespace-nowrap">FINEKO Ads</div>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {items.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors', isActive ? 'bg-brand/15 text-brand-light' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {project?.dryRun && <span className="text-xs px-2 py-1 rounded-md bg-amber-900/40 text-amber-200 whitespace-nowrap" title="Дії лише записуються в журнал, у кабінеті нічого не змінюється">Режим «проба»</span>}
            <select aria-label="Проєкт" className="inp !w-auto max-w-[220px]" value={currentProjectId || ''} onChange={(e) => { setProject(e.target.value); window.location.reload(); }}>
              {projects.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <span className="text-xs text-slate-500 hidden lg:inline">{user?.email}</span>
            <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={logout}>Вийти</button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-[1500px] w-full mx-auto px-4 py-5"><Outlet /></main>
    </div>
  );
}
