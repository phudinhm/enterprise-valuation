// Assembles the company snapshot every module renders from.
//
// `info` is not the raw quote response. Yahoo's quote endpoint is rate-limited
// per source address and regularly returns almost nothing on shared serverless
// infrastructure, while the chart and statement endpoints keep answering. So
// the raw response is topped up from the chart metadata and, when it is still
// threadbare, from the financial statements themselves. Anything filled in this
// way is recorded in `derived`, and the page says so rather than passing a
// computed figure off as reported.

import { isNum, safeDiv, pickNum } from "@/lib/format";
import { Notes, settle } from "@/lib/data/http";
import {
  fetchChart, fetchInfo, fetchStatements, metaToFastInfo, fetchRiskFreeRate, estimateBeta,
} from "@/lib/data/yahoo";
import { stooqWindow } from "@/lib/data/stooq";
import { fetchSecStatements } from "@/lib/data/sec";
import { EMPTY_STATEMENTS, isEmpty, last, prior, median, dropna, col } from "@/lib/data/frame";
import type { Statements } from "@/lib/data/frame";
import type { Company, Info, PriceBar } from "@/lib/data/types";
import { DATA_SOURCE } from "@/lib/constants";

// The metrics a healthy quote response carries. When most of them are absent
// the quote endpoint has effectively failed, and the app rebuilds them from the
// statements rather than showing a page of dashes.
export const QUOTE_METRICS = [
  "marketCap", "trailingPE", "returnOnEquity", "operatingMargins",
  "currentRatio", "totalRevenue", "freeCashflow", "ebitda",
  "sharesOutstanding", "bookValue", "trailingEps", "profitMargins",
] as const;

const FAST_INFO_MAP: [string, string][] = [
  ["currentPrice", "last_price"],
  ["previousClose", "previous_close"],
  ["marketCap", "market_cap"],
  ["sharesOutstanding", "shares"],
  ["fiftyTwoWeekHigh", "year_high"],
  ["fiftyTwoWeekLow", "year_low"],
  ["fiftyDayAverage", "fifty_day_average"],
  ["twoHundredDayAverage", "two_hundred_day_average"],
];

/** Statements from the primary source, falling back to the regulator's own
 *  filings when the primary returns nothing. */
async function loadStatements(
  ticker: string, quarterly: boolean, notes: Notes,
): Promise<Statements> {
  const primary = await settle(
    fetchStatements(ticker, quarterly),
    EMPTY_STATEMENTS,
    notes,
    `statements (${quarterly ? "quarterly" : "annual"})`,
  );
  if (!isEmpty(primary.inc) || !isEmpty(primary.bs) || !isEmpty(primary.cf)) {
    notes.source("financial statements", DATA_SOURCE);
    return primary;
  }
  const backup = await settle(
    fetchSecStatements(ticker, quarterly), EMPTY_STATEMENTS, notes, "SEC company facts",
  );
  if (!isEmpty(backup.inc) || !isEmpty(backup.bs) || !isEmpty(backup.cf)) {
    notes.source("financial statements", "SEC EDGAR (XBRL company facts)");
    return backup;
  }
  return primary;
}

/** Price history from the primary source, falling back to Stooq. Intraday
 *  intervals have no equivalent on the daily-only backup, so the fallback only
 *  rescues daily-and-longer requests — which is all of them except the shortest
 *  chart period. */
export async function loadHistory(
  ticker: string, period: string, interval: string, notes: Notes,
): Promise<{ bars: PriceBar[]; meta: Record<string, unknown>; source: string }> {
  const primary = await settle(
    fetchChart(ticker, period, interval),
    { bars: [] as PriceBar[], meta: {} as Record<string, unknown> },
    notes,
    "price history",
  );
  if (primary.bars.length) {
    notes.source("price history", DATA_SOURCE);
    return { ...primary, source: DATA_SOURCE };
  }
  if (["1d", "1wk", "1mo"].includes(interval)) {
    const backup = await settle(stooqWindow(ticker, period), [] as PriceBar[], notes, "Stooq history");
    if (backup.length) {
      notes.source("price history", "Stooq");
      return { bars: backup, meta: {}, source: "Stooq" };
    }
  }
  return { ...primary, source: DATA_SOURCE };
}

/** Recomputes the headline metrics from the reported statements.
 *
 *  Every value written here is the textbook definition applied to the company's
 *  own filings, so it is a reconstruction of the same number the quote endpoint
 *  would have returned — not an estimate of something else. */
