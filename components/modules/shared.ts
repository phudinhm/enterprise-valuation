// Chart-building helpers shared across modules, so a waterfall or a categorical
// axis is defined once rather than in each of the nine places that draws one.

import type { PlotData, PlotLayout } from "@/components/charts/Plot";
import type { ThemeTokens } from "@/lib/theme";
import type { FigureData } from "@/components/ui/Figure";
import { isNum } from "@/lib/format";

/** A fiscal-period axis. Without `type: "category"` the chart library treats
 *  year labels as numbers and invents ticks like "2021.5". */
export const CATEGORY_AXIS = { type: "category" as const };

export function waterfall(
  labels: string[], values: number[], measures: ("absolute" | "relative" | "total")[],
  theme: ThemeTokens, invertColours = false,
): PlotData {
  return [
    {
      type: "waterfall",
      orientation: "v",
      measure: measures,
      x: labels,
      y: values,
      connector: { line: { color: theme.border } },
      increasing: { marker: { color: invertColours ? theme.danger : theme.success } },
      decreasing: { marker: { color: invertColours ? theme.success : theme.danger } },
      totals: { marker: { color: theme.accent } },
      hovertemplate: "%{x}<br>%{y:,.0f}<extra></extra>",
    },
  ];
}

/** A shaded band between two series, drawn as one closed path. */
export function band(
  x: (string | number)[], upper: number[], lower: number[], colour: string, name: string,
): Record<string, unknown> {
  return {
    type: "scatter",
    x: [...x, ...[...x].reverse()],
    y: [...upper, ...[...lower].reverse()],
    fill: "toself",
    fillcolor: colour,
    line: { width: 0 },
    name,
    hoverinfo: "skip",
    showlegend: true,
  };
}

export function line(
  x: (string | number)[], y: (number | null)[], name: string, colour: string,
  opts: { width?: number; dash?: string; mode?: string } = {},
): Record<string, unknown> {
  return {
    type: "scatter",
    mode: opts.mode ?? "lines",
    x,
    y,
    name,
    line: { color: colour, width: opts.width ?? 2, ...(opts.dash ? { dash: opts.dash } : {}) },
  };
}

export function bars(
  x: (string | number)[], y: (number | null)[], name: string,
  colour: string | string[], opacity = 0.85,
): Record<string, unknown> {
  return { type: "bar", x, y, name, marker: { color: colour }, opacity };
}

/** Two y-axes on one plot: the second axis is declared as an overlay of the
 *  first so both series share the same x grid. */
export function secondaryAxisLayout(leftTitle: string, rightTitle: string): PlotLayout {
  return {
    yaxis: { title: leftTitle },
    yaxis2: { title: rightTitle, overlaying: "y", side: "right", showgrid: false },
  };
}

/** Build the CSV payload offered under a figure. */
export function csvFrom(
  index: string[], columns: Record<string, (number | null)[]>, indexName = "Period",
): FigureData {
  const names = Object.keys(columns);
  return {
    columns: [indexName, ...names],
    rows: index.map((label, i) => [label, ...names.map((n) => {
      const v = columns[n]?.[i];
      return isNum(v) ? v : null;
    })]),
  };
}

/** A rgba() string from a hex colour, for the translucent fills. */
export function alpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${a})`;
}
