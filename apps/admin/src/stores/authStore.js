// Стан автентифікації + вибраний проєкт. SSO-сесія живе в httpOnly cookie на боці API (ads_session).
import { create } from 'zustand';

const KEY = 'ads_project_id';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* приватний режим */ } };

export const useAuthStore = create((set, get) => ({
  isLoading: true,
  isAuthenticated: false,
  user: null,
  role: 'none',
  pageIds: [],
  canEdit: true,
  projects: [],
  currentProjectId: read(),

  setProject(id) { write(id); set({ currentProjectId: id }); },

  async fetchMe() {
    set({ isLoading: true });
    try {
      const res = await fetch('/me', { credentials: 'include' });
      if (!res.ok) throw new Error('unauthenticated');
      const json = await res.json();
      const projects = json.data.projects || [];
      const saved = get().currentProjectId;
      const currentProjectId = projects.some((t) => t.id === saved) ? saved : (projects[0]?.id || null);
      if (currentProjectId) write(currentProjectId);
      set({ isAuthenticated: true, user: json.data.user, role: json.data.role, pageIds: json.data.pageIds || [], canEdit: json.data.canEdit !== false, projects, currentProjectId, isLoading: false });
    } catch {
      set({ isAuthenticated: false, user: null, projects: [], isLoading: false });
    }
  },

  async logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    set({ isAuthenticated: false, user: null, projects: [] });
  },

  /** Чи показувати розділ: порожній pageIds = усі; superadmin = усі. */
  can(pageId) {
    const { role, pageIds } = get();
    return role === 'superadmin' || !pageIds.length || pageIds.includes(pageId);
  },
  currentProject() { const { projects, currentProjectId } = get(); return projects.find((t) => t.id === currentProjectId) || null; },
}));
