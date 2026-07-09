/**
 * PHOSPHOR theme engine — swaps the terminal's phosphor color.
 * Themes are CSS-variable overrides on <html data-theme="...">;
 * canvas components read resolved values via getVar()/palette().
 */

import { blip } from './sfx';

export const THEMES = ['amber', 'green', 'cyan', 'violet'] as const;
export type ThemeName = (typeof THEMES)[number];

export const THEME_LABELS: Record<ThemeName, string> = {
  amber: 'AMBER — P3',
  green: 'GREEN — P1',
  cyan: 'CYAN — P4',
  violet: 'VIOLET — X',
};

const KEY = 'front_theme';
const EVT = 'front-theme-change';

export function getTheme(): ThemeName {
  try {
    const t = localStorage.getItem(KEY) as ThemeName | null;
    if (t && (THEMES as readonly string[]).includes(t)) return t;
  } catch { /* ignore */ }
  return 'amber';
}

let degaussTimer: ReturnType<typeof setTimeout> | undefined;

/** CRT degauss — the screen wobbles and blooms like a real tube. */
function degauss(): void {
  const el = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  el.classList.remove('degauss');
  // restart the animation even on rapid re-triggers
  void el.offsetWidth;
  el.classList.add('degauss');
  clearTimeout(degaussTimer);
  degaussTimer = setTimeout(() => el.classList.remove('degauss'), 520);
}

export function applyTheme(t: ThemeName): void {
  const prev = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  if (prev && prev !== t) { degauss(); blip('degauss'); }
  window.dispatchEvent(new CustomEvent(EVT, { detail: t }));
}

export function cycleTheme(): ThemeName {
  const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
  applyTheme(next);
  return next;
}

/** Call once at boot, before React renders. */
export function initTheme(): void {
  document.documentElement.dataset.theme = getTheme();
}

export function onThemeChange(cb: (t: ThemeName) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent).detail as ThemeName);
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}

/** Resolved CSS var value, e.g. getVar('--primary') → '#ffb300' */
export function getVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Resolved chart palette for canvas-based components. */
export function chartPalette() {
  return {
    bg: getVar('--bg-0'),
    panel: getVar('--bg-1'),
    grid: getVar('--chart-grid'),
    text: getVar('--text-2'),
    primary: getVar('--primary'),
    primaryRgb: getVar('--primary-rgb'),
    green: getVar('--green'),
    red: getVar('--red'),
    yellow: getVar('--yellow'),
  };
}
