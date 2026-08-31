"use client";

// Export and provenance, shared by every data module. The export is a
// deliberate step rather than something done on every render, because
// serialising the charts is the expensive part.

import { useState } from "react";
import { useReport, type ReportBlock } from "@/components/report";
import { markdownToHtml } from "@/components/ui/markdown";
import { fmtDate, NA } from "@/lib/format";
import { APP_NAME, DATA_SOURCE, filingSource, marketLabel, type StatementBasis } from "@/lib/constants";
import type { Company } from "@/lib/data/types";

export interface ProvenanceProps {
  company: Company;
  basis: StatementBasis;
  fx: number;
  nativeCurrency: string;
  targetCurrency: string;
  module: string;
}

const REPORT_CSS = `
body{font-family:Inter,-apple-system,Segoe UI,sans-serif;color:#14172a;background:#fff;
     max-width:1080px;margin:0 auto;padding:44px 30px 90px;line-height:1.6}
h1{font-size:27px;margin:0 0 4px;letter-spacing:-.02em}
.sub{color:#5f6980;font-size:13px;margin-bottom:22px}
h2{font-size:18px;margin:34px 0 4px;padding-top:14px;border-top:1px solid #e4e7f0;letter-spacing:-.01em}
.secsub{color:#5f6980;font-size:13px;margin:0 0 14px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:12px 0}
.kpi{border:1px solid #e4e7f0;border-radius:10px;padding:12px 14px}
.kpi .l{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#5f6980;font-weight:600}
.kpi .v{font-family:'IBM Plex Mono',monospace;font-size:21px;font-weight:600;margin-top:4px}
.kpi .s{font-size:11.5px;color:#5f6980;margin-top:4px}
.note{border:1px solid #e4e7f0;border-left:3px solid #3d3ab0;background:#f7f8fd;
      border-radius:8px;padding:12px 15px;margin:12px 0;font-size:13.5px}
.note.pos{border-left-color:#0f8f5c;background:#f2fbf6}
.note.neg{border-left-color:#cf2c1e;background:#fdf5f4}
.note.warn{border-left-color:#b8760a;background:#fffaef}
.note p{margin:0 0 8px}.note ul{margin:6px 0 7px 19px;padding:0}.note li{margin-bottom:6px}
.cap{font-size:12.5px;color:#5f6980;border-top:1px solid #e4e7f0;padding-top:7px;margin:2px 0 20px}
.cap b{color:#14172a}.capn{font-family:'IBM Plex Mono',monospace;color:#3d3ab0;margin-right:6px}
.exp{font-size:12.5px;color:#3f465c;margin-top:6px}
table{border-collapse:collapse;width:100%;font-size:12.5px;margin:10px 0 20px}
th,td{border-bottom:1px solid #e9ebf2;padding:7px 9px;text-align:right}
th:first-child,td:first-child{text-align:left}
th{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#5f6980;font-weight:600}
.foot{margin-top:44px;border-top:1px solid #e4e7f0;padding-top:14px;font-size:11.5px;color:#8b93a7}
.chart{width:100%;height:400px}
`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A standalone HTML report containing every figure, caption and note on the
 *  page, with the charts still interactive. */
