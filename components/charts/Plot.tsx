"use client";

// One chart wrapper for the whole app: it applies the theme tokens to every
// figure, so charts can never drift out of sync with the page around them.

import { useEffect, useRef, useState } from "react";
import type { ThemeTokens } from "@/lib/theme";
import { plotSequence } from "@/lib/theme";

export type PlotData = Record<string, unknown>[];
export type PlotLayout = Record<string, unknown>;

export interface PlotProps {
  data: PlotData;
  layout?: PlotLayout;
  height?: number;
  theme: ThemeTokens;
  /** "top" places a horizontal legend above the plot; "off" hides it. */
  legend?: "top" | "off" | "right";
  onPointClick?: (point: { x: unknown; y: unknown; pointIndex: number }) => void;
  ariaLabel?: string;
}

/** Applies the app's typographic and colour system to any figure.
 *
 *  The title is cleared with an empty string rather than left undefined:
 *  Plotly renders a literal "undefined" above the chart otherwise. */
export function styledLayout(
  layout: PlotLayout, theme: ThemeTokens, height?: number, legend: "top" | "off" | "right" = "top",
): PlotLayout {
  const base: PlotLayout = {
    ...layout,
    font: { family: "Inter, sans-serif", size: 13, color: theme.text },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    colorway: plotSequence(theme),
    margin: (layout.margin as object) ?? { l: 58, r: 16, t: 30, b: 44 },
    hoverlabel: {
      font_family: "IBM Plex Mono, monospace",
      font_size: 13,
      bgcolor: theme.surface,
      bordercolor: theme.border,
    },
    title: { text: "" },
    autosize: true,
  };
  if (height) base.height = height;
  if (legend === "top") {
    base.legend = {
      orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0, font: { size: 12.5 },
    };
  } else if (legend === "off") {
    base.showlegend = false;
  }

  const axis = {
    gridcolor: theme.grid,
    zerolinecolor: theme.grid,
    linecolor: theme.border,
    tickfont: { size: 12, color: theme.muted },
    title: { font: { size: 12.5, color: theme.muted } },
    // Let the chart reserve space for the widest tick label it actually draws.
    // A fixed margin is sized for the typical label, so one wider value (a
    // "100B" among "94B"s) overprints the axis title.
    automargin: true,
  };
  const merge = (key: string) => {
    const existing = (base[key] ?? {}) as Record<string, unknown>;
    const existingTitle = existing.title;
    base[key] = {
      ...axis,
      ...existing,
      title:
        typeof existingTitle === "string"
          ? { text: existingTitle, font: axis.title.font }
          : { ...axis.title, ...((existingTitle as object) ?? {}) },
    };
  };
  for (const key of Object.keys(base)) {
    if (/^(xaxis|yaxis)\d*$/.test(key)) merge(key);
  }
  if (!("xaxis" in base)) merge("xaxis");
  if (!("yaxis" in base)) merge("yaxis");

  return base;
}

export default function Plot({
  data, layout = {}, height = 340, theme, legend = "top", onPointClick, ariaLabel,
}: PlotProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;

  useEffect(() => {
    let disposed = false;
    let element: HTMLDivElement | null = null;

    // Plotly is imported on demand so its bundle never lands in the initial
    // page payload — a reader on the guide page downloads no chart code at all.
    import("./plotly")
      .then((mod) => {
        const Plotly = mod.default;
        if (disposed || !ref.current) return;
        element = ref.current;
        const styled = styledLayout(layout, theme, height, legend);
        Plotly.react(element, data as never, styled as never, {
          displayModeBar: false,
          responsive: true,
          scrollZoom: false,
        });
        if (clickRef.current) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (element as any).on?.("plotly_click", (event: any) => {
            const p = event?.points?.[0];
            if (p) clickRef.current?.({ x: p.x, y: p.y, pointIndex: p.pointIndex ?? 0 });
          });
        }
      })
      .catch(() => setFailed(true));

    return () => {
      disposed = true;
      if (element) {
        import("./plotly")
          .then((mod) => mod.default.purge(element as never))
          .catch(() => {});
      }
    };
  }, [data, layout, theme, height, legend]);

  if (failed) {
    return (
      <div className="empty" style={{ height }}>
        <div className="empty-msg">This chart could not be rendered.</div>
        <div className="empty-hint">The underlying figures are still available in the CSV below.</div>
      </div>
    );
  }

  return <div ref={ref} style={{ width: "100%", height }} role="img" aria-label={ariaLabel} />;
}
