// Theme — the three palettes from the design. When the active theme changes we
// also write its values to CSS custom properties on :root so DOM overlays,
// canvas reads (getComputedStyle), and sub-components all see a single source
// of truth. Keeping the Theme/THEMES shape unchanged preserves call-sites.

export type ThemeName = "inkwell" | "vellum" | "midnight";

export interface Theme {
  bg: string;
  bgDeep: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textDim: string;
  textMute: string;
  accent: string;
  accent2: string;
  accent3: string;
  axis: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  inkwell: {
    bg:       "oklch(0.16 0.015 260)",
    bgDeep:   "oklch(0.12 0.015 260)",
    surface:  "oklch(0.22 0.018 260)",
    surface2: "oklch(0.28 0.02 260)",
    border:   "oklch(0.35 0.02 260 / 0.5)",
    text:     "oklch(0.94 0.01 90)",
    textDim:  "oklch(0.68 0.015 260)",
    textMute: "oklch(0.50 0.015 260)",
    accent:   "oklch(0.78 0.14 85)",
    accent2:  "oklch(0.70 0.18 300)",
    accent3:  "oklch(0.72 0.13 195)",
    axis:     "oklch(0.45 0.03 260)",
  },
  vellum: {
    bg:       "oklch(0.17 0.02 45)",
    bgDeep:   "oklch(0.12 0.02 45)",
    surface:  "oklch(0.23 0.025 45)",
    surface2: "oklch(0.30 0.03 45)",
    border:   "oklch(0.40 0.03 45 / 0.5)",
    text:     "oklch(0.94 0.02 80)",
    textDim:  "oklch(0.70 0.03 60)",
    textMute: "oklch(0.52 0.03 55)",
    accent:   "oklch(0.80 0.15 70)",
    accent2:  "oklch(0.72 0.16 25)",
    accent3:  "oklch(0.72 0.12 160)",
    axis:     "oklch(0.48 0.04 50)",
  },
  midnight: {
    bg:       "oklch(0.13 0.02 285)",
    bgDeep:   "oklch(0.08 0.015 285)",
    surface:  "oklch(0.20 0.025 285)",
    surface2: "oklch(0.27 0.03 285)",
    border:   "oklch(0.38 0.03 285 / 0.55)",
    text:     "oklch(0.96 0.01 280)",
    textDim:  "oklch(0.70 0.02 285)",
    textMute: "oklch(0.50 0.02 285)",
    accent:   "oklch(0.82 0.15 95)",
    accent2:  "oklch(0.72 0.19 320)",
    accent3:  "oklch(0.75 0.14 210)",
    axis:     "oklch(0.42 0.04 285)",
  },
};

export function getTheme(name: ThemeName): Theme {
  return THEMES[name] ?? THEMES.inkwell;
}

/** Write the active theme's values to CSS custom properties on :root.
 *  Called on app boot and every time the user switches theme. */
export function applyThemeToRoot(name: ThemeName): void {
  const t = getTheme(name);
  const root = document.documentElement;
  root.dataset.theme = name;
  root.style.setProperty("--color-bg", t.bg);
  root.style.setProperty("--color-bg-deep", t.bgDeep);
  root.style.setProperty("--color-surface", t.surface);
  root.style.setProperty("--color-surface-2", t.surface2);
  root.style.setProperty("--color-border", t.border);
  root.style.setProperty("--color-text", t.text);
  root.style.setProperty("--color-text-dim", t.textDim);
  root.style.setProperty("--color-text-mute", t.textMute);
  root.style.setProperty("--color-accent", t.accent);
  root.style.setProperty("--color-accent-2", t.accent2);
  root.style.setProperty("--color-accent-3", t.accent3);
  root.style.setProperty("--color-axis", t.axis);
}
