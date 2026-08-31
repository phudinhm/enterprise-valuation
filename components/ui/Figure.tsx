"use client";

// Every chart in the app goes through here, which is what forces a numbered
// caption plus a "what it shows / how to read it / why it matters" explanation
// to exist for each one — and offers the underlying figures as CSV.

import { useMemo } from "react";
import Plot, { type PlotData, type PlotLayout } from "@/components/charts/Plot";
import { useReport } from "@/components/report";
import type { ThemeTokens } from "@/lib/theme";

export interface FigureData {
  columns: string[];
  rows: (string | number | null)[][];
}

export interface FigureProps {
  title: string;
  what: string;
  how: string;
  why?: string;
  data: PlotData;
  layout?: PlotLayout;
  height?: number;
  theme: ThemeTokens;
  legend?: "top" | "off" | "right";
  /** The figures behind the chart, offered as a CSV download. */
  csv?: FigureData;
  explainOpen?: boolean;
  onPointClick?: (point: { x: unknown; y: unknown; pointIndex: number }) => void;
}

function toCsv(data: FigureData): string {
  const escape = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [data.columns.map(escape).join(","), ...data.rows.map((r) => r.map(escape).join(","))].join("\n");
}

export default function Figure({
  title, what, how, why, data, layout = {}, height = 340, theme, legend = "top", csv,
  explainOpen = false, onPointClick,
}: FigureProps) {
  const report = useReport();
  const num = report.figure(`figure:${title}`, (n) => ({
    kind: "figure",
    key: `figure:${title}`,
    num: n,
    title,
    what,
    how,
    why,
    figure: { data: data as unknown[], layout },
  }));

  const href = useMemo(() => {
    if (!csv) return null;
    return `data:text/csv;charset=utf-8,${encodeURIComponent(toCsv(csv))}`;
  }, [csv]);

  const fileName = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}.csv`;

  return (
    <div className="figure-block">
      <Plot
        data={data}
        layout={layout}
        height={height}
        theme={theme}
        legend={legend}
        ariaLabel={`${title}. ${what}`}
        onPointClick={onPointClick}
      />
      <div className="figcap">
        <div className="figcap-line">
          <span className="figcap-num">Figure {num}</span>
          <span className="figcap-title">{title}.</span> {what}
        </div>
        <details className="explain" open={explainOpen}>
          <summary>How to read this figure</summary>
          <div className="exp-block">
            <div className="exp-row">
              <div className="exp-key">How to read</div>
              <div dangerouslySetInnerHTML={{ __html: emphasise(how) }} />
            </div>
            {why ? (
              <div className="exp-row">
                <div className="exp-key">Why it matters</div>
                <div dangerouslySetInnerHTML={{ __html: emphasise(why) }} />
              </div>
            ) : null}
            {href ? (
              <div className="exp-row">
                <div className="exp-key">Data</div>
                <div>
                  <a href={href} download={fileName}>
                    Download the figures behind this chart (CSV)
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  );
}

/** The captions use **bold** for the phrase a reader should anchor on. */
function emphasise(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
}
