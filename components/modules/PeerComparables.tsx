"use client";

// What the market pays for comparable businesses today — a different question
// from what this business is intrinsically worth.

import { useMemo, useState } from "react";
import { Section, SubHead, Note, EmptyState, Caption, Loading, Field } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { useApi } from "@/lib/useApi";
import {
  conv, asPct, isNum, money, pct, pickNum, price as fmtPrice, ratio, safeDiv, NA } from "@/lib/format";
import { median, quantile, stdev, mean } from "@/lib/data/frame";
import type { ModuleProps } from "@/components/modules/types";
import type { PeerRow } from "@/lib/data/types";

interface RankRow {
  metric: string;
  percentile: number;
  value: number;
  peerMedian: number | null;
}

interface FieldRow {
  metric: string;
  low: number;
  mid: number;
  high: number;
  upside: number | null;
}

const RANK_METRICS: [keyof PeerRow, string, boolean][] = [
  ["pe", "P/E", false],
  ["evEbitda", "EV/EBITDA", false],
  ["pb", "P/B", false],
  ["evSales", "EV/Sales", false],
  ["fcfYield", "FCF Yield (%)", true],
  ["opMargin", "Op Margin (%)", true],
  ["roe", "ROE (%)", true],
  ["revenueGrowth", "Revenue Growth (%)", true],
];

