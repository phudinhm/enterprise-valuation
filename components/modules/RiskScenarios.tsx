"use client";

// How much the position moves, how far it has fallen before, and what a year of
// the same behaviour could look like.

import { useMemo, useState } from "react";
import { Section, KpiGrid, Note, EmptyState, Loading, Field } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import { band, line, alpha, csvFrom } from "@/components/modules/shared";
import { dailyReturns, drawdownSeries, histogram, riskStats, simulatePaths } from "@/lib/analytics/risk";
import { stdev, quantile } from "@/lib/data/frame";
import { useApi } from "@/lib/useApi";
import { asPct, isNum, pickNum, price as fmtPrice, ratio, toneFor } from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";
import type { PriceBar } from "@/lib/data/types";

const PATH_COUNTS = [200, 500, 1000, 5000, 10000];
const HORIZONS: [number, string][] = [
  [63, "3 months"],
  [126, "6 months"],
  [252, "1 year"],
  [504, "2 years"],
];

export default function RiskScenarios({ co, fx, sym, theme, explainOpen }: ModuleProps) {
  const [sims, setSims] = useState(1000);
  const [horizon, setHorizon] = useState(252);
  const [seed, setSeed] = useState(42);

  const { data, loading } = useApi<{ bars: PriceBar[] }>(
    `/api/history?ticker=${encodeURIComponent(co.ticker)}&period=2y&interval=1d`,
  );

  const bars = data?.bars ?? [];
  const closes = bars.map((b) => b.close).filter(isNum) as number[];
  const dates = bars.filter((b) => isNum(b.close)).map((b) => b.date);

  const risk = useMemo(() => (closes.length > 2 ? riskStats(closes) : null), [closes]);
  const returns = useMemo(() => dailyReturns(closes), [closes]);
  const drawdown = useMemo(() => drawdownSeries(closes), [closes]);

  const lastPrice = closes.length ? closes[closes.length - 1] * fx : 0;

  const simulation = useMemo(() => {
    if (!returns.length || !lastPrice) return null;
    const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
    const sd = stdev(returns, 1) ?? 0;
    return simulatePaths(lastPrice, mu, sd, horizon, sims, seed);
  }, [returns, lastPrice, horizon, sims, seed]);

  if (loading) return <Loading label="Loading two years of price history…" />;
  if (!risk || !closes.length) {
    return <EmptyState message="Not enough price history to compute risk statistics." />;
  }

  const beta = pickNum(co.info, "beta");
  const hist = histogram(returns.map((r) => r * 100), 60);

  const finals = simulation?.finals ?? [];
  const medianFinal = quantile(finals, 0.5) ?? 0;
  const p5 = quantile(finals, 0.05) ?? 0;
  const p95 = quantile(finals, 0.95) ?? 0;
  const probLoss = finals.length ? finals.filter((v) => v < lastPrice).length / finals.length : 0;
  const prob20 = finals.length ? finals.filter((v) => v > lastPrice * 1.2).length / finals.length : 0;
  const days = Array.from({ length: horizon }, (_, i) => i + 1);

  return (
    <>
      <Section
        title="Risk profile"
        sub="How much the position moves, how far it has fallen before, and what a year of the same behaviour could look like."
      />

      <KpiGrid
        id="risk-headline"
        items={[
          {
            label: "Beta",
            value: ratio(beta),
            sub: "Sensitivity to the market: 1.0 moves with it",
            tone: toneFor(beta, 1.0, 1.6, false),
          },
          {
            label: "Annualised volatility",
            value: asPct(risk.vol),
            sub: "Standard deviation of daily returns, annualised",
            tone: toneFor((risk.vol ?? 0) * 100, 25, 50, false),
          },
          {
            label: "Daily VaR (95%)",
            value: asPct(risk.var95),
            sub: "Exceeded on roughly one day in twenty",
            tone: "flat",
            help: "The loss threshold that 95% of daily moves stay above; it says nothing about how bad the worst 5% get.",
          },
          {
            label: "Expected shortfall",
            value: asPct(risk.cvar95),
            sub: "Average loss on the worst 5% of days",
            tone: "flat",
            help: "Conditional VaR: what the tail actually costs when VaR is breached.",
          },
          {
            label: "Maximum drawdown (2y)",
            value: asPct(risk.maxDrawdown),
            sub: "Largest peak-to-trough fall actually experienced",
            tone: toneFor((risk.maxDrawdown ?? 0) * 100, -20, -45),
          },
          {
            label: "Sortino ratio",
            value: ratio(risk.sortino),
            sub: "Return per unit of downside volatility",
            tone: toneFor(risk.sortino, 1.0, 0.0),
            help: "Like Sharpe, but only penalises downside moves, which is what investors actually mind.",
          },
        ]}
      />

      <div className="row two">
        <Figure
          title="Underwater curve"
          theme={theme}
          height={310}
          legend="off"
          explainOpen={explainOpen}
          what="How far below its own running peak the share price has been, every day for the past two years."
          how="Depth is how much was lost from the top; **width is how long it took to recover**, which is the part investors underestimate. A shallow but permanent drawdown can be worse than a deep, quick one."
          why="Volatility is symmetric and abstract; this chart is the asymmetric, concrete version of the same risk, and a better guide to whether a position is holdable."
          data={[
            {
              ...line(dates.slice(1), drawdown.map((d) => d * 100), "Drawdown", theme.danger, { width: 1.4 }),
              fill: "tozeroy",
              fillcolor: alpha(theme.danger, 0.18),
            },
          ]}
          layout={{ yaxis: { title: "Below the running peak (%)", ticksuffix: "%" } }}
          csv={csvFrom(dates.slice(1), { "Drawdown %": drawdown.map((d) => d * 100) }, "Date")}
        />

        <Figure
          title="Distribution of daily returns"
          theme={theme}
          height={310}
          legend="off"
          explainOpen={explainOpen}
          what="How often each size of daily move actually occurred over the past two years."
          how="Check the **tails**, not the middle. A normal distribution would thin out quickly at the edges; real return distributions have fatter tails, meaning extreme days happen more often than the volatility figure implies. The dashed line marks the 95% VaR threshold."
          why="Every model below, including the simulation, assumes something about this shape. Seeing the real one is a useful check on how much to trust them."
          data={[
            {
              type: "bar",
              x: hist.centers,
              y: hist.counts,
              marker: { color: theme.accentSoft },
              opacity: 0.85,
              hovertemplate: "%{x:,.2f}%<br>%{y} days<extra></extra>",
            },
          ]}
          layout={{
            xaxis: { title: "Daily return (%)" },
            yaxis: { title: "Number of days" },
            bargap: 0.02,
            shapes: [
              {
                type: "line",
                x0: (risk.var95 ?? 0) * 100,
                x1: (risk.var95 ?? 0) * 100,
                yref: "paper",
                y0: 0,
                y1: 1,
                line: { dash: "dash", color: theme.danger, width: 2 },
              },
            ],
            annotations: [
              {
                x: (risk.var95 ?? 0) * 100,
                yref: "paper",
                y: 1,
                text: "VaR 95%",
                showarrow: false,
                yanchor: "bottom",
                font: { size: 11.5, color: theme.danger },
              },
            ],
          }}
        />
      </div>

      <Section
        title="Forward simulation"
        sub="One year of possible paths, generated from this stock's own drift and volatility."
      />

      <div className="controls">
        <Field label="Simulated paths">
          <select value={sims} onChange={(e) => setSims(Number(e.target.value))}>
            {PATH_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString("en-US")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Horizon (trading days)">
          <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
            {HORIZONS.map(([d, label]) => (
              <option key={d} value={d}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Random seed" help="Fixing the seed makes the simulation reproducible between runs.">
          <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
        </Field>
      </div>

      {simulation ? (
        <>
          <Figure
            title={`Simulated price distribution over ${horizon} trading days`}
            theme={theme}
            height={380}
            explainOpen={explainOpen}
            what={`${sims.toLocaleString("en-US")} random paths built from this stock's own average daily return and volatility, summarised as a median line with the middle 50% and middle 90% of outcomes shaded.`}
            how="Read the **width**, not the line. The median path is the least interesting part; the spread between the shaded bands is the honest statement of how little a one-year point forecast is worth."
            why="The simulation assumes returns are normally distributed and that the next year resembles the last two. Both assumptions break precisely when it matters — around earnings shocks, rate moves and credit events — so treat the bands as a floor on uncertainty, not a ceiling."
            data={[
              band(days, simulation.p95, simulation.p5, alpha(theme.accentSoft, 0.13), "5th–95th percentile"),
              band(days, simulation.p75, simulation.p25, alpha(theme.accentSoft, 0.25), "25th–75th percentile"),
              line(days, simulation.p50, "Median path", theme.accent, { width: 2.5 }),
            ]}
            layout={{
              xaxis: { title: "Trading days ahead" },
              yaxis: { title: `Price (${sym})` },
              shapes: [
                { type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: lastPrice, y1: lastPrice, line: { dash: "dot", color: theme.faint, width: 1 } },
              ],
            }}
            csv={csvFrom(
              days.map(String),
              { Median: simulation.p50, P5: simulation.p5, P95: simulation.p95 },
              "Day",
            )}
          />

          <KpiGrid
            id="simulation"
            minWidth={185}
            items={[
              {
                label: "Median outcome",
                value: fmtPrice(medianFinal, sym),
                sub: `${asPct(medianFinal / lastPrice - 1, 1, true)} from today`,
                tone: medianFinal > lastPrice ? "good" : "bad",
              },
              { label: "5th percentile", value: fmtPrice(p5, sym), sub: "Only 1 path in 20 ended below this", tone: "flat" },
              { label: "95th percentile", value: fmtPrice(p95, sym), sub: "Only 1 path in 20 ended above this", tone: "flat" },
              {
                label: "Chance of a loss",
                value: asPct(probLoss),
                sub: "Share of paths finishing below today's price",
                tone: toneFor(probLoss * 100, 40, 55, false),
              },
              { label: "Chance of +20%", value: asPct(prob20), sub: "Share of paths finishing at least 20% higher", tone: "flat" },
            ]}
          />

          <Note
            id="risk-note"
            tone={probLoss > 0.5 ? "warn" : "neu"}
            text={[
              `Over the simulated horizon the median path ends at **${fmtPrice(medianFinal, sym)}**, with a 90% band running from ${fmtPrice(p5, sym)} to ${fmtPrice(p95, sym)}.`,
              "",
              `- **Beta of ${ratio(beta)}** says the stock has historically moved ${isNum(beta) && beta < 1 ? "less" : "more"} than the market. That is a statement about the past, and beta is unstable — it changes with the estimation window.`,
              `- **Maximum drawdown of ${asPct(risk.maxDrawdown)}** is the concrete version of that risk: it is what an investor holding through the last two years actually had to sit through.`,
              `- **Position sizing, not prediction,** is what this module is for. If a ${asPct(risk.maxDrawdown)} fall in this position would force you to sell, the position is too large regardless of how good the valuation looks.`,
            ].join("\n")}
          />
        </>
      ) : null}
    </>
  );
}
