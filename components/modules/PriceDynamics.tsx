"use client";

// What actually happened to the shares over the selected window, what was in
// the news while it happened, and what the whole business costs.

import { useMemo, useState } from "react";
import { Section, KpiGrid, Note, EmptyState, Loading, Eyebrow, Caption } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import DataTable from "@/components/ui/DataTable";
import { line, waterfall, csvFrom, secondaryAxisLayout } from "@/components/modules/shared";
import { detectShocks } from "@/lib/analytics/forecast";
import { useApi } from "@/lib/useApi";
import { asPct, fmtDate, isNum, money, pickNum, timeAgo, NA } from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";
import type { NewsItem, PriceBar } from "@/lib/data/types";

interface EventRow {
  date: string;
  movePct: number;
  sigma: number;
  headline: string;
  daysApart: number | null;
}

export default function PriceDynamics({ co, fx, sym, theme, period, periodLabel, interval, explainOpen }: ModuleProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { data, loading } = useApi<{ bars: PriceBar[] }>(
    `/api/history?ticker=${encodeURIComponent(co.ticker)}&period=${period}&interval=${interval}`,
  );
  const { data: news } = useApi<{ company: NewsItem[]; sector: NewsItem[]; etf: string | null }>(
    `/api/news?ticker=${encodeURIComponent(co.ticker)}&sector=${encodeURIComponent(co.sector)}`,
  );

  const bars = (data?.bars ?? []).filter((b) => isNum(b.close));
  const dates = bars.map((b) => b.date);
  const prices = bars.map((b) => (b.close as number) * fx);
  const shares = co.shares ?? 1;
  const marketCaps = prices.map((p) => p * shares);

  // The strongest and sharpest 20-day runs inside this window.
  const { bestIdx, worstIdx, bestVal, worstVal } = useMemo(() => {
    let bi = -1;
    let wi = -1;
    let bv = -Infinity;
    let wv = Infinity;
    for (let i = 20; i < prices.length; i++) {
      const before = prices[i - 20];
      if (!before) continue;
      const change = prices[i] / before - 1;
      if (change > bv) {
        bv = change;
        bi = i;
      }
      if (change < wv) {
        wv = change;
        wi = i;
      }
    }
    return {
      bestIdx: bi,
      worstIdx: wi,
      bestVal: bi >= 0 ? bv : null,
      worstVal: wi >= 0 ? wv : null,
    };
  }, [prices]);

  const shocks = useMemo(() => detectShocks(dates, prices, 2.5, 10), [dates, prices]);

  const allNews = useMemo(
    () => [...(news?.company ?? []), ...(news?.sector ?? [])].filter((n) => n.time),
    [news],
  );

  /** The headline closest to a day, within a three-day window either side. */
  const nearestHeadline = (day: string): { item: NewsItem | null; gap: number | null } => {
    const target = Date.parse(day);
    let best: NewsItem | null = null;
    let bestGap: number | null = null;
    for (const item of allNews) {
      const gap = Math.abs(Math.round((item.time! - target) / 86400000));
      if (gap <= 3 && (bestGap === null || gap < bestGap)) {
        best = item;
        bestGap = gap;
      }
    }
    return { item: best, gap: bestGap };
  };

  const eventRows: EventRow[] = shocks.map((s) => {
    const { item, gap } = nearestHeadline(s.date);
    return {
      date: s.date,
      movePct: s.movePct,
      sigma: s.sigma,
      headline: item ? item.title.slice(0, 110) : "nothing in the current news window",
      daysApart: gap,
    };
  });

  if (loading) return <Loading label="Loading price history…" />;
  if (!bars.length) return <EmptyState message="No price history for this period." />;

  const markedNews = (news?.company ?? []).filter(
    (n) => n.time && dates.length && new Date(n.time).toISOString().slice(0, 10) >= dates[0].slice(0, 10) &&
      new Date(n.time).toISOString().slice(0, 10) <= dates[dates.length - 1].slice(0, 10),
  );

  const selMcap = selectedDate
    ? marketCaps[dates.indexOf(selectedDate)] ?? (co.marketCap ?? 0) * fx
    : (co.marketCap ?? 0) * fx;
  const selLabel = selectedDate ? fmtDate(selectedDate) : "latest";
  const selDebt = (pickNum(co.info, "totalDebt") ?? 0) * fx;
  const selCash = (pickNum(co.info, "totalCash") ?? 0) * fx;

  const ups = shocks.filter((s) => s.movePct > 0).length;
  const downs = shocks.filter((s) => s.movePct < 0).length;
  const matched = eventRows.filter((r) => r.daysApart !== null).length;

  return (
    <>
      <Section
        title="Price, capital and context"
        sub="What actually happened to the shares over the selected window, and what was in the news while it happened."
      />

      <Figure
        title="Price against market capitalisation"
        theme={theme}
        height={430}
        explainOpen={explainOpen}
        what={`Share price (solid, left axis) and market capitalisation (dotted, right axis) over ${periodLabel}${markedNews.length ? `, with ${markedNews.length} recent headlines marked as vertical lines` : ""}. Click any point to rebuild the enterprise value bridge below at that date.`}
        how="The two lines normally move together, because market capitalisation is simply price multiplied by the share count. **Where they diverge, the share count changed** — a buyback pulls market cap below price, an issuance or stock-funded acquisition pushes it above. That divergence is often the most informative thing on the chart."
        why="Per-share performance and company-level performance are different questions. A company can grow while its shares stagnate if the growth was bought with equity."
        onPointClick={(p) => setSelectedDate(typeof p.x === "string" ? p.x : null)}
        data={[
          { ...line(dates, marketCaps, "Market capitalisation", theme.faint, { width: 1.6, dash: "dot" }), yaxis: "y2" },
          line(dates, prices, "Share price", theme.accent, { width: 2.2 }),
        ]}
        layout={{
          ...secondaryAxisLayout(`Price (${sym})`, `Market cap (${sym})`),
          hovermode: "x unified",
          xaxis: { rangeslider: { visible: true } },
          shapes: markedNews.map((n) => ({
            type: "line",
            x0: new Date(n.time!).toISOString().slice(0, 10),
            x1: new Date(n.time!).toISOString().slice(0, 10),
            yref: "paper",
            y0: 0,
            y1: 1,
            line: { dash: "dot", color: theme.warning, width: 1.2 },
            opacity: 0.7,
          })),
        }}
        csv={csvFrom(dates, { Price: prices, "Market cap": marketCaps }, "Date")}
      />

      <Note
        id="price-note"
        tone={(bestVal ?? 0) > Math.abs(worstVal ?? 0) ? "pos" : "warn"}
        text={[
          `Over ${periodLabel.toLowerCase()}, the strongest 20-day run was **${asPct(bestVal, 1, true)}** around ${fmtDate(bestIdx >= 0 ? dates[bestIdx] : null)}, and the sharpest 20-day fall was **${asPct(worstVal, 1, true)}** around ${fmtDate(worstIdx >= 0 ? dates[worstIdx] : null)}.`,
          "",
          "- Clusters of large moves rarely arrive at random. They tend to sit on earnings dates, guidance changes, and macro events — which is what the marked headlines below are there to help you check.",
          "- Sharp falls with no company-specific news usually reflect sector rotation or an index-level move rather than anything about this business.",
          `- Net, the largest rally ${(bestVal ?? 0) > Math.abs(worstVal ?? 0) ? "outpaced" : "was outpaced by"} the largest drawdown over this window.`,
        ].join("\n")}
      />

      <Section
        title="Wall of worry, assembled automatically"
        sub="Every statistically unusual day in this window, found without being told what to look for, and matched against the headlines closest to it."
      />

      {!shocks.length ? (
        <EmptyState
          message="No day in this window moved far enough to stand out statistically."
          hint="Try a longer chart period — quiet windows genuinely have no outliers."
        />
      ) : (
        <>
          <Figure
            title="Statistically unusual days, marked automatically"
            theme={theme}
            height={380}
            legend="off"
            explainOpen={explainOpen}
            what="Every day whose move was at least 2.5 standard deviations from this stock's own average, circled in green for gains and red for falls. Hover for the headline nearest that date."
            how="The threshold is measured in this stock's **own** volatility, not a fixed percentage, so a 4% day registers as a shock for a steady name and passes unremarked for a volatile one. Clusters of circles matter more than isolated ones: they mark regime changes rather than single events."
            why="Marking the moves first and looking for the cause second is the right order. Reading the news first invites you to find a story for a move that was just noise."
            data={[
              line(dates, prices, "Price", theme.accent, { width: 2 }),
              {
                type: "scatter",
                mode: "markers",
                x: shocks.map((s) => s.date),
                y: shocks.map((s) => prices[dates.indexOf(s.date)] ?? null),
                marker: {
                  size: 11,
                  color: shocks.map((s) => (s.movePct > 0 ? theme.success : theme.danger)),
                  symbol: "circle-open",
                  line: { width: 2.5 },
                },
                showlegend: false,
                text: eventRows.map(
                  (r) => `${fmtDate(r.date)}: ${r.movePct >= 0 ? "+" : ""}${r.movePct.toFixed(1)}%<br>${r.headline}`,
                ),
                hoverinfo: "text",
              },
            ]}
            layout={{ yaxis: { title: `Price (${sym})` } }}
            csv={{
              columns: ["Date", "Move %", "Sigma"],
              rows: shocks.map((s) => [s.date, s.movePct, s.sigma]),
            }}
          />

          <DataTable
            title="Unusual days and the nearest headline"
            what="Matched within three days either side. A blank match means the current news feed does not reach back that far — it is a limit of the feed, not evidence that nothing happened."
            columns={[
              { key: "date", header: "Date", render: (r: EventRow) => fmtDate(r.date), align: "left" },
              { key: "move", header: "Move %", render: (r: EventRow) => `${r.movePct >= 0 ? "+" : ""}${r.movePct.toFixed(2)}%` },
              { key: "sigma", header: "Sigma", render: (r: EventRow) => `${r.sigma >= 0 ? "+" : ""}${r.sigma.toFixed(1)}σ` },
              { key: "headline", header: "Closest headline", render: (r: EventRow) => r.headline, align: "left" },
              { key: "gap", header: "Days apart", render: (r: EventRow) => (r.daysApart === null ? NA : String(r.daysApart)) },
            ]}
            rows={eventRows}
            rowKey={(r) => r.date}
          />

          <Note
            id="shock-note"
            tone={downs > ups ? "warn" : "neu"}
            text={[
              `This window contains **${shocks.length} statistically unusual days** — ${ups} up, ${downs} down — of which **${matched}** fall within three days of a headline currently in the feed.`,
              "",
              "- **The unmatched ones are the interesting ones.** A large move with no company or sector news nearby is usually an index-level event, a sector rotation, or a flow rather than anything about this business. The news feed here reaches back only a few weeks, so older events will show blank regardless.",
              "- **Direction matters less than clustering.** Several outliers close together mark a period when the market was repricing the company, and that is the stretch to read the filings and transcripts around.",
              "- Thresholds are relative to this stock's own volatility over the window, so changing the chart period changes what counts as unusual — a deliberate property, not an inconsistency.",
            ].join("\n")}
          />
        </>
      )}

      <Section title="News context" sub="Recent company and sector headlines, most recent first." />
      <div className="row two">
        <div>
          <Eyebrow>{co.ticker} headlines</Eyebrow>
          {news?.company.length ? (
            news.company.map((item) => <NewsRow key={item.title} item={item} />)
          ) : (
            <Caption>No recent company headlines returned.</Caption>
          )}
        </div>
        <div>
          <Eyebrow>
            {co.sector} headlines{news?.etf ? ` · via ${news.etf}` : ""}
          </Eyebrow>
          {news?.sector.length ? (
            news.sector.map((item) => <NewsRow key={item.title} item={item} />)
          ) : (
            <Caption>No sector headlines available for this sector.</Caption>
          )}
        </div>
      </div>

      <Section
        title="Enterprise value at a point in time"
        sub="Market capitalisation at the selected date, adjusted for the latest reported debt and cash."
      />
      <KpiGrid
        record={false}
        minWidth={190}
        items={[
          { label: "Selected date", value: selLabel, sub: "Click the price chart to change this", tone: "flat" },
          { label: "Market cap then", value: money(selMcap, sym), sub: "Price on that date × current share count", tone: "flat" },
          { label: "Enterprise value", value: money(selMcap + selDebt - selCash, sym), sub: "Plus latest debt, less latest cash", tone: "flat" },
        ]}
      />
      <Figure
        title={`Enterprise value bridge (${selLabel})`}
        theme={theme}
        height={320}
        legend="off"
        explainOpen={explainOpen}
        what="Market capitalisation at the selected point, plus debt, less cash."
        how="Only the first bar moves with your click. Debt and cash are the **latest reported** balance-sheet figures, because historical quarter-by-quarter balance sheets are not available from this data source — so a bridge dated far in the past mixes an old market cap with today's capital structure."
        why="Useful for seeing how much of a change in the cost of the whole business came from the share price versus from the balance sheet."
        data={waterfall(
          ["Market cap", "Plus debt", "Less cash", "Enterprise value"],
          [selMcap, selDebt, -selCash, 0],
          ["absolute", "relative", "relative", "total"],
          theme,
          true,
        )}
        layout={{ yaxis: { title: sym } }}
      />
    </>
  );
}

function NewsRow({ item }: { item: NewsItem }) {
  return (
    <div className="news">
      <div className="news-t">
        {item.link ? (
          <a href={item.link} target="_blank" rel="noopener noreferrer">
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </div>
      <div className="news-m">
        {item.publisher} · {timeAgo(item.time)}
      </div>
    </div>
  );
}