function buildReportHtml(blocks: ReportBlock[], meta: { title: string; subtitle: string; footer: string }): string {
  const body: string[] = [`<h1>${escapeHtml(meta.title)}</h1>`, `<div class="sub">${meta.subtitle}</div>`];
  const charts: string[] = [];

  blocks.forEach((b, i) => {
    switch (b.kind) {
      case "section":
        body.push(`<h2>${b.n}. ${escapeHtml(b.title ?? "")}</h2>`);
        if (b.sub) body.push(`<div class="secsub">${escapeHtml(b.sub)}</div>`);
        break;
      case "kpis":
        body.push(
          `<div class="kpis">${(b.items ?? [])
            .map(
              (it) =>
                `<div class="kpi"><div class="l">${escapeHtml(it.label)}</div>` +
                `<div class="v">${escapeHtml(it.value)}</div>` +
                `<div class="s">${escapeHtml(it.sub ?? "")}</div></div>`,
            )
            .join("")}</div>`,
        );
        break;
      case "note":
        body.push(`<div class="note ${b.tone ?? "neu"}">${markdownToHtml(b.text ?? "")}</div>`);
        break;
      case "figure": {
        const id = `chart_${i}`;
        body.push(`<div id="${id}" class="chart"></div>`);
        body.push(
          `<div class="cap"><span class="capn">Figure ${b.num}</span><b>${escapeHtml(b.title ?? "")}</b>. ` +
            `${escapeHtml(b.what ?? "")}<div class="exp">${escapeHtml(b.how ?? "")}</div>` +
            (b.why ? `<div class="exp">${escapeHtml(b.why)}</div>` : "") +
            `</div>`,
        );
        if (b.figure) {
          charts.push(
            `Plotly.newPlot(${JSON.stringify(id)}, ${JSON.stringify(b.figure.data)}, ` +
              `${JSON.stringify({ ...b.figure.layout, autosize: true, height: 400 })}, {displayModeBar:false,responsive:true});`,
          );
        }
        break;
      }
      case "table":
        if (b.title) {
          body.push(`<div class="cap"><b>${escapeHtml(b.title)}</b>. ${escapeHtml(b.what ?? "")}</div>`);
        }
        if (b.table) {
          body.push(
            `<table><thead><tr>${b.table.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>` +
              `<tbody>${b.table.rows
                .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
                .join("")}</tbody></table>`,
          );
        }
        break;
      default:
        if (b.text) body.push(`<p style="font-size:13.5px">${markdownToHtml(b.text)}</p>`);
    }
  });

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(meta.title)}</title><style>${REPORT_CSS}</style>` +
    `<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script></head><body>` +
    body.join("") +
    `<div class="foot">${escapeHtml(meta.footer)}</div>` +
    `<script>${charts.join("\n")}</script></body></html>`
  );
}

export default function Provenance({
  company, basis, fx, nativeCurrency, targetCurrency, module,
}: ProvenanceProps) {
  const report = useReport();
  const [href, setHref] = useState<string | null>(null);
  const src = filingSource(company.ticker);

  function prepare() {
    const now = new Date();
    const html = buildReportHtml(report.blocks(), {
      title: `${company.name} (${company.ticker}) — ${module}`,
      subtitle:
        `${company.sector} · ${company.industry} · ${marketLabel(company.ticker)} &nbsp;|&nbsp; ` +
        `Prepared ${now.toLocaleString("en-GB")} &nbsp;|&nbsp; Figures in ${targetCurrency}` +
        (nativeCurrency !== targetCurrency ? ` (converted from ${nativeCurrency} at ${fx.toFixed(4)})` : ""),
      footer:
        `Generated by ${APP_NAME}. Source: ${DATA_SOURCE}. Educational research only — not investment ` +
        `advice. Figures should be verified against primary filings before use.`,
    });
    setHref(URL.createObjectURL(new Blob([html], { type: "text/html" })));
  }

  const sourcesServed = Object.entries(company.sources)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const rows: [string, React.ReactNode][] = [
    ["Primary source", DATA_SOURCE],
    ["Served by", sourcesServed || "everything on this page came from the in-session cache"],
    ["Backups available", "Stooq (prices, most developed markets) · SEC EDGAR XBRL (statements, US filers)"],
    ["Quote endpoint", `${company.quoteFields} of ${company.quoteMetricCount} headline metrics returned`],
    [
      "Primary filings",
      src.url ? (
        <a href={src.url} target="_blank" rel="noopener noreferrer">
          {src.name}
        </a>
      ) : (
        src.name
      ),
    ],
    [
      "Computed locally",
      `${company.derived.length} field(s)${company.derived.length ? ` — ${company.derived.join(", ")}` : ""}`,
    ],
    ["Symbol resolved", `${company.ticker} · ${marketLabel(company.ticker)}`],
    [
      "Reporting currency",
      `${nativeCurrency} → ${targetCurrency}${nativeCurrency !== targetCurrency ? ` at ${fx.toFixed(4)}` : ""}`,
    ],
    ["Statement basis", basis],
    [
      "Latest annual period",
      company.annual.inc.periods.length ? fmtDate(company.annual.inc.periods.at(-1)!) : NA,
    ],
    [
      "Latest quarter",
      company.quarterly.inc.periods.length ? fmtDate(company.quarterly.inc.periods.at(-1)!) : NA,
    ],
    ["Cache windows", "Quotes and news 15 min · statements 60 min · FX 60 min · SEC filings 24 h"],
  ];

  return (
    <div className="row two no-print" style={{ marginTop: 26 }}>
      <details className="explain">
        <summary>Export this view as a report</summary>
        <div style={{ paddingTop: 6 }}>
          <p className="caption">
            Produces a standalone HTML file containing every figure, caption and note on this page, with the
            charts still interactive. Preparing it serialises the charts, so it is a deliberate step rather
            than something done on every render.
          </p>
          {href ? (
            <a
              className="btn primary"
              style={{ display: "inline-block", textDecoration: "none" }}
              href={href}
              download={`${company.ticker}_${module.toLowerCase().replace(/\s+/g, "_")}_report.html`}
            >
              Download the HTML report
            </a>
          ) : (
            <button type="button" className="btn primary" onClick={prepare}>
              Prepare report
            </button>
          )}
        </div>
      </details>

      <details className="explain">
        <summary>Data provenance</summary>
        <div className="card" style={{ marginTop: 6 }}>
          {rows.map(([k, v]) => (
            <div
              key={k}
              style={{
                display: "grid",
                gridTemplateColumns: "170px 1fr",
                gap: 10,
                fontSize: 12.5,
                padding: "4px 0",
              }}
            >
              <span style={{ color: "var(--muted)" }}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
          {company.errors.length ? (
            <>
              <p className="caption" style={{ marginTop: 10 }}>
                Non-fatal issues during loading:
              </p>
              {company.errors.map((e) => (
                <p className="caption" key={e}>
                  · {e}
                </p>
              ))}
            </>
          ) : null}
        </div>
      </details>
    </div>
  );
}