async function rebuildFromStatements(
  ticker: string, merged: Info, annual: Statements, price: number | null, derived: Set<string>,
): Promise<Info> {
  const { inc, bs, cf } = annual;
  const put = (key: string, value: number | null | undefined) => {
    if (isNum(value) && !isNum(merged[key])) {
      merged[key] = value;
      derived.add(key);
    }
  };

  let shares = pickNum(merged, "sharesOutstanding");
  if (!isNum(shares)) {
    shares =
      last(bs, "Ordinary Shares Number", "Share Issued") ??
      last(inc, "Diluted Average Shares", "Basic Average Shares");
    put("sharesOutstanding", shares);
  }
  let mcap = pickNum(merged, "marketCap");
  if (!isNum(mcap) && isNum(price) && isNum(shares)) {
    mcap = price * shares;
    put("marketCap", mcap);
  }

  const revenue = last(inc, "Total Revenue");
  const netIncome = last(inc, "Net Income");
  const gross = last(inc, "Gross Profit");
  const opIncome = last(inc, "Operating Income", "EBIT");
  let ebitda = last(inc, "EBITDA");
  const dAndA = last(cf, "Depreciation And Amortization");
  if (!isNum(ebitda) && isNum(opIncome)) ebitda = opIncome + (isNum(dAndA) ? dAndA : 0);

  const equity = last(bs, "Stockholders Equity");
  const assets = last(bs, "Total Assets");
  let debt = last(bs, "Total Debt");
  if (!isNum(debt)) {
    const lt = last(bs, "Long Term Debt");
    const st = last(bs, "Current Debt");
    const total = (isNum(lt) ? lt : 0) + (isNum(st) ? st : 0);
    debt = total || null;
  }
  const cash = last(bs, "Cash And Cash Equivalents");
  const curAssets = last(bs, "Current Assets");
  const curLiab = last(bs, "Current Liabilities");

  let eps = last(inc, "Diluted EPS", "Basic EPS");
  if (!isNum(eps) && isNum(netIncome) && isNum(shares) && shares) eps = netIncome / shares;

  let fcf = last(cf, "Free Cash Flow");
  if (!isNum(fcf)) {
    const ocf = last(cf, "Operating Cash Flow");
    const capex = last(cf, "Capital Expenditure");
    if (isNum(ocf)) fcf = ocf + (isNum(capex) ? capex : 0);
  }

  put("totalRevenue", revenue);
  put("ebitda", ebitda);
  put("totalDebt", debt);
  put("totalCash", cash);
  put("freeCashflow", fcf);
  put("trailingEps", eps);
  put("grossMargins", safeDiv(gross, revenue));
  put("operatingMargins", safeDiv(opIncome, revenue));
  put("profitMargins", safeDiv(netIncome, revenue));
  put("returnOnEquity", safeDiv(netIncome, equity));
  put("returnOnAssets", safeDiv(netIncome, assets));
  put("currentRatio", safeDiv(curAssets, curLiab));
  put("bookValue", safeDiv(equity, shares));

  const de = safeDiv(debt, equity);
  put("debtToEquity", de === null ? null : de * 100); // reported as a percentage
  put("trailingPE", isNum(eps) && eps > 0 ? safeDiv(price, eps) : null);
  put("priceToBook", safeDiv(price, safeDiv(equity, shares)));
  put("priceToSalesTrailing12Months", safeDiv(mcap, revenue));

  if (isNum(mcap)) {
    const ev = mcap + (isNum(debt) ? debt : 0) - (isNum(cash) ? cash : 0);
    put("enterpriseValue", ev);
    put("enterpriseToEbitda", safeDiv(ev, ebitda));
    put("enterpriseToRevenue", safeDiv(ev, revenue));
  }

  const prevRev = prior(inc, "Total Revenue");
  const prevNi = prior(inc, "Net Income");
  if (isNum(prevRev) && prevRev > 0 && isNum(revenue)) put("revenueGrowth", revenue / prevRev - 1);
  if (isNum(prevNi) && prevNi > 0 && isNum(netIncome)) put("earningsGrowth", netIncome / prevNi - 1);

  if (!isNum(merged.beta)) put("beta", await estimateBeta(ticker));

  return merged;
}

/** Latest reported free cash flow, falling back to operating cash flow less
 *  capex, then to the quote snapshot. */
function baseFreeCashFlow(cf: Statements["cf"], info: Info): number | null {
  const fcf = last(cf, "Free Cash Flow");
  if (isNum(fcf)) return fcf;
  const ocf = last(cf, "Operating Cash Flow");
  const capex = last(cf, "Capital Expenditure");
  if (isNum(ocf)) return ocf + (isNum(capex) ? capex : 0);
  return pickNum(info, "freeCashflow");
}

/** Median free cash flow across reported years — a steadier DCF anchor than a
 *  single year that may be a peak or a trough. */
function normalisedFreeCashFlow(cf: Statements["cf"], fallback: number | null): number | null {
  const direct = dropna(col(cf, "Free Cash Flow"));
  if (direct.length) return median(direct);
  const ocf = col(cf, "Operating Cash Flow");
  const capex = col(cf, "Capital Expenditure");
  if (ocf) {
    const derived = ocf
      .map((v, i) => (isNum(v) ? v + (isNum(capex?.[i]) ? (capex![i] as number) : 0) : null))
      .filter(isNum) as number[];
    if (derived.length) return median(derived);
  }
  return fallback;
}

export interface LoadCompanyResult {
  company: Company | null;
  reason?: string;
}

