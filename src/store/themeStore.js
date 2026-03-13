import { create } from 'zustand';

function getInitialTheme() {
  const stored = localStorage.getItem('2dni-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const useThemeStore = create((set, get) => ({
  theme: getInitialTheme(),

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('2dni-theme', next);
    set({ theme: next });
  },

  setTheme: (theme) => {
    localStorage.setItem('2dni-theme', theme);
    set({ theme });
  },
}));
