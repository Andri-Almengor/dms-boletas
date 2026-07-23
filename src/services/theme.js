export const APP_THEME_STORAGE_KEY = 'dms-ui-theme';
export const APP_THEMES = ['light', 'dark'];

function normalizeTheme(value) {
  return APP_THEMES.includes(value) ? value : 'light';
}

export function getStoredTheme() {
  if (typeof window === 'undefined') return 'light';
  try {
    return normalizeTheme(window.localStorage.getItem(APP_THEME_STORAGE_KEY));
  } catch {
    return 'light';
  }
}

export function applyTheme(value, { persist = true, notify = true } = {}) {
  const theme = normalizeTheme(value);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#171313' : '#af101a');
  }
  if (persist && typeof window !== 'undefined') {
    try { window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme); } catch { /* La apariencia sigue aplicada en la sesión. */ }
  }
  if (notify && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dms-theme-change', { detail: { theme } }));
  }
  return theme;
}

export function initializeTheme() {
  return applyTheme(getStoredTheme(), { persist: false, notify: false });
}
