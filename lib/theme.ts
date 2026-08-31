// A single source of truth for colour: the same token set drives the CSS
// variables AND the Plotly figure styling, so charts can never drift out of
// sync with the surrounding page the way hardcoded hex values would.

export type ThemeName = "Light" | "Dark" | "Sepia";

export interface ThemeTokens {
  bg: string;
  bgGrad: string;
  surface: string;
  surfaceAlt: string;
  surfaceSunk: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  accent: string;
  accentSoft: string;
  success: string;
  danger: string;
  warning: string;
  info: string;
  posBg: string;
  posText: string;
  negBg: string;
  negText: string;
  warnBg: string;
  warnText: string;
  neuBg: string;
  neuText: string;
  grid: string;
  shadow: string;
  ring: string;
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  Light: {
    bg: "#f4f5f9",
    bgGrad: "radial-gradient(circle at 12% -10%, #ffffff 0%, #f4f5f9 60%)",
    surface: "#ffffff", surfaceAlt: "#f8f9fc", surfaceSunk: "#eef0f6",
    text: "#14172a", muted: "#515c73", faint: "#6f7a90",
    border: "#e4e7f0", accent: "#3d3ab0", accentSoft: "#6366f1",
    success: "#0f8f5c", danger: "#cf2c1e", warning: "#b8760a", info: "#2563eb",
    posBg: "#ecfdf3", posText: "#0a5f3d",
    negBg: "#fef3f2", negText: "#8f2318",
    warnBg: "#fffaeb", warnText: "#8a5a05",
    neuBg: "#f0f2fc", neuText: "#2f2a86",
    grid: "rgba(20,23,42,0.08)", shadow: "rgba(16,24,40,0.08)", ring: "rgba(61,58,176,0.20)",
  },
  Dark: {
    bg: "#080b13",
    bgGrad: "radial-gradient(circle at 12% -10%, #151c30 0%, #080b13 60%)",
    surface: "#111726", surfaceAlt: "#161d2e", surfaceSunk: "#0d121e",
    text: "#eef1f8", muted: "#a3b0c6", faint: "#8590a6",
    border: "#222a3d", accent: "#8b93f8", accentSoft: "#a5adfb",
    success: "#34d399", danger: "#f87171", warning: "#fbbf24", info: "#60a5fa",
    posBg: "#0d2a22", posText: "#7ee2b8",
    negBg: "#2a1416", negText: "#fca5a5",
    warnBg: "#2b2110", warnText: "#fcd34d",
    neuBg: "#141b2e", neuText: "#c3caff",
    grid: "rgba(238,241,248,0.09)", shadow: "rgba(0,0,0,0.45)", ring: "rgba(139,147,248,0.26)",
  },
  Sepia: {
    bg: "#f4eee0",
    bgGrad: "radial-gradient(circle at 12% -10%, #fbf6ea 0%, #f4eee0 60%)",
    surface: "#fffaf0", surfaceAlt: "#faf3e4", surfaceSunk: "#efe6d3",
    text: "#382e21", muted: "#6b5c45", faint: "#8b7c63",
    border: "#e2d4ba", accent: "#8f5730", accentSoft: "#b57a4a",
    success: "#3d8a5c", danger: "#b0432d", warning: "#b4801f", info: "#3f6f9c",
    posBg: "#edf3e5", posText: "#2c6742",
    negBg: "#f8e8e2", negText: "#8b3520",
    warnBg: "#f7eeda", warnText: "#7d5a12",
    neuBg: "#f1e8d9", neuText: "#674325",
    grid: "rgba(56,46,33,0.10)", shadow: "rgba(80,60,35,0.12)", ring: "rgba(143,87,48,0.20)",
  },
};

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

/** The CSS custom properties for one theme, as a style object React can apply
 *  to the shell element. Keeping this derived from THEMES means adding a token
 *  never requires touching the stylesheet. */
export function themeVars(t: ThemeTokens): Record<string, string> {
  return {
    "--bg": t.bg, "--bg-grad": t.bgGrad, "--surface": t.surface,
    "--surface-alt": t.surfaceAlt, "--surface-sunk": t.surfaceSunk,
    "--text": t.text, "--muted": t.muted, "--faint": t.faint,
    "--border": t.border, "--accent": t.accent, "--accent-soft": t.accentSoft,
    "--success": t.success, "--danger": t.danger, "--warning": t.warning,
    "--info": t.info, "--pos-bg": t.posBg, "--pos-text": t.posText,
    "--neg-bg": t.negBg, "--neg-text": t.negText, "--warn-bg": t.warnBg,
    "--warn-text": t.warnText, "--neu-bg": t.neuBg, "--neu-text": t.neuText,
    "--shadow": t.shadow, "--ring": t.ring,
  };
}

/** Categorical sequence for chart series, drawn from the same tokens. */
export function plotSequence(t: ThemeTokens): string[] {
  return [t.accentSoft, t.success, t.warning, t.info, t.danger, t.faint];
}