export async function loadCompany(ticker: string): Promise<LoadCompanyResult> {
  const symbol = (ticker || "").toUpperCase().trim();
  if (!symbol) return { company: null, reason: "no symbol" };

  const notes = new Notes();

  // Everything the page needs, fetched concurrently: the sequential version was
  // four round trips deep before the first pixel.
  const [rawInfo, chart, annual, quarterly, dividendChart, riskFree] = await Promise.all([
    settle(fetchInfo(symbol), {} as Info, notes, "quote endpoint"),
    settle(
      fetchChart(symbol, "5d", "1d"),
      { bars: [] as PriceBar[], meta: {} as Record<string, unknown> },
      notes,
      "chart metadata",
    ),
    loadStatements(symbol, false, notes),
    loadStatements(symbol, true, notes),
    settle(
      fetchChart(symbol, "5y", "1d", 3600),
      { bars: [] as PriceBar[], meta: {} as Record<string, unknown> },
      notes,
      "dividend history",
    ),
    fetchRiskFreeRate(notes),
  ]);

  const fast = metaToFastInfo(chart.meta);
  const derived = new Set<string>();
  const merged: Info = { ...rawInfo };

  for (const [key, fastKey] of FAST_INFO_MAP) {
    if (!isNum(merged[key]) && isNum(fast[fastKey])) {
      merged[key] = fast[fastKey];
      derived.add(key);
    }
  }
  if (!merged.currency && fast.currency) merged.currency = fast.currency;
  if (!merged.exchange && fast.exchange) merged.exchange = fast.exchange;
  if (!merged.shortName && fast.shortName) merged.shortName = fast.shortName;
  if (!merged.longName && fast.longName) merged.longName = fast.longName;

  // Price without touching the rebuilt snapshot, so the rebuild below can use
  // it without recursing into the thing it is building.
  let price = pickNum(merged, "currentPrice", "regularMarketPrice", "previousClose");
  if (!isNum(price)) {
    const closes = chart.bars.map((b) => b.close).filter(isNum) as number[];
    price = closes.length ? closes[closes.length - 1] : null;
  }
  if (!isNum(price)) {
    const backup = await settle(stooqWindow(symbol, "1mo"), [] as PriceBar[], notes, "Stooq price");
    const closes = backup.map((b) => b.close).filter(isNum) as number[];
    if (closes.length) {
      price = closes[closes.length - 1];
      notes.source("price", "Stooq");
    }
  }

  const quoteFields = QUOTE_METRICS.filter((k) => isNum(merged[k])).length;
  if (quoteFields < 6) {
    await rebuildFromStatements(symbol, merged, annual, price, derived);
  }

  if (!isNum(price) && isNum(merged.currentPrice)) price = merged.currentPrice as number;
  if (!isNum(price) || !Object.keys(merged).length) {
    return { company: null, reason: "no usable data" };
  }

  const shares = pickNum(merged, "sharesOutstanding", "impliedSharesOutstanding");
  const marketCapRaw = pickNum(merged, "marketCap");
  const marketCap =
    isNum(marketCapRaw) && marketCapRaw > 0
      ? marketCapRaw
      : isNum(price) && isNum(shares)
        ? price * shares
        : null;

  // Net debt is always a real number. Every branch is filtered through isNum
  // because a NaN out of a sparse balance sheet is truthy in JS the same way it
  // was in Python: `nan || 0` yields nan, and every comparison against it then
  // quietly evaluates false.
  const debtInfo = pickNum(merged, "totalDebt");
  const cashInfo = pickNum(merged, "totalCash");
  let netDebt: number;
  if (isNum(debtInfo) || isNum(cashInfo)) {
    netDebt = (isNum(debtInfo) ? debtInfo : 0) - (isNum(cashInfo) ? cashInfo : 0);
  } else {
    const d = last(annual.bs, "Total Debt");
    const c = last(annual.bs, "Cash And Cash Equivalents");
    netDebt = (isNum(d) ? d : 0) - (isNum(c) ? c : 0);
  }

  const baseFcf = baseFreeCashFlow(annual.cf, merged);

  const company: Company = {
    ticker: symbol,
    name: (merged.longName as string) || (merged.shortName as string) || symbol,
    currency: (merged.currency as string) || "USD",
    sector: (merged.sector as string) || "—",
    industry: (merged.industry as string) || "—",
    exchange: (merged.exchange as string) || "—",
    info: merged,
    derived: [...derived].sort(),
    quoteFields,
    quoteMetricCount: QUOTE_METRICS.length,
    annual,
    quarterly,
    price,
    previousClose: pickNum(merged, "previousClose", "regularMarketPreviousClose") ?? price,
    shares: isNum(shares) && shares > 0 ? shares : null,
    marketCap,
    netDebt,
    baseFcf,
    normalisedFcf: normalisedFreeCashFlow(annual.cf, baseFcf),
    dividendHistory: dividendChart.bars
      .filter((b) => isNum(b.dividend) && (b.dividend as number) > 0)
      .map((b) => ({ date: b.date, amount: b.dividend as number })),
    sources: notes.sources,
    errors: notes.list(),
    riskFreeRate: riskFree,
  };

  return { company };
}
