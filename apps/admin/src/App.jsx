import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Layout from './components/Layout';
import Login from './pages/Login';
import NoAccess from './pages/NoAccess';
import MapPage from './pages/MapPage';
import AdsPage from './pages/AdsPage';
import BundlesPage from './pages/BundlesPage';
import AdvicePage from './pages/AdvicePage';
import CreativesPage from './pages/CreativesPage';
import ClientsPage from './pages/ClientsPage';
import ConnectionsPage from './pages/ConnectionsPage';
import JournalPage from './pages/JournalPage';
import SettingsPage from './pages/SettingsPage';

function ProtectedShell({ children }) {
  const { isLoading, isAuthenticated, projects } = useAuthStore();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">Завантаження…</div>;
  if (!isAuthenticated) return <Login />;
  if (projects.length === 0) return <NoAccess />;
  return children;
}

export default function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe);
  useEffect(() => { fetchMe(); }, [fetchMe]);
  return (
    <BrowserRouter>
      <ProtectedShell>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<MapPage />} />
            <Route path="/advice" element={<AdvicePage />} />
            <Route path="/creatives" element={<CreativesPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/bundles" element={<BundlesPage />} />
            <Route path="/ads" element={<AdsPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ProtectedShell>
    </BrowserRouter>
  );
}
