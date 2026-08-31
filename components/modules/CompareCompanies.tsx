"use client";

// Two or more companies on identical measures. Everything is converted to a
// single currency and rebased to a common starting point, so the comparison is
// about the businesses rather than about share prices or listing currencies.

import { useMemo, useState } from "react";
import { Section, Note, EmptyState, Loading, Field, Caption } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { line, csvFrom } from "@/components/modules/shared";
import { scale } from "@/lib/analytics/scorecard";
import { correlationMatrix } from "@/lib/analytics/risk";
import { mean } from "@/lib/data/frame";
import { useApi } from "@/lib/useApi";
import { isNum, money, pct, price as fmtPrice, ratio, NA } from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";
import type { PeerRow } from "@/lib/data/types";

interface ProfileRow {
  ticker: string;
  Value: number | null;
  Profitability: number | null;
  Growth: number | null;
  "Balance sheet": number | null;
  Momentum: number | null;
}

const DIMENSIONS = ["Value", "Profitability", "Growth", "Balance sheet", "Momentum"] as const;

export default function CompareCompanies({
  co, sym, targetCurrency, theme, period, periodLabel, explainOpen,
}: ModuleProps) {
  const { data: peerData } = useApi<{ peers: string[] }>(
    `/api/peers?ticker=${encodeURIComponent(co.ticker)}&sector=${encodeURIComponent(co.sector)}&industry=${encodeURIComponent(co.industry)}&max=6`,
  );

  const suggested = peerData?.peers ?? [];
  const [raw, setRaw] = useState<string | null>(null);
  const defaultList = [...new Set([co.ticker, ...suggested.slice(0, 2)])].join(", ");
  const text = raw ?? defaultList;

  const picks = text
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 8);
  const universe = [...new Set([...picks, co.ticker])];

  const { data: compData, loading } = useApi<{ rows: PeerRow[] }>(
    universe.length >= 2
      ? `/api/comparables?tickers=${universe.join(",")}&currency=${encodeURIComponent(targetCurrency)}`
      : null,
  );
  const rows = compData?.rows ?? [];

  const { data: closesData } = useApi<{ dates: string[]; series: Record<string, (number | null)[]> }>(
    rows.length ? `/api/closes?tickers=${rows.map((r) => r.ticker).join(",")}&range=${period}` : null,
  );

  // Rebasing removes the two things that make raw price charts misleading:
  // differing share prices and differing currencies.
  const rebased = useMemo(() => {
    if (!closesData?.dates.length) return null;
    const out: Record<string, (number | null)[]> = {};
    const returns12m: Record<string, number> = {};
    for (const [ticker, series] of Object.entries(closesData.series)) {
      const firstValue = series.find(isNum);
      if (!isNum(firstValue) || firstValue === 0) continue;
      out[ticker] = series.map((v) => (isNum(v) ? (v / firstValue) * 100 : null));
      const lastValue = [...series].reverse().find(isNum);
      if (isNum(lastValue)) returns12m[ticker] = lastValue / firstValue - 1;
    }
    return { dates: closesData.dates, series: out, returns12m };
  }, [closesData]);

  // A like-for-like profile score, deliberately built from the quote snapshot
  // alone so adding a company costs one request rather than four.
  const profile = useMemo<ProfileRow[]>(
    () =>
      rows.map((r) => ({
        ticker: r.ticker,
        Value: mean([
          scale(r.fcfYield, 0, 8),
          scale(r.pe, 45, 10),
          scale(r.evEbitda, 25, 6),
          scale(r.pb, 8, 1),
        ]),
        Profitability: mean([scale(r.opMargin, 0, 30), scale(r.roe, 0, 25)]),
        Growth: scale(r.revenueGrowth, -5, 25),
        "Balance sheet": scale(r.netDebtEbitda, 4, 0),
        Momentum: scale((rebased?.returns12m[r.ticker] ?? 0) * 100, -30, 40),
      })),
    [rows, rebased],
  );

  const correlation = useMemo(() => {
    if (!closesData?.dates.length) return null;
    const returns: Record<string, number[]> = {};
    for (const [ticker, series] of Object.entries(closesData.series)) {
      const rs: number[] = [];
      for (let i = 1; i < series.length; i++) {
        const a = series[i];
        const b = series[i - 1];
        if (isNum(a) && isNum(b) && b !== 0) rs.push(a / b - 1);
      }
      if (rs.length > 5) returns[ticker] = rs;
    }
    return Object.keys(returns).length > 1 ? correlationMatrix(returns) : null;
  }, [closesData]);

  const best = (key: keyof Omit<ProfileRow, "ticker">): string => {
    const scored = profile.filter((p) => isNum(p[key]));
    if (!scored.length) return NA;
    return scored.reduce((a, b) => ((b[key] as number) > (a[key] as number) ? b : a)).ticker;
  };

  const columns: Column<PeerRow>[] = [
    { key: "ticker", header: "Ticker", render: (r) => r.ticker, align: "left" },
    { key: "name", header: "Name", render: (r) => r.name, align: "left" },
    { key: "price", header: "Price", render: (r) => fmtPrice(r.price, sym) },
    { key: "pe", header: "P/E", render: (r) => ratio(r.pe, 1) },
    { key: "fpe", header: "Fwd P/E", render: (r) => ratio(r.forwardPe, 1) },
    { key: "pb", header: "P/B", render: (r) => ratio(r.pb) },
    { key: "eve", header: "EV/EBITDA", render: (r) => ratio(r.evEbitda, 1) },
    { key: "fcfy", header: "FCF Yield", render: (r) => pct(r.fcfYield) },
    { key: "opm", header: "Op Margin", render: (r) => pct(r.opMargin) },
    { key: "roe", header: "ROE", render: (r) => pct(r.roe) },
    { key: "growth", header: "Revenue Growth", render: (r) => pct(r.revenueGrowth, 1, true) },
    { key: "nde", header: "Net Debt/EBITDA", render: (r) => ratio(r.netDebtEbitda) },
    { key: "mcap", header: "Market Cap", render: (r) => money(r.marketCap, sym) },
  ];

  return (
    <>
      <Section
        title="Side by side"
        sub="Two or more companies on identical measures. Everything is converted to a single currency and rebased to a common starting point, so the comparison is about the businesses rather than about share prices or listing currencies."
      />

      <div className="controls">
        <Field
          label="Companies to compare (comma separated, up to eight)"
          help="Any symbol the data source knows, including cross-market ones such as SAP.DE or 7203.T. The company selected in the sidebar is added automatically."
        >
          <input
            type="text"
            value={text}
            onChange={(e) => setRaw(e.target.value)}
            style={{ minWidth: 420 }}
          />
        </Field>
      </div>

      {universe.length < 2 ? (
        <EmptyState message="Add at least one more company to compare against." />
      ) : loading ? (
        <Loading label={`Loading ${universe.length} companies in parallel…`} />
      ) : !rows.length ? (
        <EmptyState message="None of those symbols returned usable data." />
      ) : (
        <>
          {rebased && Object.keys(rebased.series).length ? (
            <Figure
              title={`Relative price performance over ${periodLabel.toLowerCase()}`}
              theme={theme}
              height={400}
              explainOpen={explainOpen}
              what="Every company's price rebased to 100 on the first day shown, so the lines can be compared directly regardless of the actual share prices or currencies."
              how="The vertical gap between two lines at any date is the difference in total percentage return since the start. A line crossing another is a change in relative performance, which is more informative than either line alone."
              why="Rebasing removes the two things that make raw price charts misleading: differing share prices and differing currencies."
              data={[
                ...Object.entries(rebased.series).map(([ticker, series], i) =>
                  line(rebased.dates, series, ticker, [theme.accentSoft, theme.success, theme.warning, theme.info, theme.danger, theme.faint][i % 6], {
                    width: ticker === co.ticker ? 3 : 1.8,
                  }),
                ),
              ]}
              layout={{
                yaxis: { title: "Rebased to 100 at the start" },
                hovermode: "x unified",
                shapes: [
                  { type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: 100, y1: 100, line: { dash: "dot", color: theme.faint, width: 1 } },
                ],
              }}
              csv={csvFrom(rebased.dates, rebased.series, "Date")}
            />
          ) : (
            <Caption>No shared price history came back for this selection.</Caption>
          )}

          <DataTable
            title="Comparison matrix"
            what={`The same metrics for every company, in ${targetCurrency}. The highlighted row is the company selected in the sidebar.`}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.ticker}
            highlight={co.ticker}
          />

          <Figure
            title="Profile comparison across five dimensions"
            theme={theme}
            height={360}
            explainOpen={explainOpen}
            what="Each company scored 0 to 100 on value, profitability, growth, balance-sheet strength and twelve-month momentum, using the same thresholds for all of them."
            how="Read the **shape**, not the total. A company scoring high on value and low on profitability is cheap for a reason; one high on both is the rarer case worth understanding. Bars are directly comparable because every company is scored on the same scale."
            why="Scores come from the quote snapshot rather than the full statements, so this is a screen for where to look, not a substitute for the dashboard's deeper scorecard."
            data={profile.map((p, i) => ({
              type: "bar",
              name: p.ticker,
              x: [...DIMENSIONS],
              y: DIMENSIONS.map((d) => p[d]),
              marker: {
                color: [theme.accentSoft, theme.success, theme.warning, theme.info, theme.danger, theme.faint][i % 6],
                line: p.ticker === co.ticker ? { width: 2, color: theme.accent } : { width: 0 },
              },
            }))}
            layout={{ barmode: "group", yaxis: { title: "Score (0–100)", range: [0, 100] } }}
            csv={{
              columns: ["Ticker", ...DIMENSIONS],
              rows: profile.map((p) => [p.ticker, ...DIMENSIONS.map((d) => p[d])]),
            }}
          />

          {correlation ? (
            <Figure
              title="Correlation of daily returns"
              theme={theme}
              height={90 + 46 * correlation.keys.length}
              legend="off"
              explainOpen={explainOpen}
              what="How closely each pair of companies has moved together over the period shown. 1.00 is lockstep, 0 is unrelated, negative means they move against each other."
              how="High correlation across the whole grid means these names are effectively one bet — owning several of them diversifies far less than the count suggests. Look for the lowest pairs if diversification is the goal."
              why="Two businesses can look different and still trade as one position, particularly within a single sector or when a shared macro factor dominates."
              data={[
                {
                  type: "heatmap",
                  z: correlation.matrix,
                  x: correlation.keys,
                  y: correlation.keys,
                  colorscale: "RdBu",
                  zmid: 0,
                  zmin: -1,
                  zmax: 1,
                  text: correlation.matrix.map((row) => row.map((v) => (isNum(v) ? v.toFixed(2) : "—"))),
                  texttemplate: "%{text}",
                  textfont: { size: 12 },
                },
              ]}
              layout={{ xaxis: { type: "category" }, yaxis: { type: "category" } }}
              csv={{
                columns: ["", ...correlation.keys],
                rows: correlation.matrix.map((row, i) => [correlation.keys[i], ...row]),
              }}
            />
          ) : null}

          <Note
            id="compare-note"
            tone="neu"
            text={[
              `Across the ${rows.length} companies compared:`,
              "",
              `- **Cheapest on the value measures:** ${best("Value")}. **Most profitable:** ${best("Profitability")}. **Fastest growing:** ${best("Growth")}.`,
              "- These rarely coincide, and when they do it is usually a signal to check whether one of the inputs is distorted by a one-off item rather than a sign of a free lunch.",
              "- **Comparison is only as good as the set.** Adding a company that does not really belong drags every median and every relative judgement with it. Companies in different currencies are converted here, but differences in accounting standards and reporting conventions are not adjusted away.",
            ].join("\n")}
          />
        </>
      )}
    </>
  );
}
