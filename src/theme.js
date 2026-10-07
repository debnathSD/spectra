import { useCallback, useEffect, useState } from 'react';

const STYLE_KEY = 'perf-profiler:theme';
const MODE_KEY = 'perf-profiler:mode';

export const STYLES = [
  {
    id: 'glass',
    label: 'Liquid Glass',
    description: 'Frosted, translucent surfaces',
  },
  {
    id: 'space',
    label: 'Space',
    description: 'Deep-space mission control',
  },
];

export const MODES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Auto' },
];

const DEFAULTS = { style: 'glass', mode: 'system' };

const readKey = (key, allowed, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return allowed.some(option => option.id === value) ? value : fallback;
  } catch {
    return fallback;
  }
};

export const readAppearance = () => ({
  style: readKey(STYLE_KEY, STYLES, DEFAULTS.style),
  mode: readKey(MODE_KEY, MODES, DEFAULTS.mode),
});

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Writes the theme to <html> so every CSS variable block can key off it. */
export function applyAppearance({ style, mode }) {
  const resolved =
    mode === 'system' ? (darkQuery().matches ? 'dark' : 'light') : mode;
  const root = document.documentElement;
  root.dataset.theme = style;
  root.dataset.mode = resolved;
}

export function useAppearance() {
  const [appearance, setAppearance] = useState(readAppearance);

  useEffect(() => {
    applyAppearance(appearance);
    try {
      localStorage.setItem(STYLE_KEY, appearance.style);
      localStorage.setItem(MODE_KEY, appearance.mode);
    } catch {
      // Storage can be blocked; the choice then lasts for this session only.
    }
    if (appearance.mode !== 'system') return undefined;
    const query = darkQuery();
    const onChange = () => applyAppearance(appearance);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [appearance]);

  const update = useCallback(
    patch => setAppearance(prev => ({ ...prev, ...patch })),
    [],
  );
  return [appearance, update];
}
