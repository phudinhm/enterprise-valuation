// Checks the ported engines against values computed by hand, so a refactor that
// changes a formula fails loudly rather than quietly returning a different
// number. Run with: npm run verify
//
// Every expected figure below is derived from the model's own definition, not
// from a previous run of this code.

import { dcf, impliedGrowth, grahamNumber, lynchValue, capmWacc, effectiveTaxRate, impliedCostOfDebt } from "@/lib/analytics/valuation";
import { altmanZ, piotroskiF } from "@/lib/analytics/scoring";
import { xirr, twrr, simulatePosition, effectivePositions } from "@/lib/analytics/portfolio";
import { normPpf, riskStats, dailyReturns, drawdownSeries, simulatePaths, correlationMatrix, histogram } from "@/lib/analytics/risk";
import { enrich, sma, ema, rsi } from "@/lib/analytics/indicators";
import { buildForecast, detectShocks } from "@/lib/analytics/forecast";
import { scale } from "@/lib/analytics/scorecard";
import { ttmFromQuarters, toDisplay, median, quantile, stdev, pctChange, yearLabels } from "@/lib/data/frame";
import { money, pct, asPct, ratio, dividendYield, deAsRatio, safeDiv, cagr, monogram } from "@/lib/format";
import { stooqSymbol } from "@/lib/data/stooq";
import { markdownToHtml } from "@/components/ui/markdown";

let failures = 0;
let checks = 0;

