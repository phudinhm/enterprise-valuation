"use client";

// Cross-company ranking by size and revenue. Pools are a starting universe, not
// an exhaustive index — every figure is still fetched live per symbol.

import { useMemo, useState } from "react";
import { Section, EmptyState, Loading, Field, Segmented, Caption, Slider } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import DataTable from "@/components/ui/DataTable";
import { bars, line, csvFrom, secondaryAxisLayout } from "@/components/modules/shared";
import { useApi } from "@/lib/useApi";
import { MARKET_POOLS, SECTOR_ETF_MAP } from "@/lib/constants";
import { fmtDate, isNum, money, pct, price as fmtPrice } from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";
import type { LeaderRow } from "@/lib/data/types";

const MODES = ["By market", "By sector", "Custom list"] as const;
const ALL_MARKETS = "All tracked markets";

export default function MarketLeaders({ targetCurrency, sym, theme, explainOpen }: ModuleProps) {
  const [mode, setMode] = useState<(typeof MODES)[number]>("By market");
  const [market, setMarket] = useState(Object.keys(MARKET_POOLS)[0]);
  const [sector, setSector] = useState(Object.keys(SECTOR_ETF_MAP)[0]);
  const [customList, setCustomList] = useState("AAPL, MSFT, NVDA, GOOG, AMZN, META, TSLA, BRK-B, LLY, TSM");
  const [topN, setTopN] = useState(12);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));

  const etf = SECTOR_ETF_MAP[sector];
  const { data: holdingsData } = useApi<{ holdings: string[] }>(
    mode === "By sector" ? `/api/holdings?etf=${etf}&max=${Math.max(topN, 15)}` : null,
  );

  const tickers = useMemo(() => {
    if (mode === "By market") {
      const list =
        market === ALL_MARKETS ? Object.values(MARKET_POOLS).flat() : MARKET_POOLS[market] ?? [];
      return [...new Set(list)];
    }
    if (mode === "By sector") return holdingsData?.holdings ?? [];
    return [...new Set(customList.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
  }, [mode, market, customList, holdingsData]);

  const { data, loading } = useApi<{ rows: LeaderRow[] }>(
    tickers.length
      ? `/api/leaderboard?tickers=${tickers.slice(0, 60).join(",")}&currency=${encodeURIComponent(targetCurrency)}&asOf=${asOf}`
      : null,
  );

  const board = data?.rows ?? [];
  const top = board.slice(0, topN);

  const { data: closesData } = useApi<{ dates: string[]; series: Record<string, (number | null)[]> }>(
    top.length ? `/api/closes?tickers=${top.map((t) => t.ticker).join(",")}&range=3y&interval=1wk` : null,
  );

  // Today's share count applied to historical prices — the only market-cap
  // series available without a point-in-time share register.
  const trajectories = useMemo(() => {
    if (!closesData?.dates.length) return null;
    const series: Record<string, (number | null)[]> = {};
    for (const row of top) {
      const closes = closesData.series[row.ticker];
      if (!closes) continue;
      series[row.ticker] = closes.map((v) => (isNum(v) ? v * row.shares * row.fx : null));
    }
    return { dates: closesData.dates, series };
  }, [closesData, top]);

  return (
    <>
      <Section
        title="Market leaders"
        sub="Cross-company ranking by size and revenue. Pools are a starting universe, not an exhaustive index."
      />

      <div className="controls">
        <Segmented label="Universe" options={MODES} value={mode} onChange={setMode} />
        <Slider
          label="Companies to rank"
          min={5}
          max={40}
          step={1}
          value={topN}
          onChange={setTopN}
          help="Each company needs one profile lookup; these run in parallel, but a larger list still takes longer on a cold cache."
        />
        <Field label="As at">
          <input
            type="date"
            value={asOf}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </Field>
      </div>

      {mode === "By market" ? (
        <>
          <Field label="Market">
            <select value={market} onChange={(e) => setMarket(e.target.value)}>
              <option value={ALL_MARKETS}>{ALL_MARKETS}</option>
              {Object.keys(MARKET_POOLS).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Caption>
            Scanning {tickers.length} companies. Market capitalisation is computed from the price on your
            chosen date multiplied by the current share count.
          </Caption>
        </>
      ) : mode === "By sector" ? (
        <>
          <Field label="Sector">
            <select value={sector} onChange={(e) => setSector(e.target.value)}>
              {Object.keys(SECTOR_ETF_MAP).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Caption>
            Current top holdings of {etf}, the {sector} sector ETF, pulled live. Holdings are predominantly
            US-listed, so use the market universe for leaders elsewhere.
          </Caption>
        </>
      ) : (
        <Field label="Symbols">
          <input
            type="text"
            value={customList}
            onChange={(e) => setCustomList(e.target.value)}
            style={{ minWidth: 420 }}
          />
        </Field>
      )}

      {!tickers.length ? (
        <EmptyState message="No companies in the selected universe." hint="Try another market, sector or custom list." />
      ) : loading ? (
        <Loading label={`Loading ${tickers.length} companies in parallel…`} />
      ) : !board.length ? (
        <EmptyState message="No data came back for this universe." hint="The date may fall on a market holiday." />
      ) : (
        <>
          <div className="row wide-left">
            <Figure
              title={`Top ${top.length} by market capitalisation, with revenue alongside`}
              theme={theme}
              height={400}
              explainOpen={explainOpen}
              what={`Ranked by market capitalisation at ${fmtDate(asOf)}, with each company's reported revenue on the second axis.`}
              how="The gap between the two series is the market's verdict on quality. Companies whose bar towers over their revenue point are being paid for margin, growth or durability; those where revenue leads are typically lower-margin or more cyclical businesses."
              why="It is the fastest way to see which businesses the market values per unit of sales, and which it does not."
              data={[
                bars(top.map((t) => t.ticker), top.map((t) => t.marketCap), "Market capitalisation", theme.accentSoft),
                {
                  ...line(top.map((t) => t.ticker), top.map((t) => t.revenue), "Revenue", theme.warning, {
                    width: 2.5,
                    mode: "lines+markers",
                  }),
                  yaxis: "y2",
                },
              ]}
              layout={{
                xaxis: { type: "category" },
                ...secondaryAxisLayout(`Market cap (${sym})`, `Revenue (${sym})`),
              }}
              csv={csvFrom(
                top.map((t) => t.ticker),
                { "Market Cap": top.map((t) => t.marketCap), Revenue: top.map((t) => t.revenue) },
                "Ticker",
              )}
            />

            <Figure
              title="Relative size and profitability"
              theme={theme}
              height={400}
              legend="off"
              explainOpen={explainOpen}
              what="Rectangle area is market capitalisation; colour is net margin, green for higher."
              how="Look for **large but red** rectangles: big companies earning thin margins, where scale is doing the work rather than pricing power. Small green ones are the reverse."
              why="Size and quality are different things, and a ranking by size alone hides that."
              data={[
                {
                  type: "treemap",
                  labels: [...new Set(top.map((t) => t.market)), ...top.map((t) => t.ticker)],
                  parents: [
                    ...[...new Set(top.map((t) => t.market))].map(() => ""),
                    ...top.map((t) => t.market),
                  ],
                  values: [
                    ...[...new Set(top.map((t) => t.market))].map(() => 0),
                    ...top.map((t) => t.marketCap ?? 0),
                  ],
                  branchvalues: "remainder",
                  marker: {
                    colors: [
                      ...[...new Set(top.map((t) => t.market))].map(() => 10),
                      ...top.map((t) => t.netMargin ?? 10),
                    ],
                    colorscale: "RdYlGn",
                    cmid: 10,
                  },
                  textinfo: "label+percent root",
                  hovertemplate: "%{label}<br>%{value:,.0f}<extra></extra>",
                },
              ]}
            />
          </div>

          {trajectories && Object.keys(trajectories.series).length ? (
            <Figure
              title="Market capitalisation trajectories, three years"
              theme={theme}
              height={400}
              explainOpen={explainOpen}
              what="Each line is one leader's market capitalisation over time, using today's share count applied to historical prices."
              how="Watch the **crossings**: where one line overtakes another is where leadership actually changed hands. Lines moving in parallel usually mean a sector-wide re-rating rather than company-specific news."
              why="Rankings are a snapshot; trajectories show who is gaining and who is giving ground."
              data={Object.entries(trajectories.series).map(([ticker, series], i) =>
                line(trajectories.dates, series, ticker, [theme.accentSoft, theme.success, theme.warning, theme.info, theme.danger, theme.faint][i % 6], { width: 1.8 }),
              )}
              layout={{ yaxis: { title: `Market cap (${sym})` }, hovermode: "x unified" }}
              csv={csvFrom(trajectories.dates, trajectories.series, "Date")}
            />
          ) : null}

          <DataTable
            title="Ranking detail"
            what={`All figures converted to ${targetCurrency}; revenue is the latest reported annual figure.`}
            columns={[
              { key: "rank", header: "Rank", render: (r: LeaderRow) => String(top.indexOf(r) + 1), align: "left" },
              { key: "ticker", header: "Ticker", render: (r: LeaderRow) => r.ticker, align: "left" },
              { key: "name", header: "Name", render: (r: LeaderRow) => r.name, align: "left" },
              { key: "market", header: "Market", render: (r: LeaderRow) => r.market, align: "left" },
              { key: "industry", header: "Industry", render: (r: LeaderRow) => r.industry, align: "left" },
              { key: "mcap", header: "Market Cap", render: (r: LeaderRow) => money(r.marketCap, sym) },
              { key: "revenue", header: "Revenue", render: (r: LeaderRow) => money(r.revenue, sym) },
              { key: "margin", header: "Net Margin", render: (r: LeaderRow) => pct(r.netMargin) },
              { key: "price", header: "Price", render: (r: LeaderRow) => fmtPrice(r.price, sym) },
            ]}
            rows={top}
            rowKey={(r) => r.ticker}
          />
        </>
      )}
    </>
  );
}