export default function PeerComparables({ co, fx, sym, targetCurrency, theme, explainOpen }: ModuleProps) {
  const [selected, setSelected] = useState<string[] | null>(null);
  const [custom, setCustom] = useState("");

  const { data: peerData, loading: peersLoading } = useApi<{ peers: string[]; names: Record<string, string> }>(
    `/api/peers?ticker=${encodeURIComponent(co.ticker)}&sector=${encodeURIComponent(co.sector)}&industry=${encodeURIComponent(co.industry)}`,
  );

  const suggested = peerData?.peers ?? [];
  const names = peerData?.names ?? {};
  const pool = [...new Set([...suggested, "SPY", "QQQ"])];
  const chosen = selected ?? (suggested.length ? suggested.slice(0, 5) : pool.slice(0, 3));

  const extra = custom
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const universe = [...new Set([...chosen, ...extra, co.ticker])];

  const { data: compData, loading: compLoading } = useApi<{ rows: PeerRow[] }>(
    universe.length >= 2
      ? `/api/comparables?tickers=${universe.join(",")}&currency=${encodeURIComponent(targetCurrency)}`
      : null,
  );

  const rows = compData?.rows ?? [];
  const target = rows.find((r) => r.ticker === co.ticker);
  const peersOnly = rows.filter((r) => r.ticker !== co.ticker);

  const ranks = useMemo<RankRow[]>(() => {
    if (!target) return [];
    const out: RankRow[] = [];
    for (const [key, label, higherBetter] of RANK_METRICS) {
      const values = rows
        .map((r) => ({ ticker: r.ticker, v: r[key] as number | null }))
        .filter((r) => isNum(r.v)) as { ticker: string; v: number }[];
      const mine = values.find((v) => v.ticker === co.ticker);
      if (values.length < 3 || !mine) continue;
      const below = values.filter((v) => v.v < mine.v).length / values.length * 100;
      out.push({
        metric: label,
        percentile: higherBetter ? below : 100 - below,
        value: mine.v,
        peerMedian: median(values.filter((v) => v.ticker !== co.ticker).map((v) => v.v)),
      });
    }
    return out;
  }, [rows, target, co.ticker]);

  // Applying the peer group's own multiples to this company's fundamentals.
  const field = useMemo<FieldRow[]>(() => {
    const shares = co.shares ?? 1;
    const netDebt = co.netDebt * fx;
    const curPrice = conv(co.price, fx);
    const revenue = (pickNum(co.info, "totalRevenue") ?? 0) * fx;
    const ebitda = (pickNum(co.info, "ebitda") ?? 0) * fx;

    const fundamentals: [keyof PeerRow, string, number, "equity" | "enterprise"][] = [
      ["pe", "P/E", (pickNum(co.info, "trailingEps") ?? 0) * fx, "equity"],
      ["pb", "P/B", (pickNum(co.info, "bookValue") ?? 0) * fx, "equity"],
      ["evEbitda", "EV/EBITDA", ebitda, "enterprise"],
      ["evSales", "EV/Sales", shares ? revenue / shares : 0, "equity"],
    ];

    const out: FieldRow[] = [];
    for (const [key, label, value, kind] of fundamentals) {
      if (!isNum(value) || value <= 0) continue;
      const multiples = peersOnly.map((r) => r[key] as number | null).filter(isNum) as number[];
      if (multiples.length < 3) continue;
      const implied = (m: number) =>
        kind === "enterprise" ? (m * value - netDebt) / shares : m * value;
      const low = implied(quantile(multiples, 0.25) ?? 0);
      const mid = implied(median(multiples) ?? 0);
      const high = implied(quantile(multiples, 0.75) ?? 0);
      if (low > 0 && high > 0) {
        out.push({ metric: label, low, mid, high, upside: curPrice ? (mid / curPrice - 1) * 100 : null });
      }
    }
    return out;
  }, [peersOnly, co, fx]);

  const avgUp = mean(field.map((f) => f.upside));
  const spread = stdev(field.map((f) => f.upside).filter(isNum) as number[], 1);
  const curPrice = conv(co.price, fx);

  const columns: Column<PeerRow>[] = [
    { key: "ticker", header: "Ticker", render: (r) => r.ticker, align: "left" },
    { key: "name", header: "Name", render: (r) => r.name, align: "left" },
    { key: "price", header: "Price", render: (r) => fmtPrice(r.price, sym) },
    { key: "pe", header: "P/E", render: (r) => ratio(r.pe, 1) },
    { key: "fpe", header: "Fwd P/E", render: (r) => ratio(r.forwardPe, 1) },
    { key: "pb", header: "P/B", render: (r) => ratio(r.pb) },
    { key: "evs", header: "EV/Sales", render: (r) => ratio(r.evSales) },
    { key: "eve", header: "EV/EBITDA", render: (r) => ratio(r.evEbitda, 1) },
    { key: "fcfy", header: "FCF Yield", render: (r) => pct(r.fcfYield) },
    { key: "opm", header: "Op Margin", render: (r) => pct(r.opMargin) },
    { key: "roe", header: "ROE", render: (r) => pct(r.roe) },
    { key: "growth", header: "Revenue Growth", render: (r) => pct(r.revenueGrowth, 1, true) },
    { key: "nde", header: "Net Debt/EBITDA", render: (r) => ratio(r.netDebtEbitda) },
    { key: "mcap", header: "Market Cap", render: (r) => money(r.marketCap, sym) },
  ];

  const scatter = rows.filter((r) => isNum(r.revenueGrowth) && isNum(r.evEbitda));

  return (
    <>
      <Section
        title="Relative valuation"
        sub="What the market pays for comparable businesses today — a different question from what this business is intrinsically worth."
      />

      {peersLoading ? <Loading label="Matching live industry peers…" /> : null}

      <div className="controls">
        <Field label="Peer group">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 4 }}>
            {pool.map((t) => (
              <label key={t} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 13.5 }}>
                <input
                  type="checkbox"
                  checked={chosen.includes(t)}
                  onChange={(e) =>
                    setSelected(e.target.checked ? [...chosen, t] : chosen.filter((c) => c !== t))
                  }
                />
                {t}
                {names[t] ? <span style={{ color: "var(--muted)" }}> — {names[t]}</span> : null}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Add symbols">
          <input
            type="text"
            value={custom}
            placeholder="NVDA, AMD, 005930.KS"
            onChange={(e) => setCustom(e.target.value)}
          />
        </Field>
      </div>

      <Caption>
        {suggested.length
          ? `Peers are matched live on ${co.industry !== NA ? co.industry : "industry"} where possible, falling back to the wider ${co.sector}, drawn from current sector-ETF holdings rather than a fixed list. Everything is converted to ${targetCurrency}.`
          : "No live industry matches came back just now. Add symbols manually to build a comparison set."}
      </Caption>

      {universe.length < 2 ? (
        <EmptyState message="Select at least one peer to compare against." />
      ) : compLoading ? (
        <Loading label={`Fetching ${universe.length} companies in parallel…`} />
      ) : !target ? (
        <EmptyState
          message="Could not build a peer table from the current selection."
          hint="One or more symbols returned no usable data. Try a different peer set."
        />
      ) : (
        <>
          <DataTable
            title="Peer multiples and fundamentals"
            what={`Every selected company on the same basis, in ${targetCurrency}. The highlighted row is ${co.ticker}.`}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.ticker}
            highlight={co.ticker}
          />

          {ranks.length ? (
            <Figure
              title={`Where ${co.ticker} ranks against its peer group`}
              theme={theme}
              height={330}
              legend="off"
              explainOpen={explainOpen}
              what="Each bar is this company's percentile within the selected peer set, already oriented so that further right is always the more favourable outcome — cheap on valuation metrics, high on quality and growth metrics."
              how="The dotted line is the peer median. A profile with bars far right on quality and far left on valuation is the classic value setup; the reverse means you are paying a premium for a middling business."
              why="Percentiles travel better than raw multiples: they are unaffected by the whole sector being expensive or cheap at the moment."
              data={[
                {
                  type: "bar",
                  orientation: "h",
                  x: ranks.map((r) => r.percentile),
                  y: ranks.map((r) => r.metric),
                  marker: { color: ranks.map((r) => (r.percentile >= 50 ? theme.success : theme.danger)) },
                  text: ranks.map((r) => `${r.percentile.toFixed(0)}th`),
                  textposition: "outside",
                  opacity: 0.85,
                },
              ]}
              layout={{
                xaxis: { title: "Percentile within the peer group (higher is better)", range: [0, 108] },
                margin: { l: 150, r: 60, t: 26, b: 44 },
                shapes: [
                  { type: "line", x0: 50, x1: 50, yref: "paper", y0: 0, y1: 1, line: { dash: "dot", color: theme.faint, width: 1 } },
                ],
              }}
              csv={{
                columns: ["Metric", "Percentile", "Value", "Peer median"],
                rows: ranks.map((r) => [r.metric, r.percentile, r.value, r.peerMedian]),
              }}
            />
          ) : null}

          {scatter.length >= 3 ? (
            <Figure
              title="Growth against valuation"
              theme={theme}
              height={420}
              legend="off"
              explainOpen={explainOpen}
              what="Each bubble is a company: revenue growth on the horizontal axis, EV/EBITDA on the vertical, bubble size proportional to market capitalisation. The line is a least-squares fit across the group."
              how="The line is the price the group currently charges for growth. Companies **below** it are cheap relative to what they are growing; **above** it, expensive. Distance from the line matters more than absolute position."
              why={`Peer medians: ${(median(scatter.map((s) => s.revenueGrowth!)) ?? 0).toFixed(1)}% growth at ${(median(scatter.map((s) => s.evEbitda!)) ?? 0).toFixed(1)}x EV/EBITDA. Being below the line is a starting point for investigation, not a conclusion — the discount may be pricing in a real risk this chart cannot see.`}
              data={buildScatter(scatter)}
              layout={{
                xaxis: { title: "Revenue growth (%)" },
                yaxis: { title: "EV/EBITDA (x)" },
              }}
              csv={{
                columns: ["Ticker", "Revenue Growth (%)", "EV/EBITDA", "Market Cap"],
                rows: scatter.map((s) => [s.ticker, s.revenueGrowth, s.evEbitda, s.marketCap]),
              }}
            />
          ) : null}

          <SubHead
            title="Implied value from peer multiples"
            sub="Applying the peer group's own multiples to this company's fundamentals."
          />
          <details className="explain">
            <summary>What a football-field chart is</summary>
            <div className="exp-block">
              <p>
                Named for the yard lines it resembles, it shows a <b>range</b> of implied share prices side by
                side so you can see where different methods agree.
              </p>
              <p>
                <b>1.</b> For each multiple, take the peer group&apos;s 25th percentile, median and 75th
                percentile.
                <br />
                <b>2.</b> Apply each to <i>this</i> company&apos;s own fundamentals — its earnings per share
                for P/E, book value per share for P/B, EBITDA for EV/EBITDA, revenue for EV/Sales.
                <br />
                <b>3.</b> Each bar spans the resulting low-to-high price, with a marker at the median.
                <br />
                <b>4.</b> The dashed line is the current market price.
              </p>
              <p style={{ marginBottom: 0 }}>
                Bars mostly to the right of the line imply the shares are cheap relative to peers; mostly to
                the left, expensive. Bars that disagree sharply with each other point to one input being
                distorted rather than to a real mispricing.
              </p>
            </div>
          </details>

          {field.length ? (
            <>
              <Figure
                title="Peer-implied price ranges"
                theme={theme}
                height={290}
                legend="off"
                explainOpen={explainOpen}
                what="One bar per multiple, spanning the price implied by the peer group's 25th to 75th percentile, with the median marked. The dashed line is today's price."
                how="If the dashed line sits **left** of most bars, peers are valued more richly than this company on those measures. Inside the bars means it is priced in line with the group. Bars that disagree with each other are the interesting case — check which fundamental is unusual."
                why="This is a relative answer only. If the whole peer group is mispriced, every bar moves together and the chart cannot tell you."
                data={[
                  {
                    type: "bar",
                    orientation: "h",
                    y: field.map((f) => f.metric),
                    x: field.map((f) => f.high - f.low),
                    base: field.map((f) => f.low),
                    marker: { color: theme.accentSoft },
                    opacity: 0.35,
                    showlegend: false,
                    hovertemplate: "%{y}<br>%{base:,.2f} – %{x:,.2f}<extra></extra>",
                  },
                  {
                    type: "scatter",
                    mode: "markers",
                    y: field.map((f) => f.metric),
                    x: field.map((f) => f.mid),
                    marker: { color: theme.accent, size: 13, symbol: "line-ns-open", line: { width: 3 } },
                    showlegend: false,
                    hovertemplate: "Peer median implies %{x:,.2f}<extra></extra>",
                  },
                ]}
                layout={{
                  barmode: "overlay",
                  xaxis: { title: `Implied share price (${sym})` },
                  margin: { l: 110, r: 30, t: 26, b: 44 },
                  shapes: [
                    { type: "line", x0: curPrice, x1: curPrice, yref: "paper", y0: 0, y1: 1, line: { dash: "dash", color: theme.danger, width: 2 } },
                  ],
                  annotations: [
                    { x: curPrice, yref: "paper", y: 1, text: "Market price", showarrow: false, yanchor: "bottom", font: { size: 11.5, color: theme.danger } },
                  ],
                }}
                csv={{
                  columns: ["Metric", "Low", "Median", "High"],
                  rows: field.map((f) => [f.metric, f.low, f.mid, f.high]),
                }}
              />

              <DataTable
                title="Implied values by multiple"
                what="The same figures as the chart, with the gap from today's price."
                columns={[
                  { key: "metric", header: "Multiple", render: (f: FieldRow) => f.metric, align: "left" },
                  { key: "low", header: "Low", render: (f: FieldRow) => fmtPrice(f.low, sym) },
                  { key: "mid", header: "Median", render: (f: FieldRow) => fmtPrice(f.mid, sym) },
                  { key: "high", header: "High", render: (f: FieldRow) => fmtPrice(f.high, sym) },
                  {
                    key: "upside",
                    header: "Upside to median",
                    render: (f: FieldRow) => (isNum(f.upside) ? `${f.upside >= 0 ? "+" : ""}${f.upside.toFixed(1)}%` : NA),
                  },
                ]}
                rows={field}
                rowKey={(f) => f.metric}
              />

              <Note
                id="peer-note"
                tone={(avgUp ?? 0) > 5 ? "pos" : (avgUp ?? 0) < -5 ? "neg" : "neu"}
                text={[
                  `Averaged across the multiples above, the peer group's median valuation implies **${pct(avgUp, 1, true)}** against today's price.`,
                  "",
                  `- This is a statement about **relative** value: it says the shares look ${(avgUp ?? 0) > 0 ? "cheap" : "expensive"} next to the peers you chose, not that the peer group itself is correctly valued.`,
                  `- The methods ${isNum(spread) && spread < 15 ? "broadly agree" : "disagree materially with one another, which usually means one input — leverage, a one-off earnings item, or an accounting difference — is distorting a multiple"}.`,
                  "- Peer choice drives the answer. Adding or removing two companies can move the median by more than any analytical insight here, so it is worth checking the table above for names that do not really belong.",
                  "- Read this alongside the intrinsic valuation module: the DCF answers what the business is worth, this answers what the market is currently paying for similar businesses.",
                ].join("\n")}
              />
            </>
          ) : (
            <EmptyState
              message="Not enough peer multiples to build an implied range."
              hint="At least three peers must report the same multiple for a percentile to mean anything."
            />
          )}
        </>
      )}
    </>
  );

  /** Bubbles plus a least-squares fit, which stands in for the trendline the
   *  Python version got from statsmodels. */
  function buildScatter(points: PeerRow[]) {
    const xs = points.map((p) => p.revenueGrowth as number);
    const ys = points.map((p) => p.evEbitda as number);
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
    }
    const slope = sxx ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    const xLo = Math.min(...xs);
    const xHi = Math.max(...xs);

    const maxCap = Math.max(...points.map((p) => p.marketCap ?? 0), 1);
    return [
      {
        type: "scatter",
        mode: "markers+text",
        x: xs,
        y: ys,
        text: points.map((p) => p.ticker),
        textposition: "top center",
        textfont: { size: 11 },
        marker: {
          size: points.map((p) => 12 + 30 * Math.sqrt((p.marketCap ?? 0) / maxCap)),
          color: points.map((p) => (p.ticker === co.ticker ? theme.success : theme.accentSoft)),
        },
        hovertemplate: "%{text}<br>Growth %{x:,.1f}%<br>EV/EBITDA %{y:,.1f}x<extra></extra>",
      },
      {
        type: "scatter",
        mode: "lines",
        x: [xLo, xHi],
        y: [slope * xLo + intercept, slope * xHi + intercept],
        line: { color: theme.faint, width: 1.5, dash: "dash" },
        hoverinfo: "skip",
      },
    ];
  }
}
