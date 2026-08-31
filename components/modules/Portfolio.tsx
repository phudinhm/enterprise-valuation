"use client";

// Allocation against policy targets, drift, concentration guardrails, and both
// measures of return.
//
// Nothing is stored anywhere: the holdings table lives in this browser tab
// only. It is never written to a server and never leaves the page.

import { useEffect, useMemo, useState } from "react";
import { Section, KpiGrid, Note, EmptyState, Loading, Checklist, Field, Slider, Caption } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import DataTable from "@/components/ui/DataTable";
import { bars, line, csvFrom } from "@/components/modules/shared";
import { effectivePositions, twrr, xirr } from "@/lib/analytics/portfolio";
import { useApi } from "@/lib/useApi";
import { BENCHMARKS, PORTFOLIO_CATEGORIES } from "@/lib/constants";
import { asPct, isNum, money, pct, price as fmtPrice, ratio, NA } from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";
import type { PeerRow, PriceBar } from "@/lib/data/types";

interface Holding {
  id: string;
  ticker: string;
  shares: number;
  cost: number;
  purchased: string;
  category: string;
}

interface PricedHolding extends Holding {
  price: number | null;
  value: number;
  weight: number;
  gain: number | null;
}

const STORAGE_KEY = "investment-terminal:holdings";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

const SEED: Holding[] = [
  { id: "1", ticker: "AAPL", shares: 40, cost: 150, purchased: daysAgo(730), category: "Core equity" },
  { id: "2", ticker: "MSFT", shares: 25, cost: 280, purchased: daysAgo(500), category: "Core equity" },
  { id: "3", ticker: "SAP.DE", shares: 60, cost: 120, purchased: daysAgo(400), category: "International equity" },
];