function ok(name: string, condition: boolean, detail = "") {
  checks++;
  if (!condition) {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function near(name: string, actual: number | null | undefined, expected: number, tol = 1e-6) {
  const good = typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  ok(name, good, `expected ${expected}, got ${actual}`);
}

function eq(name: string, actual: unknown, expected: unknown) {
  ok(name, Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log("Formatting");
eq("money scales to billions", money(1_234_000_000), "$1.23B");
eq("money keeps the sign outside the symbol", money(-4_500_000), "-$4.50M");
eq("money returns the placeholder for a gap", money(null), "—");
eq("pct signs only when asked", pct(12.34), "12.3%");
eq("pct signed shows a plus", pct(12.34, 1, true), "+12.3%");
eq("pct signed shows a minus", pct(-12.34, 1, true), "-12.3%");
eq("asPct converts a fraction", asPct(0.1234), "12.3%");
eq("ratio appends the multiple suffix", ratio(1.5), "1.50x");
eq("monogram takes two initials", monogram("Berkshire Hathaway Inc"), "BH");
near("safeDiv divides", safeDiv(10, 4), 2.5);
eq("safeDiv refuses a zero denominator", safeDiv(10, 0), null);
near("cagr over three years", cagr(100, 133.1, 3), 0.1, 1e-9);
eq("cagr refuses a negative start", cagr(-100, 50, 3), null);

// debtToEquity arrives as a percentage; anything above 5 must be scaled.
near("deAsRatio scales a percentage", deAsRatio(154), 1.54);
near("deAsRatio leaves a true ratio alone", deAsRatio(1.54), 1.54);

// Yield is derived from the rate first, because the reported field has meant
// both a fraction and a percentage across upstream versions.
near("dividendYield derives from rate and price", dividendYield({ dividendRate: 4 }, 100), 0.04);
near("dividendYield rescales a percentage-shaped field", dividendYield({ dividendYield: 4.4 }, 100), 0.044);
eq("dividendYield rejects an implausible value", dividendYield({ dividendYield: 90 }, 100), null);

console.log("Valuation");
// A flat, no-growth perpetuity: 10 years of 100 at a 10% discount and zero
// terminal growth. PV of the explicit flows is 100 * annuity(10, 10%), and the
// terminal value is 100/0.10 discounted ten years.
{
  const r = dcf(100, 0, 5, 0, 0.1, 0, 0, 1, 5);
  const annuity = (1 - Math.pow(1.1, -10)) / 0.1;
  near("DCF explicit leg is an annuity", r!.pvExplicit, 100 * annuity, 1e-6);
  near("DCF terminal leg is Gordon-discounted", r!.pvTerminal, (100 / 0.1) / Math.pow(1.1, 10), 1e-6);
  near("DCF enterprise value adds the legs", r!.enterpriseValue, r!.pvExplicit + r!.pvTerminal, 1e-9);
  near("DCF terminal share", r!.terminalShare!, r!.pvTerminal / r!.enterpriseValue, 1e-12);
}
{
  // Net debt is subtracted from enterprise value, then divided by the shares.
  const r = dcf(100, 0, 5, 0, 0.1, 0, 500, 10, 5);
  near("DCF equity value nets off debt", r!.equityValue, r!.enterpriseValue - 500, 1e-9);
  near("DCF fair value is per share", r!.fairValue, (r!.enterpriseValue - 500) / 10, 1e-9);
}
{
  // A discount rate at or below terminal growth implies infinite value; the
  // model lifts the rate rather than returning nonsense.
  const r = dcf(100, 0.05, 5, 0.03, 0.02, 0.03, 0, 1);
  ok("DCF keeps the Gordon denominator positive", r !== null && r.waccUsed > 0.03, `wacc used ${r?.waccUsed}`);
}
eq("DCF refuses a zero share count", dcf(100, 0.05, 5, 0.03, 0.09, 0.02, 0, 0), null);

{
  // A reverse DCF must recover the growth rate that produced a given price.
  const truth = 0.11;
  const r = dcf(1000, truth, 5, (truth + 0.02) / 2, 0.09, 0.02, 2000, 100);
  const recovered = impliedGrowth(r!.fairValue, 1000, 5, (truth + 0.02) / 2, 0.09, 0.02, 2000, 100);
  near("reverse DCF recovers the growth that made the price", recovered, truth, 1e-4);
}

near("Graham number", grahamNumber(4, 20), Math.sqrt(22.5 * 4 * 20), 1e-9);
eq("Graham number refuses negative earnings", grahamNumber(-1, 20), null);
near("Lynch value at PEG 1", lynchValue(5, 12), 60);
near("Lynch value caps growth at 25", lynchValue(5, 40), 125);

{
  // CAPM: cost of equity is rf + beta * erp; the blend weights by market value.
  const { wacc, costEquity, weightEquity, weightDebt } = capmWacc(1.2, 0.04, 0.05, 0.06, 0.25, 800, 200);
  near("CAPM cost of equity", costEquity, 0.04 + 1.2 * 0.05, 1e-12);
  near("CAPM equity weight", weightEquity, 0.8, 1e-12);
  near("CAPM debt weight", weightDebt, 0.2, 1e-12);
  near("CAPM blended WACC", wacc, 0.8 * 0.1 + 0.2 * 0.06 * 0.75, 1e-12);
}
near("effective tax rate from the statements", effectiveTaxRate(1000, 210), 0.21);
near("effective tax rate is clamped at 40%", effectiveTaxRate(100, 90), 0.4);
near("effective tax rate floors at zero", effectiveTaxRate(100, -50), 0);
near("cost of debt from the interest bill", impliedCostOfDebt(50, 1000), 0.05);
near("cost of debt is clamped", impliedCostOfDebt(500, 1000), 0.2);

console.log("Scoring");
{
  // Altman Z on figures where every term is easy to check by hand.
  const bs = {
    "Total Assets": 1000, "Total Liabilities Net Minority Interest": 400,
    "Current Assets": 300, "Current Liabilities": 100, "Retained Earnings": 200,
  };
  const inc = { EBIT: 150, "Total Revenue": 900 };
  const expected = 1.2 * 0.2 + 1.4 * 0.2 + 3.3 * 0.15 + 0.6 * (2000 / 400) + 1.0 * 0.9;
  near("Altman Z", altmanZ(bs, inc, 2000), expected, 1e-9);
  eq("Altman Z declines to guess without a market cap", altmanZ(bs, inc, null), null);
  eq("Altman Z declines on a zero asset base", altmanZ({ ...bs, "Total Assets": 0 }, inc, 2000), null);
}
{
  // A company that passes all nine tests.
  const bs = { "Total Assets": 1000, "Long Term Debt": 50, "Current Assets": 400, "Current Liabilities": 100, "Share Issued": 90 };
  const bsPrev = { "Total Assets": 900, "Long Term Debt": 80, "Current Assets": 300, "Current Liabilities": 120, "Share Issued": 100 };
  const inc = { "Net Income": 120, "Gross Profit": 400, "Total Revenue": 900 };
  const incPrev = { "Net Income": 90, "Gross Profit": 300, "Total Revenue": 800 };
  const cf = { "Operating Cash Flow": 200 };
  const { score, tests } = piotroskiF(bs, inc, cf, bsPrev, incPrev);
  eq("Piotroski returns nine tests", tests.length, 9);
  eq("Piotroski scores a clean company nine", score, 9);
}
{
  // And one that fails everything it can.
  const bs = { "Total Assets": 1000, "Long Term Debt": 200, "Current Assets": 100, "Current Liabilities": 200, "Share Issued": 120 };
  const bsPrev = { "Total Assets": 800, "Long Term Debt": 100, "Current Assets": 200, "Current Liabilities": 100, "Share Issued": 100 };
  const inc = { "Net Income": -50, "Gross Profit": 100, "Total Revenue": 500 };
  const incPrev = { "Net Income": 100, "Gross Profit": 300, "Total Revenue": 700 };
  const cf = { "Operating Cash Flow": -80 };
  eq("Piotroski scores a failing company zero", piotroskiF(bs, inc, cf, bsPrev, incPrev).score, 0);
}

console.log("Scorecard scale");
near("scale maps the low anchor to zero", scale(0, 0, 8), 0);
near("scale maps the high anchor to a hundred", scale(8, 0, 8), 100);
near("scale is linear in between", scale(4, 0, 8), 50);
// Passing lo > hi expresses a lower-is-better metric.
near("scale inverts when lo exceeds hi", scale(10, 45, 10), 100);
near("scale clamps beyond the anchors", scale(99, 0, 8), 100);
eq("scale returns null for a gap", scale(null, 0, 8), null);

console.log("Portfolio returns");
{
  // 1000 out, 1100 back exactly a year later, is 10%.
  const r = xirr([
    { date: "2023-01-01", amount: -1000 },
    { date: "2024-01-01", amount: 1100 },
  ]);
  near("XIRR on a one-year round trip", r, 0.1, 1e-4);
}
eq("XIRR refuses same-signed flows", xirr([{ date: "2023-01-01", amount: -100 }, { date: "2024-01-01", amount: -50 }]), null);
{
  // Time-weighted return removes the contribution before measuring the day.
  // Day 1: 100 -> 110 is +10%. Day 2: 110 plus 50 in, ending 176, so the
  // assets went (176 - 50)/110 - 1 = +14.545%.
  const r = twrr([100, 110, 176], [0, 0, 50]);
  near("TWRR chains returns net of flows", r!, 1.1 * (126 / 110) - 1, 1e-9);
}
{
  const sim = simulatePosition(["2024-01-02", "2024-01-03", "2024-02-01"], [10, 11, 12], 1000, 500);
  eq("simulatePosition counts both contributions", sim!.totalInvested, 1500);
  // 100 shares at 10, then 500/12 more on the first day of the new month.
  near("simulatePosition values the position", sim!.value[2], (100 + 500 / 12) * 12, 1e-9);
}
near("effective positions of an equal-weight four", effectivePositions([0.25, 0.25, 0.25, 0.25]), 4, 1e-12);
near("effective positions of a concentrated book", effectivePositions([0.9, 0.1]), 1 / 0.82, 1e-12);

console.log("Risk");
near("normPpf at the median", normPpf(0.5), 0, 1e-9);
near("normPpf at the 5% tail", normPpf(0.05), -1.6448536, 1e-5);
near("normPpf scales with mean and sd", normPpf(0.05, 0.1, 2), 0.1 + 2 * -1.6448536, 1e-4);
{
  const closes = [100, 110, 99, 108];
  const rets = dailyReturns(closes);
  near("daily returns are period-on-period", rets[0], 0.1, 1e-12);
  near("daily returns handle a fall", rets[1], 99 / 110 - 1, 1e-12);
  const dd = drawdownSeries(closes);
  // The trough is 99 against a running peak of 110.
  near("drawdown measures against the running peak", Math.min(...dd), 99 / 110 - 1, 1e-12);
}
{
  const closes = Array.from({ length: 300 }, (_, i) => 100 * Math.exp(0.0003 * i));
  const r = riskStats(closes);
  ok("risk stats produce a volatility", typeof r?.vol === "number");
  ok("a monotonic series has no drawdown", Math.abs(r!.maxDrawdown!) < 1e-9, `got ${r!.maxDrawdown}`);
}
{
  // The same seed must reproduce the same simulation exactly.
  const a = simulatePaths(100, 0.0004, 0.012, 30, 400, 7);
  const b = simulatePaths(100, 0.0004, 0.012, 30, 400, 7);
  const c = simulatePaths(100, 0.0004, 0.012, 30, 400, 8);
  eq("a fixed seed is reproducible", a.p50, b.p50);
  ok("a different seed gives a different path", JSON.stringify(a.p50) !== JSON.stringify(c.p50));
  ok("percentile bands are ordered", a.p5.every((v, i) => v <= a.p25[i] && a.p25[i] <= a.p50[i] && a.p50[i] <= a.p75[i] && a.p75[i] <= a.p95[i]));
  eq("one terminal value per path", a.finals.length, 400);
}
{
  const m = correlationMatrix({ a: [1, 2, 3, 4], b: [2, 4, 6, 8], c: [4, 3, 2, 1] });
  near("a series correlates perfectly with itself", m.matrix[0][0], 1, 1e-9);
  near("a scaled copy correlates perfectly", m.matrix[0][1], 1, 1e-9);
  near("a mirrored series correlates negatively", m.matrix[0][2], -1, 1e-9);
}
{
  const h = histogram([1, 1, 2, 9], 4);
  eq("histogram bins sum to the sample", h.counts.reduce((a, b) => a + b, 0), 4);
}

console.log("Indicators");
eq("SMA is null before the window fills", sma([1, 2, 3, 4], 3)[1], null);
near("SMA over three periods", sma([1, 2, 3, 4], 3)[2]!, 2);
near("SMA rolls forward", sma([1, 2, 3, 4], 3)[3]!, 3);
{
  // With adjust=false the first EMA value is the first observation.
  const e = ema([10, 20], 3);
  near("EMA seeds on the first observation", e[0]!, 10);
  near("EMA weights by 2/(span+1)", e[1]!, 0.5 * 20 + 0.5 * 10, 1e-12);
}
{
  // Fourteen straight gains must pin RSI at 100 — there is no loss to divide by.
  const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
  const r = rsi(rising, 14);
  near("RSI of an unbroken advance", r[19]!, 100, 1e-9);
}
{
  const bars = Array.from({ length: 250 }, (_, i) => ({
    date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 100 + i, high: 102 + i, low: 99 + i, close: 100 + i, volume: 1000,
  }));
  const e = enrich(bars);
  ok("enrich produces a 200-day average once there is history", typeof e.sma200[249] === "number");
  ok("Bollinger bands straddle the mean", (e.bbUpper[249] as number) > (e.sma20[249] as number));
  // True range on a steady +1 per day series: high-low is 3, the gap to
  // yesterday's close is 2, so the range is 3.
  near("ATR reflects the true range", e.atr[249]!, 3, 1e-9);
}

console.log("Forecast");
{
  // A perfectly log-linear series must project its own continuation, with an
  // R-squared of one.
  const n = 120;
  const dates = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10));
  const closes = Array.from({ length: n }, (_, i) => 100 * Math.exp(0.001 * i));
  const f = buildForecast(dates, closes, 10);
  ok("forecast returns the requested horizon", f?.points.length === 10);
  near("a log-linear series is explained perfectly", f!.rSquared!, 1, 1e-9);
  near("the trend continues the series", f!.points[0].trend, 100 * Math.exp(0.001 * n), 1e-6);
  ok("the trend band brackets the trend", f!.points[9].trendLow <= f!.points[9].trend && f!.points[9].trend <= f!.points[9].trendHigh);
  ok("the random-walk band widens with the horizon",
    f!.points[9].rwHigh - f!.points[9].rwLow > f!.points[0].rwHigh - f!.points[0].rwLow);
}
{
  // One implausible day in an otherwise calm series is the outlier.
  const n = 100;
  const dates = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10));
  const closes = Array.from({ length: n }, (_, i) => 100 + (i % 2 === 0 ? 0.1 : -0.1));
  closes[60] = 130;
  const shocks = detectShocks(dates, closes, 2.5, 8);
  ok("the shock is detected", shocks.some((s) => s.date === dates[60]), JSON.stringify(shocks.map((s) => s.date)));
}

