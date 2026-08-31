"use client";

// What a lump sum, or a monthly contribution, invested on a past date would be
// worth now — against the same schedule into a benchmark.

import { useMemo, useState } from "react";
import { Section, KpiGrid, Note, EmptyState, Loading, Field, Segmented } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import { line, alpha, csvFrom } from "@/components/modules/shared";
import { simulatePosition } from "@/lib/analytics/portfolio";
import { histogram } from "@/lib/analytics/risk";
import { useApi } from "@/lib/useApi";
import { BENCHMARKS } from "@/lib/constants";
import { asPct, cagr, fmtDate, isNum, money, toneFor } from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";
import type { PriceBar } from "@/lib/data/types";

const HORIZONS = ["1y", "3y", "5y", "10y", "Custom"] as const;
const YEARS: Record<string, number> = { "1y": 1, "3y": 3, "5y": 5, "10y": 10 };

export default function InvestmentSimulator({ co, fx, sym, theme, explainOpen }: ModuleProps) {
  const [amount, setAmount] = useState(10000);
  const [monthly, setMonthly] = useState(0);
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>("5y");
  const [customStart, setCustomStart] = useState<string>("");
  const [benchmark, setBenchmark] = useState("SPY");

  const { data, loading } = useApi<{ bars: PriceBar[] }>(
    `/api/history?ticker=${encodeURIComponent(co.ticker)}&period=max&interval=1d`,
  );
  const { data: benchData } = useApi<{ bars: PriceBar[] }>(
    benchmark ? `/api/history?ticker=${benchmark}&period=max&interval=1d` : null,
  );

  const all = (data?.bars ?? []).filter((b) => isNum(b.close));
  const firstDay = all.length ? all[0].date : "";
  const lastDay = all.length ? all[all.length - 1].date : "";

  const startDay = useMemo(() => {
    if (!all.length) return "";
    if (horizon === "Custom" && customStart) {
      return customStart < firstDay ? firstDay : customStart;
    }
    const years = YEARS[horizon] ?? 5;
    const proposed = new Date(Date.now() - years * 365 * 86400000).toISOString().slice(0, 10);
    return proposed < firstDay ? firstDay : proposed;
  }, [all, horizon, customStart, firstDay]);

  const window = all.filter((b) => b.date >= startDay);
  const dates = window.map((b) => b.date);
  const prices = window.map((b) => (b.close as number) * fx);

  const position = useMemo(
    () => (prices.length >= 5 ? simulatePosition(dates, prices, amount, monthly) : null),
    [dates, prices, amount, monthly],
  );

  // The benchmark is reindexed onto the position's own dates so both lines
  // start on exactly the same day.
  const benchPosition = useMemo(() => {
    if (!benchData?.bars.length || !dates.length) return null;
    const map = new Map(benchData.bars.filter((b) => isNum(b.close)).map((b) => [b.date, b.close as number]));
    let lastSeen: number | null = null;
    const aligned = dates.map((d) => {
      const v = map.get(d);
      if (isNum(v)) lastSeen = v;
      return lastSeen;
    });
    const firstValid = aligned.find(isNum);
    if (!isNum(firstValid)) return null;
    const filled = aligned.map((v) => (isNum(v) ? v : firstValid));
    return simulatePosition(dates, filled, amount, monthly);
  }, [benchData, dates, amount, monthly]);

  if (loading) return <Loading label="Loading full price history…" />;
  if (!all.length) return <EmptyState message="No price history available for this symbol." />;
  if (!position) {
    return (
      <EmptyState
        message="Not enough price history after that date."
        hint={`This symbol's history starts on ${fmtDate(firstDay)}.`}
      />
    );
  }

  const final = position.value[position.value.length - 1];
  const invested = position.totalInvested;
  const years = Math.max((Date.parse(lastDay) - Date.parse(dates[0])) / (365.25 * 86400000), 1e-9);
  const totalReturn = final / invested - 1;
  const annualised = cagr(invested, final, years);

  let peak = -Infinity;
  let worstDd = 0;
  for (const v of position.value) {
    peak = Math.max(peak, v);
    if (peak > 0) worstDd = Math.min(worstDd, v / peak - 1);
  }

  const benchFinal = benchPosition ? benchPosition.value[benchPosition.value.length - 1] : null;
  const excess = isNum(benchFinal) && benchFinal ? final / benchFinal - 1 : null;

  // Every possible one-year holding period inside this window.
  const rolling: number[] = [];
  for (let i = 252; i < position.value.length; i++) {
    const before = position.value[i - 252];
    if (before > 0) rolling.push((position.value[i] / before - 1) * 100);
  }
  const rollingHist = histogram(rolling, 45);
  const shareNegative = rolling.length ? rolling.filter((r) => r < 0).length / rolling.length : null;

  return (
    <>
      <Section
        title="What an investment would have returned"
        sub="Put a sum into this company on a past date and follow what it would be worth now, against the same sum put into a benchmark."
      />

      <div className="controls">
        <Field label={`Initial investment (${sym})`}>
          <input type="number" min={100} step={500} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </Field>
        <Segmented label="Invested since" options={HORIZONS} value={horizon} onChange={setHorizon} />
        <Field label="Start date">
          <input
            type="date"
            value={horizon === "Custom" ? customStart || startDay : startDay}
            min={firstDay}
            max={lastDay}
            disabled={horizon !== "Custom"}
            onChange={(e) => setCustomStart(e.target.value)}
          />
        </Field>
        <Field
          label={`Added every month (${sym})`}
          help="Set above zero to simulate regular contributions alongside the initial sum."
        >
          <input type="number" min={0} step={100} value={monthly} onChange={(e) => setMonthly(Number(e.target.value))} />
        </Field>
        <Field label="Benchmark">
          <select value={benchmark} onChange={(e) => setBenchmark(e.target.value)}>
            {BENCHMARKS.map((b) => (
              <option key={b.label} value={b.symbol}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {startDay === firstDay && horizon !== "Custom" ? (
        <p className="caption">
          History for {co.ticker} starts on {fmtDate(firstDay)}, so the simulation begins there.
        </p>
      ) : null}

      <KpiGrid
        id="simulator"
        minWidth={205}
        items={[
          {
            label: "Value today",
            value: money(final, sym),
            sub: `From ${money(invested, sym)} invested`,
            tone: final > invested ? "good" : "bad",
          },
          {
            label: "Profit",
            value: money(final - invested, sym),
            sub: `${asPct(totalReturn, 1, true)} on money in`,
            tone: final > invested ? "good" : "bad",
          },
          {
            label: "Annualised return",
            value: asPct(annualised),
            sub: `Over ${years.toFixed(1)} years`,
            tone: toneFor((annualised ?? 0) * 100, 8, 0),
          },
          {
            label: "Deepest fall along the way",
            value: asPct(worstDd),
            sub: "Largest drop from a peak while holding",
            tone: toneFor(worstDd * 100, -20, -45),
            help: "The return is the destination; this is the journey. It is what would actually have tested your conviction.",
          },
          {
            label: "Benchmark value",
            value: money(benchFinal, sym),
            sub: benchmark ? `Same schedule into ${benchmark}` : "No benchmark selected",
            tone: isNum(benchFinal) ? (final > benchFinal ? "good" : "bad") : "flat",
          },
        ]}
      />

      <Figure
        title={`Value of the investment since ${fmtDate(dates[0])}`}
        theme={theme}
        height={420}
        explainOpen={explainOpen}
        what={
          `What ${money(amount, sym)}` +
          (monthly ? ` plus ${money(monthly, sym)} a month` : "") +
          ` put into ${co.ticker} would be worth, against the same schedule into a benchmark and against the cash actually contributed.`
        }
        how="The dotted line is money in; everything above it is gain. Where the position line dips **below** the dotted line, the investment was under water — the periods that matter for whether a strategy is one you could actually have stuck with."
        why="Prices here are adjusted for dividends and splits, so this is a total-return figure: dividends are assumed reinvested on the day they are paid."
        data={[
          {
            ...line(dates, position.value, `${co.ticker} position`, theme.accent, { width: 2.6 }),
            fill: "tozeroy",
            fillcolor: alpha(theme.accentSoft, 0.1),
          },
          ...(benchPosition
            ? [line(dates, benchPosition.value, `${benchmark} benchmark`, theme.warning, { width: 2, dash: "dash" })]
            : []),
          line(dates, position.invested, "Money invested", theme.faint, { width: 1.5, dash: "dot" }),
        ]}
        layout={{ yaxis: { title: `Value (${sym})` }, hovermode: "x unified" }}
        csv={csvFrom(
          dates,
          {
            Position: position.value,
            Invested: position.invested,
            ...(benchPosition ? { Benchmark: benchPosition.value } : {}),
          },
          "Date",
        )}
      />

      {rolling.length ? (
        <Figure
          title="Distribution of rolling one-year returns while holding"
          theme={theme}
          height={300}
          legend="off"
          explainOpen={explainOpen}
          what="Every possible one-year holding period inside this window, and what it returned."
          how={`The share of the distribution left of the dashed line is how often a one-year holder would have been down. Here that is **${asPct(shareNegative)}** of all start dates.`}
          why="A single historical path flatters or damns an investment depending on when you happened to start. This shows the whole range of entry points instead of the one you picked."
          data={[
            {
              type: "bar",
              x: rollingHist.centers,
              y: rollingHist.counts,
              marker: { color: theme.accentSoft },
              opacity: 0.85,
              hovertemplate: "%{x:,.1f}%<br>%{y} start dates<extra></extra>",
            },
          ]}
          layout={{
            xaxis: { title: "Rolling one-year return (%)" },
            yaxis: { title: "Number of days" },
            bargap: 0.02,
            shapes: [
              { type: "line", x0: 0, x1: 0, yref: "paper", y0: 0, y1: 1, line: { dash: "dash", color: theme.danger, width: 2 } },
            ],
          }}
        />
      ) : null}

      <Note
        id="simulator-note"
        tone={totalReturn > 0 ? "pos" : "warn"}
        text={[
          `${money(invested, sym)} invested ${monthly ? `on this schedule since ${fmtDate(dates[0])}` : `from ${fmtDate(dates[0])}`} would be **${money(final, sym)}** today — ${asPct(totalReturn, 1, true)} in total, or **${asPct(annualised)} a year**.`,
          "",
          `- ${
            excess !== null
              ? `That is ${asPct(excess, 1, true)} against the same money in ${benchmark}. Beating a broad index over one specific window is not evidence of skill; the window matters enormously.`
              : "No benchmark was selected, so there is nothing here to say whether the return was good relative to simply owning the market."
          }`,
          `- **The drawdown is the real test.** This position fell ${asPct(worstDd)} from its peak at the worst point. Returns are only collected by holders who did not sell there.`,
          "- **Past performance is a description, not a forecast.** The single largest determinant of the number above is the start date, which is why the rolling distribution matters more than the headline.",
        ].join("\n")}
      />
    </>
  );
}
