"use client";

// Price action, trend, momentum and volatility — plus a forward projection from
// three methods that share no assumptions.

import { useMemo, useState } from "react";
import { Section, KpiGrid, Note, EmptyState, Loading, Field } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import { band, line, bars, alpha, csvFrom } from "@/components/modules/shared";
import { enrich, lastOf } from "@/lib/analytics/indicators";
import { buildForecast } from "@/lib/analytics/forecast";
import { useApi } from "@/lib/useApi";
import { asPct, isNum, price as fmtPrice, ratio, safeDiv, toneFor } from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";
import type { PriceBar } from "@/lib/data/types";

const OVERLAYS = ["SMA 20", "SMA 50", "SMA 200", "Bollinger bands"] as const;
const PANELS = ["Volume", "RSI", "MACD"] as const;
const HORIZONS: { days: number; label: string }[] = [
  { days: 20, label: "1 month" },
  { days: 40, label: "2 months" },
  { days: 60, label: "3 months" },
  { days: 120, label: "6 months" },
  { days: 250, label: "1 year" },
];

export default function TechnicalAnalysis({
  co, fx, sym, targetCurrency, theme, period, periodLabel, interval, explainOpen,
}: ModuleProps) {
  const [overlays, setOverlays] = useState<string[]>(["SMA 50", "SMA 200"]);
  const [panels, setPanels] = useState<string[]>(["Volume", "RSI"]);
  const [horizon, setHorizon] = useState(60);

  const { data, loading } = useApi<{ bars: PriceBar[] }>(
    `/api/history?ticker=${encodeURIComponent(co.ticker)}&period=${period}&interval=${interval}`,
  );

  // Price columns are converted once, here, so every derived indicator is
  // already in the display currency.
  const enriched = useMemo(() => {
    const raw = data?.bars ?? [];
    const scaled = raw.map((b) => ({
      ...b,
      open: isNum(b.open) ? b.open * fx : null,
      high: isNum(b.high) ? b.high * fx : null,
      low: isNum(b.low) ? b.low * fx : null,
      close: isNum(b.close) ? b.close * fx : null,
    }));
    return enrich(scaled);
  }, [data, fx]);

  const forecast = useMemo(() => {
    const dates = enriched.bars.map((b) => b.date);
    const closes = enriched.bars.map((b) => b.close ?? NaN);
    return buildForecast(dates, closes, horizon);
  }, [enriched, horizon]);

  if (loading) return <Loading label="Loading price history…" />;
  if (!enriched.bars.length) {
    return (
      <EmptyState
        message="No price history returned for this symbol and period."
        hint="Try a longer period — intraday intervals are only available for recent windows."
      />
    );
  }

  const dates = enriched.bars.map((b) => b.date);
  const closes = enriched.bars.map((b) => b.close);
  const validCloses = closes.filter(isNum) as number[];
  const lastPx = validCloses[validCloses.length - 1];
  const firstPx = validCloses[0];
  const rsiNow = lastOf(enriched.rsi);
  const atr = lastOf(enriched.atr);
  const sma50 = lastOf(enriched.sma50);
  const sma200 = lastOf(enriched.sma200);
  const volRatio = safeDiv(lastOf(enriched.bars.map((b) => b.volume)), lastOf(enriched.volSma20));

  const rows = 1 + panels.length;
  const chartHeight = 240 + 190 * rows;

  // Each lower panel gets its own y axis stacked beneath the price panel; the
  // domains are computed so the price keeps the top 55%.
  const priceTop = 1;
  const priceBottom = panels.length ? 0.45 : 0;
  const panelHeight = panels.length ? 0.42 / panels.length : 0;

  const priceData: Record<string, unknown>[] = [
    {
      type: "candlestick",
      x: dates,
      open: enriched.bars.map((b) => b.open),
      high: enriched.bars.map((b) => b.high),
      low: enriched.bars.map((b) => b.low),
      close: closes,
      name: "Price",
      increasing: { line: { color: theme.success } },
      decreasing: { line: { color: theme.danger } },
    },
  ];

  const overlayMap: Record<string, [(number | null)[], string]> = {
    "SMA 20": [enriched.sma20, theme.warning],
    "SMA 50": [enriched.sma50, theme.accentSoft],
    "SMA 200": [enriched.sma200, theme.info],
  };
  for (const label of overlays) {
    const entry = overlayMap[label];
    if (entry) priceData.push(line(dates, entry[0], label, entry[1], { width: 1.6 }));
  }
  if (overlays.includes("Bollinger bands")) {
    priceData.push(line(dates, enriched.bbUpper, "Bollinger upper", theme.faint, { width: 1, dash: "dot" }));
    priceData.push({
      ...line(dates, enriched.bbLower, "Bollinger lower", theme.faint, { width: 1, dash: "dot" }),
      fill: "tonexty",
      fillcolor: alpha(theme.faint, 0.1),
    });
  }

  const layout: Record<string, unknown> = {
    xaxis: { rangeslider: { visible: false }, anchor: panels.length ? `y${rows}` : "y" },
    yaxis: { title: `Price (${sym})`, domain: [priceBottom, priceTop] },
    hovermode: "x unified",
    grid: { rows, columns: 1, pattern: "independent" },
  };

  panels.forEach((panel, i) => {
    const axis = `y${i + 2}`;
    const top = priceBottom - i * (panelHeight + 0.03) - 0.03;
    const bottom = Math.max(top - panelHeight, 0);
    if (panel === "Volume") {
      priceData.push({ ...bars(dates, enriched.bars.map((b) => b.volume), "Volume", theme.faint, 0.55), yaxis: axis });
      layout[`yaxis${i + 2}`] = { title: "Volume", domain: [bottom, top] };
    } else if (panel === "RSI") {
      priceData.push({ ...line(dates, enriched.rsi, "RSI", theme.accent, { width: 1.6 }), yaxis: axis });
      layout[`yaxis${i + 2}`] = { title: "RSI", range: [0, 100], domain: [bottom, top] };
      // The 70/30 lines are drawn as shapes so they scroll with the panel.
      layout.shapes = [
        ...((layout.shapes as unknown[]) ?? []),
        { type: "line", xref: "paper", x0: 0, x1: 1, yref: axis, y0: 70, y1: 70, line: { dash: "dot", color: theme.danger, width: 1 } },
        { type: "line", xref: "paper", x0: 0, x1: 1, yref: axis, y0: 30, y1: 30, line: { dash: "dot", color: theme.success, width: 1 } },
      ];
    } else {
      priceData.push({ ...bars(dates, enriched.macdHist, "MACD histogram", theme.faint, 0.6), yaxis: axis });
      priceData.push({ ...line(dates, enriched.macd, "MACD", theme.accent, { width: 1.5 }), yaxis: axis });
      priceData.push({ ...line(dates, enriched.macdSignal, "Signal", theme.warning, { width: 1.2, dash: "dot" }), yaxis: axis });
      layout[`yaxis${i + 2}`] = { title: "MACD", domain: [bottom, top] };
    }
  });

  const trend = sma50 && lastPx > sma50 ? "above" : "below";
  const rsiState = isNum(rsiNow) && rsiNow > 70 ? "stretched" : isNum(rsiNow) && rsiNow < 30 ? "washed out" : "neutral";
  const end = forecast?.points[forecast.points.length - 1];

  return (
    <>
      <Section
        title="Price, trend and momentum"
        sub={`${periodLabel} of price action for ${co.ticker}, with the overlays and oscillators you select below.`}
      />

      <div className="controls">
        <Field label="Price overlays">
          <CheckGroup options={[...OVERLAYS]} value={overlays} onChange={setOverlays} />
        </Field>
        <Field label="Lower panels">
          <CheckGroup options={[...PANELS]} value={panels} onChange={setPanels} />
        </Field>
      </div>

      <KpiGrid
        id="technicals"
        minWidth={175}
        items={[
          {
            label: "Last close",
            value: fmtPrice(lastPx, sym),
            sub: `${periodLabel} change ${asPct(lastPx / firstPx - 1, 1, true)}`,
            tone: "flat",
          },
          {
            label: "Versus 50-day",
            value: asPct(sma50 ? lastPx / sma50 - 1 : null, 1, true),
            sub: `50-day at ${fmtPrice(sma50, sym)}`,
            tone: sma50 && lastPx > sma50 ? "good" : "bad",
          },
          {
            label: "Versus 200-day",
            value: asPct(sma200 ? lastPx / sma200 - 1 : null, 1, true),
            sub: `200-day at ${fmtPrice(sma200, sym)}`,
            tone: sma200 && lastPx > sma200 ? "good" : "bad",
          },
          {
            label: "RSI (14)",
            value: ratio(rsiNow, 1, ""),
            sub: "Above 70 stretched · below 30 washed out",
            tone: isNum(rsiNow) && (rsiNow > 70 || rsiNow < 30) ? "warn" : "good",
          },
          {
            label: "ATR (14)",
            value: fmtPrice(atr, sym),
            sub: `${asPct(safeDiv(atr, lastPx))} of price per day`,
            tone: "flat",
            help: "Average true range: the typical daily trading range, a plain measure of volatility.",
          },
          {
            label: "Volume vs 20-day",
            value: ratio(volRatio),
            sub: "Above 1.0x means heavier than usual participation",
            tone: "flat",
          },
        ]}
      />

      <Figure
        title="Price with selected overlays and oscillators"
        theme={theme}
        height={chartHeight}
        explainOpen={explainOpen}
        what={`Candlesticks show each period's open, high, low and close in ${targetCurrency}; the lower panels show the indicators you selected.`}
        how="Read the panels top down. **Trend** is price relative to the moving averages, and the averages relative to each other. **Momentum** is RSI: above 70 the move is stretched, below 30 it is washed out — neither is a signal on its own. **Volatility** is the Bollinger band width; bands squeezing together often precedes a larger move in either direction."
        why="Technicals describe positioning and timing, not worth. They are most useful once you already have a view on value from the other modules."
        data={priceData}
        layout={layout}
        csv={csvFrom(dates, {
          Close: closes,
          "SMA 50": enriched.sma50,
          "SMA 200": enriched.sma200,
          RSI: enriched.rsi,
        })}
      />

      <Section
        title="Forecast"
        sub="Three projections built on different assumptions. Where they agree there is weak evidence; where they disagree, that spread is the honest answer."
      />

      <div className="controls">
        <Field label="Horizon (trading days)">
          <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
            {HORIZONS.map((h) => (
              <option key={h.days} value={h.days}>
                {h.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {!forecast || !end ? (
        <EmptyState
          message="Not enough price history in this window to fit a forecast."
          hint="Choose a longer chart period in the sidebar."
        />
      ) : (
        <>
          <Figure
            title={`Projected price over the next ${horizon} trading days`}
            theme={theme}
            height={430}
            explainOpen={explainOpen}
            what="Recent actual prices, then three forward projections: a log-linear trend fitted to the whole window, Holt's damped trend which weights recent days far more heavily, and the median of a geometric random walk built from this stock's own drift and volatility. The shaded areas are the trend's 95% prediction interval and the random walk's 90% range."
            how="Read the **width of the shading**, not the lines. If the bands are wide enough to contain both a good and a bad outcome — which they almost always are — then the central lines are not a target, they are the midpoint of a distribution. Where the damped trend diverges from the log-linear one, recent behaviour differs from the longer window."
            why={
              (isNum(forecast.rSquared)
                ? `The trend explains ${asPct(forecast.rSquared)} of the variation in this window (R² = ${forecast.rSquared.toFixed(2)}). `
                : "") +
              "None of these methods knows anything about earnings, competition or the news. They extrapolate price history, which is exactly the thing that stops working when something changes."
            }
            data={[
              band(
                forecast.points.map((p) => p.date),
                forecast.points.map((p) => p.rwHigh),
                forecast.points.map((p) => p.rwLow),
                alpha(theme.accentSoft, 0.12),
                "Random walk, 90% range",
              ),
              band(
                forecast.points.map((p) => p.date),
                forecast.points.map((p) => p.trendHigh),
                forecast.points.map((p) => p.trendLow),
                alpha(theme.faint, 0.14),
                "Trend, 95% interval",
              ),
              line(dates.slice(-180), closes.slice(-180), "Actual", theme.text, { width: 2.2 }),
              line(forecast.points.map((p) => p.date), forecast.points.map((p) => p.trend), "Log-linear trend", theme.accent, { width: 2, dash: "dash" }),
              ...(forecast.points[0].damped !== null
                ? [line(forecast.points.map((p) => p.date), forecast.points.map((p) => p.damped), "Damped trend (Holt)", theme.warning, { width: 2, dash: "dot" })]
                : []),
              line(forecast.points.map((p) => p.date), forecast.points.map((p) => p.rwMedian), "Random-walk median", theme.success, { width: 1.6 }),
            ]}
            layout={{ yaxis: { title: `Price (${sym})` }, hovermode: "x unified" }}
            csv={csvFrom(
              forecast.points.map((p) => p.date),
              {
                Trend: forecast.points.map((p) => p.trend),
                "Trend low": forecast.points.map((p) => p.trendLow),
                "Trend high": forecast.points.map((p) => p.trendHigh),
                "Damped trend": forecast.points.map((p) => p.damped),
                "Random-walk median": forecast.points.map((p) => p.rwMedian),
                "Random-walk 5%": forecast.points.map((p) => p.rwLow),
                "Random-walk 95%": forecast.points.map((p) => p.rwHigh),
              },
              "Date",
            )}
          />

          <KpiGrid
            id="forecast"
            minWidth={200}
            items={[
              {
                label: "Trend projection",
                value: fmtPrice(end.trend, sym),
                sub: `${asPct(end.trend / lastPx - 1, 1, true)} from today`,
                tone: end.trend > lastPx ? "good" : "bad",
              },
              { label: "Damped trend", value: fmtPrice(end.damped, sym), sub: "Weights recent days most heavily", tone: "flat" },
              { label: "Random-walk median", value: fmtPrice(end.rwMedian, sym), sub: "Drift only, no trend assumption", tone: "flat" },
              {
                label: "90% range at the horizon",
                value: `${fmtPrice(end.rwLow, sym)} – ${fmtPrice(end.rwHigh, sym)}`,
                sub: "Nineteen times in twenty, inside this",
                tone: "flat",
              },
              {
                label: "Implied annual volatility",
                value: asPct(forecast.annualVol),
                sub: "From this window's daily moves",
                tone: "flat",
              },
            ]}
          />

          <Note
            id="forecast-note"
            tone="neu"
            text={[
              `Over ${horizon} trading days the three methods land between **${fmtPrice(Math.min(end.trend, end.rwMedian), sym)}** and **${fmtPrice(Math.max(end.trend, end.rwMedian), sym)}**, inside a 90% range of ${fmtPrice(end.rwLow, sym)} to ${fmtPrice(end.rwHigh, sym)}.`,
              "",
              "- **A price forecast is not a valuation.** These methods extrapolate the price series and nothing else. The intrinsic valuation and peer modules answer what the business is worth; this answers what the recent price pattern would imply if it simply continued.",
              "- **The trend line is the most confident and the least trustworthy.** It fits the window you selected, so changing the chart period changes the forecast — worth trying, precisely because a projection that flips with the window is telling you how little signal there is.",
              "- **Use the band, not the line.** A range wide enough to contain both outcomes is the correct output of an honest short-horizon model, and it is the input a position size should be set from.",
            ].join("\n")}
          />
        </>
      )}

      <Note
        id="technical-note"
        tone={trend === "above" && rsiState !== "stretched" ? "pos" : "warn"}
        text={[
          `Price is trading **${trend}** its 50-day average and **${sma200 && lastPx > sma200 ? "above" : "below"}** its 200-day average, with RSI at ${ratio(rsiNow, 1, "")} — momentum reads **${rsiState}**.`,
          "",
          "- **Trend.** The 50-day against the 200-day is the cleanest single read: price above both usually means buyers are in control on both horizons; between them means the two horizons disagree.",
          "- **Momentum.** A stretched RSI does not mean sell. Strong trends stay overbought for months. It means the odds of a pause or pullback have risen, which matters mostly for entry timing.",
          `- **Volatility.** ATR of ${fmtPrice(atr, sym)} is roughly ${asPct(safeDiv(atr, lastPx))} of the price per day. That is the range to expect on an ordinary day, and a sensible unit for sizing a stop.`,
          `- Volume at ${ratio(volRatio)} of its 20-day average tells you how much conviction is behind the current move: breakouts on light volume are the ones that most often fail.`,
        ].join("\n")}
      />
    </>
  );
}

function CheckGroup({
  options, value, onChange,
}: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", paddingTop: 4 }}>
      {options.map((option) => (
        <label key={option} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={value.includes(option)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, option] : value.filter((v) => v !== option))
            }
          />
          {option}
        </label>
      ))}
    </div>
  );
}