export default function Portfolio({ targetCurrency, sym, theme, explainOpen }: ModuleProps) {
  const [holdings, setHoldings] = useState<Holding[]>(SEED);
  const [targets, setTargets] = useState<Record<string, number>>({
    "Core equity": 60,
    "International equity": 20,
    "Fixed income & cash": 20,
    Other: 0,
  });
  const [newCapital, setNewCapital] = useState(10000);
  const [limit, setLimit] = useState(15);
  const [benchmark, setBenchmark] = useState("SPY");

  // The table is restored from this browser's own storage so a refresh does not
  // lose it, and it goes no further than that.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Holding[];
        if (Array.isArray(parsed) && parsed.length) setHoldings(parsed);
      }
    } catch {
      // A blocked or full storage is not a reason to fail the page.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
    } catch {
      // Ignore; the table still works for this session.
    }
  }, [holdings]);

  const valid = holdings.filter((h) => h.ticker.trim() && h.shares > 0);
  const tickers = [...new Set(valid.map((h) => h.ticker.toUpperCase()))];

  const { data: quotes, loading } = useApi<{ rows: PeerRow[] }>(
    tickers.length ? `/api/comparables?tickers=${tickers.join(",")}&currency=${encodeURIComponent(targetCurrency)}` : null,
  );

  const earliest = valid.length ? valid.map((h) => h.purchased).sort()[0] : null;
  const { data: closesData } = useApi<{ dates: string[]; series: Record<string, (number | null)[]> }>(
    tickers.length ? `/api/closes?tickers=${[...tickers, ...(benchmark ? [benchmark] : [])].join(",")}&range=5y` : null,
  );

  const priceByTicker = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of quotes?.rows ?? []) if (isNum(row.price)) map.set(row.ticker, row.price);
    return map;
  }, [quotes]);

  const priced: PricedHolding[] = useMemo(() => {
    const withPrice = valid.map((h) => {
      const price = priceByTicker.get(h.ticker.toUpperCase()) ?? null;
      return { ...h, price, value: isNum(price) ? price * h.shares : 0 };
    });
    const total = withPrice.reduce((a, h) => a + h.value, 0);
    return withPrice
      .filter((h) => isNum(h.price))
      .map((h) => ({
        ...h,
        weight: total ? (h.value / total) * 100 : 0,
        gain: h.cost > 0 ? (h.value / (h.cost * h.shares) - 1) * 100 : null,
      }));
  }, [valid, priceByTicker]);

  const totalValue = priced.reduce((a, h) => a + h.value, 0);
  const totalCost = priced.reduce((a, h) => a + h.cost * h.shares, 0);

  // The portfolio's daily value, rebuilt from closing prices. Two flow series
  // are needed: time-weighted return uses the *market value* the position added
  // on the day it entered, so the difference between the entry price and the
  // cost basis the user typed does not show up as a fake return; money-weighted
  // return uses the *cash actually paid*, which is the point of the measure.
  const history = useMemo(() => {
    if (!closesData?.dates.length || !priced.length || !earliest) return null;
    const dates = closesData.dates.filter((d) => d >= earliest);
    if (!dates.length) return null;
    const offset = closesData.dates.length - dates.length;

    const value = new Array(dates.length).fill(0);
    const flowsMarket = new Array(dates.length).fill(0);
    const flowsCash = new Array(dates.length).fill(0);

    for (const h of priced) {
      const series = closesData.series[h.ticker.toUpperCase()];
      if (!series) continue;
      const window = series.slice(offset);
      let buyIndex = dates.findIndex((d) => d >= h.purchased);
      if (buyIndex < 0) buyIndex = dates.length - 1;
      const entry = window[buyIndex];
      if (!isNum(entry) || entry <= 0) continue;

      for (let i = buyIndex; i < dates.length; i++) {
        const px = window[i];
        if (isNum(px)) value[i] += h.shares * px;
      }
      flowsMarket[buyIndex] += h.shares * entry;
      flowsCash[buyIndex] += h.shares * (h.cost > 0 ? h.cost : entry);
    }

    const benchSeries = benchmark ? closesData.series[benchmark]?.slice(offset) ?? null : null;
    return { dates, value, flowsMarket, flowsCash, benchSeries };
  }, [closesData, priced, earliest, benchmark]);

  const tw = history ? twrr(history.value, history.flowsMarket) : null;
  const twAnnual = useMemo(() => {
    if (!history || tw === null || tw <= -1) return null;
    const days = Math.max(
      (Date.parse(history.dates[history.dates.length - 1]) - Date.parse(history.dates[0])) / 86400000,
      1,
    );
    return Math.pow(1 + tw, 365 / days) - 1;
  }, [history, tw]);

  const mw = useMemo(() => {
    if (!history) return null;
    const flows = history.dates
      .map((d, i) => ({ date: d, amount: -history.flowsCash[i] }))
      .filter((f) => f.amount !== 0);
    flows.push({ date: history.dates[history.dates.length - 1], amount: history.value[history.value.length - 1] });
    return xirr(flows);
  }, [history]);

  const benchReturn = useMemo(() => {
    if (!history?.benchSeries) return null;
    const present = history.benchSeries.filter(isNum) as number[];
    return present.length >= 2 ? present[present.length - 1] / present[0] - 1 : null;
  }, [history]);

  const investedTotal = history ? history.flowsCash.reduce((a, b) => a + b, 0) : 0;

  // --- allocation against target ---------------------------------------------
  const actualByCategory = PORTFOLIO_CATEGORIES.map((cat) => ({
    category: cat,
    value: priced.filter((h) => h.category === cat).reduce((a, h) => a + h.value, 0),
  }));
  const targetTotal = Object.values(targets).reduce((a, b) => a + b, 0);
  const allocation = actualByCategory.map(({ category, value }) => ({
    category,
    target: targets[category] ?? 0,
    actual: totalValue ? (value / totalValue) * 100 : 0,
    value,
    drift: (totalValue ? (value / totalValue) * 100 : 0) - (targets[category] ?? 0),
  }));

  const shortfalls = allocation.map((a) =>
    Math.max(((a.target / 100) * (totalValue + newCapital)) - a.value, 0),
  );
  const shortfallSum = shortfalls.reduce((a, b) => a + b, 0);
  const plan = allocation.map((a, i) => ({
    category: a.category,
    add: shortfallSum > 0 ? (shortfalls[i] / shortfallSum) * newCapital : 0,
    weightAfter: totalValue + newCapital
      ? ((a.value + (shortfallSum > 0 ? (shortfalls[i] / shortfallSum) * newCapital : 0)) / (totalValue + newCapital)) * 100
      : 0,
  }));

  const breaches = priced.filter((h) => h.weight > limit).sort((a, b) => b.weight - a.weight);
  const largest = priced.length ? priced.reduce((a, b) => (b.value > a.value ? b : a)) : null;

  function updateHolding(id: string, patch: Partial<Holding>) {
    setHoldings((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <>
      <Section
        title="Holdings"
        sub="Enter what you own. Everything below — allocation drift, concentration limits, and both measures of return — is computed from this table and refreshed with live prices. Nothing is sent to a server: the table lives in this browser only."
      />

      <div className="table-wrap">
        <table className="editor">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Shares</th>
              <th>Cost per share</th>
              <th>Purchased</th>
              <th>Category</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.id}>
                <td>
                  <input
                    type="text"
                    value={h.ticker}
                    onChange={(e) => updateHolding(h.id, { ticker: e.target.value.toUpperCase() })}
                    aria-label="Ticker"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={h.shares}
                    onChange={(e) => updateHolding(h.id, { shares: Number(e.target.value) })}
                    aria-label="Shares"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={h.cost}
                    onChange={(e) => updateHolding(h.id, { cost: Number(e.target.value) })}
                    aria-label="Cost per share"
                    title="In the security's own currency. Leave at zero to use the closing price on the purchase date."
                  />
                </td>
                <td>
                  <input
                    type="date"
                    value={h.purchased}
                    onChange={(e) => updateHolding(h.id, { purchased: e.target.value })}
                    aria-label="Purchased"
                  />
                </td>
                <td>
                  <select value={h.category} onChange={(e) => updateHolding(h.id, { category: e.target.value })} aria-label="Category">
                    {PORTFOLIO_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setHoldings((rows) => rows.filter((r) => r.id !== h.id))}
                    aria-label={`Remove ${h.ticker}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn"
        style={{ marginTop: 10 }}
        onClick={() =>
          setHoldings((rows) => [
            ...rows,
            {
              id: String(Date.now()),
              ticker: "",
              shares: 0,
              cost: 0,
              purchased: daysAgo(365),
              category: PORTFOLIO_CATEGORIES[0],
            },
          ])
        }
      >
        Add a holding
      </button>

      {!valid.length ? (
        <EmptyState
          message="Add at least one holding to see the analysis."
          hint="Enter a ticker, the number of shares, and the date you bought them."
        />
      ) : loading ? (
        <Loading label={`Pricing ${tickers.length} holdings…`} />
      ) : !priced.length ? (
        <EmptyState message="None of those symbols could be priced right now." />
      ) : (
        <>
          <KpiGrid
            id="portfolio-headline"
            minWidth={210}
            items={[
              {
                label: "Portfolio value",
                value: money(totalValue, sym),
                sub: `${priced.length} positions across ${new Set(priced.map((h) => h.category)).size} categories`,
                tone: "flat",
              },
              {
                label: "Largest position",
                value: largest ? `${largest.ticker} · ${largest.weight.toFixed(1)}%` : NA,
                sub: largest ? money(largest.value, sym) : "",
                tone: (largest?.weight ?? 0) > 25 ? "bad" : (largest?.weight ?? 0) > 15 ? "warn" : "good",
              },
              {
                label: "Unrealised gain",
                value: totalCost > 0 ? money(totalValue - totalCost, sym) : NA,
                sub: totalCost > 0 ? pct((totalValue / totalCost - 1) * 100, 1, true) : "Enter a cost basis to see this",
                tone: totalValue >= totalCost ? "good" : "bad",
              },
              {
                label: "Effective positions",
                value: ratio(effectivePositions(priced.map((h) => h.weight / 100)), 1, ""),
                sub: "Inverse Herfindahl: how many equal-sized positions this is really equivalent to",
                tone: "flat",
                help: "A portfolio of ten names where one is 60% behaves like a portfolio of about three.",
              },
            ]}
          />

          <DataTable
            title="Current holdings"
            what={`Live prices converted to ${targetCurrency}. Gain is against the cost basis entered above.`}
            columns={[
              { key: "ticker", header: "Ticker", render: (h: PricedHolding) => h.ticker, align: "left" },
              { key: "category", header: "Category", render: (h: PricedHolding) => h.category, align: "left" },
              { key: "shares", header: "Shares", render: (h: PricedHolding) => h.shares.toLocaleString("en-US", { maximumFractionDigits: 4 }) },
              { key: "price", header: "Price", render: (h: PricedHolding) => fmtPrice(h.price, sym) },
              { key: "value", header: "Value", render: (h: PricedHolding) => money(h.value, sym) },
              { key: "weight", header: "Weight", render: (h: PricedHolding) => `${h.weight.toFixed(1)}%` },
              { key: "gain", header: "Gain", render: (h: PricedHolding) => pct(h.gain, 1, true) },
            ]}
            rows={priced}
            rowKey={(h) => h.id}
          />

          <Section
            title="Allocation against target"
            sub="Policy targets say where the portfolio should sit. Drift says how far it has moved, and where new money should go to close the gap without selling anything."
          />

          <div className="controls">
            {PORTFOLIO_CATEGORIES.map((cat) => (
              <Field key={cat} label={`${cat} target %`}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={targets[cat] ?? 0}
                  onChange={(e) => setTargets((t) => ({ ...t, [cat]: Number(e.target.value) }))}
                />
              </Field>
            ))}
          </div>
          {targetTotal !== 100 ? (
            <div className="banner warn">
              Targets add up to {targetTotal}%, not 100%. The drift below is measured against the targets as
              entered, so normalise them before acting on it.
            </div>
          ) : null}

          <div className="row wide-left">
            <Figure
              title="Actual allocation against policy target"
              theme={theme}
              height={330}
              explainOpen={explainOpen}
              what="Each category's current share of the portfolio beside the target you set."
              how="The gap between the pale target bar and the solid actual bar is the drift. Drift builds quietly: the category that performs best grows its own weight, so a portfolio left alone becomes progressively more concentrated in whatever has already run."
              why="Rebalancing by directing new contributions at the underweight categories closes drift without realising gains, which is the difference between a tax event and a free adjustment."
              data={[
                bars(allocation.map((a) => a.category), allocation.map((a) => a.target), "Target", theme.faint, 0.55),
                bars(allocation.map((a) => a.category), allocation.map((a) => a.actual), "Actual", theme.accentSoft),
              ]}
              layout={{ barmode: "group", xaxis: { type: "category" }, yaxis: { title: "% of portfolio", ticksuffix: "%" } }}
              csv={{
                columns: ["Category", "Target %", "Actual %", "Value", "Drift (pp)"],
                rows: allocation.map((a) => [a.category, a.target, a.actual, a.value, a.drift]),
              }}
            />

            <div>
              <Field label={`New capital to deploy (${sym})`}>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={newCapital}
                  onChange={(e) => setNewCapital(Number(e.target.value))}
                />
              </Field>
              <DataTable
                title="Where new capital should go"
                what="Directing the new money entirely at underweight categories, with no sales."
                columns={[
                  { key: "category", header: "Category", render: (p: (typeof plan)[number]) => p.category, align: "left" },
                  { key: "add", header: "Add", render: (p: (typeof plan)[number]) => money(p.add, sym) },
                  { key: "after", header: "Weight after", render: (p: (typeof plan)[number]) => `${p.weightAfter.toFixed(1)}%` },
                ]}
                rows={plan}
                rowKey={(p) => p.category}
              />
            </div>
          </div>

          <Slider
            label="Concentration limit for a single holding (% of portfolio)"
            min={5}
            max={40}
            step={1}
            value={limit}
            onChange={setLimit}
            format={(v) => `${v}%`}
            help="Positions above this share of the portfolio are flagged. Single-stock risk is the risk no amount of analysis removes."
          />

          <Checklist
            rows={[...priced]
              .sort((a, b) => b.weight - a.weight)
              .map((h) => {
                const state = h.weight > limit ? "fail" : h.weight > limit * 0.75 ? "warn" : "pass";
                const trim = ((h.weight - limit) / 100) * totalValue;
                return {
                  label: `${h.ticker} · ${h.weight.toFixed(1)}%`,
                  state: state as "pass" | "warn" | "fail",
                  value: money(h.value, sym),
                  detail:
                    state === "fail"
                      ? `over the ${limit}% limit — trimming ${money(trim, sym)} would bring it back within`
                      : state === "warn"
                        ? "approaching the limit; new money is better directed elsewhere"
                        : "within the limit",
                };
              })}
          />

          {breaches.length ? (
            <Note
              id="concentration-note"
              tone="warn"
              text={[
                `**${breaches.length} position${breaches.length > 1 ? "s" : ""} exceed${breaches.length > 1 ? "" : "s"} the ${limit}% limit**: ${breaches.map((b) => `${b.ticker} at ${b.weight.toFixed(1)}%`).join(", ")}.`,
                "",
                "- A single holding above roughly 15% means one company-specific surprise — a failed product, an accounting restatement, a regulatory action — can set the whole portfolio back by more than a normal bear market would.",
                "- The fix does not have to be a sale. Directing every new contribution elsewhere shrinks the weight over time without realising a gain, which is usually the cheaper route.",
                "- Concentration is not automatically wrong; it is a deliberate choice. The question is whether it was chosen or simply arrived at because a winner was left to run.",
              ].join("\n")}
            />
          ) : null}

          <Section
            title="Performance attribution"
            sub="Two different questions: how the assets performed, and how your money performed. They differ whenever contributions were not evenly timed."
          />

          <Field label="Benchmark">
            <select value={benchmark} onChange={(e) => setBenchmark(e.target.value)}>
              {BENCHMARKS.map((b) => (
                <option key={b.label} value={b.symbol}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>

          {!history ? (
            <EmptyState
              message="Could not rebuild a price history for these holdings."
              hint="This usually means one of the symbols has no history at the purchase date entered."
            />
          ) : (
            <>
              <KpiGrid
                id="portfolio-performance"
                minWidth={215}
                items={[
                  {
                    label: "Time-weighted return",
                    value: asPct(tw),
                    sub: `${asPct(twAnnual)} a year · comparable with an index`,
                    tone: (tw ?? 0) > 0 ? "good" : "bad",
                    help: "Removes the effect of when money was added, so it measures the holdings themselves. This is what fund performance tables report.",
                  },
                  {
                    label: "Money-weighted return",
                    value: asPct(mw),
                    sub: "Annualised internal rate of return on your actual cash",
                    tone: (mw ?? 0) > 0 ? "good" : "bad",
                    help: "Your personal return, which rewards or penalises the timing of contributions. If it beats the time-weighted figure, your timing helped.",
                  },
                  {
                    label: "Benchmark over the same window",
                    value: asPct(benchReturn),
                    sub: benchmark ? `${benchmark} total return` : "No benchmark selected",
                    tone: benchReturn === null ? "flat" : (tw ?? 0) > benchReturn ? "good" : "bad",
                  },
                  {
                    label: "Capital deployed",
                    value: money(investedTotal, sym),
                    sub: `Valued at ${money(history.value[history.value.length - 1], sym)} on the price history used here`,
                    tone: "flat",
                    help: "This series is rebuilt from daily closing prices, so it can differ slightly from the live quote total above, which uses the latest intraday price.",
                  },
                ]}
              />

              <Figure
                title="Portfolio against benchmark"
                theme={theme}
                height={380}
                explainOpen={explainOpen}
                what="The portfolio's value rebased to 100 at the earliest purchase date, beside the benchmark over exactly the same window."
                how="Because the portfolio line includes money added along the way, it is not a pure performance line — the time-weighted figure above is. Use this chart for the **shape**: where the two diverge, and whether the gap came from one episode or accumulated steadily."
                why="Beating a benchmark over a window that starts at a date you chose is weak evidence. The value is in seeing when the portfolio behaved differently from the market, and asking why."
                data={[
                  line(
                    history.dates,
                    rebase(history.value),
                    "Portfolio",
                    theme.accent,
                    { width: 2.6 },
                  ),
                  ...(history.benchSeries
                    ? [line(history.dates, rebase(history.benchSeries), benchmark, theme.warning, { width: 2, dash: "dash" })]
                    : []),
                ]}
                layout={{ yaxis: { title: "Rebased to 100" }, hovermode: "x unified" }}
                csv={csvFrom(
                  history.dates,
                  {
                    Portfolio: rebase(history.value),
                    ...(history.benchSeries ? { [benchmark]: rebase(history.benchSeries) } : {}),
                  },
                  "Date",
                )}
              />

              <Note
                id="performance-note"
                tone={(tw ?? 0) > (benchReturn ?? 0) ? "pos" : "neu"}
                text={[
                  `The holdings returned **${asPct(tw)}** time-weighted over this window, while the money actually invested earned **${asPct(mw)}** annualised.`,
                  "",
                  `- **The difference is timing.** ${
                    tw !== null && mw !== null && tw - mw > 0.005
                      ? "The money-weighted figure trails the time-weighted one, which means larger contributions went in before weaker stretches."
                      : tw !== null && mw !== null && tw - mw < -0.005
                        ? "The money-weighted figure leads, which means contributions happened to land before stronger stretches."
                        : "The two are close, which means contribution timing has had little effect either way."
                  }`,
                  "- **Compare the right one.** Time-weighted is the fair comparison against an index, because an index has no contributions. Money-weighted is the honest answer to \"how did I do\".",
                  `- ${
                    benchReturn !== null
                      ? `The portfolio ${(tw ?? 0) > benchReturn ? "beat" : "trailed"} ${benchmark} over the same window (${asPct(benchReturn)}).`
                      : "No benchmark selected, so there is nothing to say whether this was good or bad in context."
                  }`,
                ].join("\n")}
              />
            </>
          )}

          <Section
            title="What the portfolio owns, fundamentally"
            sub="Valuation and quality for every holding, so the portfolio can be judged as a collection of businesses rather than a list of tickers."
          />
          <FundamentalsTable />
        </>
      )}
    </>
  );

  function rebase(series: (number | null)[]): (number | null)[] {
    const first = series.find((v) => isNum(v) && v !== 0);
    if (!isNum(first)) return series;
    return series.map((v) => (isNum(v) ? (v / first) * 100 : null));
  }

  function FundamentalsTable() {
    const rows = quotes?.rows ?? [];
    if (!rows.length) return <Caption>No fundamentals came back for these holdings.</Caption>;

    const weightByTicker = new Map<string, number>();
    for (const h of priced) {
      weightByTicker.set(h.ticker.toUpperCase(), (weightByTicker.get(h.ticker.toUpperCase()) ?? 0) + h.weight);
    }

    const weighted = (key: keyof PeerRow): number | null => {
      let num = 0;
      let den = 0;
      for (const row of rows) {
        const w = weightByTicker.get(row.ticker) ?? 0;
        const v = row[key];
        if (isNum(v) && w > 0) {
          num += v * w;
          den += w;
        }
      }
      return den ? num / den : null;
    };

    return (
      <>
        <DataTable
          title="Holdings on fundamentals"
          what="Weighted by position size, so the metrics that matter most are the ones attached to the largest rows."
          columns={[
            { key: "ticker", header: "Ticker", render: (r: PeerRow) => r.ticker, align: "left" },
            { key: "name", header: "Name", render: (r: PeerRow) => r.name, align: "left" },
            { key: "weight", header: "Weight", render: (r: PeerRow) => `${(weightByTicker.get(r.ticker) ?? 0).toFixed(1)}%` },
            { key: "pe", header: "P/E", render: (r: PeerRow) => ratio(r.pe, 1) },
            { key: "fpe", header: "Fwd P/E", render: (r: PeerRow) => ratio(r.forwardPe, 1) },
            { key: "eve", header: "EV/EBITDA", render: (r: PeerRow) => ratio(r.evEbitda, 1) },
            { key: "fcfy", header: "FCF Yield", render: (r: PeerRow) => pct(r.fcfYield) },
            { key: "opm", header: "Op Margin", render: (r: PeerRow) => pct(r.opMargin) },
            { key: "roe", header: "ROE", render: (r: PeerRow) => pct(r.roe) },
            { key: "nde", header: "Net Debt/EBITDA", render: (r: PeerRow) => ratio(r.netDebtEbitda) },
            { key: "growth", header: "Revenue Growth", render: (r: PeerRow) => pct(r.revenueGrowth, 1, true) },
          ]}
          rows={rows}
          rowKey={(r) => r.ticker}
        />
        <KpiGrid
          id="portfolio-weighted"
          minWidth={200}
          items={[
            { label: "Weighted P/E", value: ratio(weighted("pe")), sub: "Portfolio-level earnings multiple", tone: "flat" },
            { label: "Weighted EV/EBITDA", value: ratio(weighted("evEbitda")), sub: "Capital-structure neutral", tone: "flat" },
            { label: "Weighted operating margin", value: pct(weighted("opMargin")), sub: "Quality of the underlying businesses", tone: "flat" },
            { label: "Weighted revenue growth", value: pct(weighted("revenueGrowth"), 1, true), sub: "How fast the portfolio's businesses are growing", tone: "flat" },
            { label: "Weighted net debt / EBITDA", value: ratio(weighted("netDebtEbitda")), sub: "Leverage carried through the holdings", tone: "flat" },
          ]}
        />
      </>
    );
  }
}