console.log("Statement frame");
{
  const q = {
    periods: ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31"],
    rows: { "Total Revenue": [10, 20, 30, 40, 50], Gap: [1, null, null, null, null] },
  };
  const ttm = ttmFromQuarters(q);
  eq("TTM keeps the latest quarter end", ttm.periods, ["2025-03-31"]);
  eq("TTM sums the last four quarters", ttm.rows["Total Revenue"], [140]);
  eq("TTM reports nothing where nothing was reported", ttm.rows.Gap, [null]);
}
{
  // Share counts must not be multiplied by an FX rate.
  const s = { periods: ["2024-12-31"], rows: { "Total Revenue": [100], "Share Issued": [50] } };
  const d = toDisplay(s, 2);
  eq("FX converts monetary lines", d.rows["Total Revenue"], [200]);
  eq("FX leaves share counts alone", d.rows["Share Issued"], [50]);
}
near("median of an odd sample", median([3, 1, 2])!, 2);
near("median of an even sample", median([4, 1, 2, 3])!, 2.5);
near("quantile interpolates", quantile([1, 2, 3, 4], 0.5)!, 2.5);
near("sample standard deviation", stdev([2, 4, 4, 4, 5, 5, 7, 9], 1)!, Math.sqrt(32 / 7), 1e-12);
eq("pctChange has no first value", pctChange([100, 110])[0], null);
near("pctChange is period-on-period", pctChange([100, 110])[1]!, 0.1, 1e-12);
eq("year labels use the fiscal year", yearLabels(["2024-09-28"]), ["FY2024"]);
eq("quarterly labels name the month", yearLabels(["2024-09-28"], "Quarterly"), ["Sep 2024"]);

console.log("Backup source mapping");
eq("a US symbol maps to Stooq", stooqSymbol("AAPL"), "aapl.us");
eq("a German symbol maps to Stooq", stooqSymbol("SAP.DE"), "sap.de");
eq("a class share keeps its separator", stooqSymbol("BRK-B"), "brk.b.us");
eq("Stooq declines a market it does not cover", stooqSymbol("VNM.VN"), null);

console.log("Markdown");
ok("bold renders", markdownToHtml("**x**").includes("<b>x</b>"));
ok("bullets render as a list", markdownToHtml("- one\n- two").includes("<li>one</li>"));
ok("markup in the source text is escaped", markdownToHtml("<script>alert(1)</script>").includes("&lt;script&gt;"));

console.log("");
if (failures) {
  console.error(`${failures} of ${checks} checks FAILED`);
  process.exit(1);
}
console.log(`All ${checks} checks passed.`);
