// The primary source. `yfinance` is a wrapper over these same endpoints, so
// this speaks to them directly: the chart API for prices, the fundamentals
// timeseries for statements, quoteSummary for the profile snapshot, and the
// search API for symbol resolution.
//
// Two of those need a cookie and a crumb that expire. The session below
// negotiates them once per runtime and re-negotiates on the first 401/403,
// which is exactly what the Python library does behind `.info`.

import { getJson, getText, retry, UA, type Notes } from "@/lib/data/http";
import { isNum } from "@/lib/format";
import type { Statement, Statements } from "@/lib/data/frame";
import { EMPTY_STATEMENT } from "@/lib/data/frame";
import type { Info, PriceBar, SearchHit, NewsItem } from "@/lib/data/types";

const QUERY1 = "https://query1.finance.yahoo.com";
const QUERY2 = "https://query2.finance.yahoo.com";

// --- session (cookie + crumb) ------------------------------------------------

interface Session {
  cookie: string;
  crumb: string;
  obtainedAt: number;
}

let session: Session | null = null;
let inFlight: Promise<Session | null> | null = null;

const SESSION_TTL_MS = 30 * 60 * 1000;

async function negotiate(): Promise<Session | null> {
  try {
    // fc.yahoo.com answers 404/401 but sets the consent cookie the crumb
    // endpoint requires; the status is deliberately not checked.
    const seed = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": UA },
      cache: "no-store",
      redirect: "follow",
    }).catch(() => null);

    const raw = seed?.headers.get("set-cookie") ?? "";
    const cookie = raw
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
    if (!cookie) return null;

    const crumb = (
      await getText(`${QUERY1}/v1/test/getcrumb`, { headers: { Cookie: cookie }, timeoutMs: 8000 })
    ).trim();
    if (!crumb || crumb.length > 32 || crumb.includes("<")) return null;

    return { cookie, crumb, obtainedAt: Date.now() };
  } catch {
    return null;
  }
}

async function getSession(force = false): Promise<Session | null> {
  if (!force && session && Date.now() - session.obtainedAt < SESSION_TTL_MS) return session;
  if (!inFlight) {
    inFlight = negotiate().then((s) => {
      session = s;
      inFlight = null;
      return s;
    });
  }
  return inFlight;
}

/** GET against a crumb-protected endpoint, re-negotiating once on rejection. */
async function getAuthed<T>(build: (crumb: string) => string, revalidate: number): Promise<T> {
  for (const force of [false, true]) {
    const s = await getSession(force);
    const url = build(s?.crumb ?? "");
    try {
      return await getJson<T>(url, {
        headers: s ? { Cookie: s.cookie } : {},
        revalidate,
      });
    } catch (err) {
      const msg = String(err);
      // Only a credential rejection is worth a second attempt; a 404 means the
      // symbol does not exist and retrying just costs a round trip.
      if (!/HTTP 40[13]/.test(msg) || force) throw err;
    }
  }
  throw new Error("unreachable");
}

// --- price history -----------------------------------------------------------

interface ChartResponse {
  chart?: {
    result?: {
      meta?: Record<string, unknown>;
      timestamp?: number[];
      indicators?: {
        quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[];
        adjclose?: { adjclose?: (number | null)[] }[];
      };
      events?: { dividends?: Record<string, { amount?: number; date?: number }> };
    }[];
    error?: { description?: string } | null;
  };
}

function toIsoDay(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function toIsoMinute(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ");
}

export interface ChartData {
  bars: PriceBar[];
  meta: Record<string, unknown>;
}

/** Daily-or-longer history is returned split- and dividend-adjusted, matching
 *  `auto_adjust=True` in the Python version, so the simulator's returns are
 *  total returns rather than price returns. */
export async function fetchChart(
  ticker: string, range: string, interval: string, revalidate = 900,
): Promise<ChartData> {
  const params = new URLSearchParams({
    range,
    interval,
    includePrePost: "false",
    events: "div,split",
  });
  const url = `${QUERY1}/v8/finance/chart/${encodeURIComponent(ticker)}?${params}`;
  const data = await retry(() => getJson<ChartResponse>(url, { revalidate }));
  const result = data.chart?.result?.[0];
  if (!result?.timestamp?.length) return { bars: [], meta: result?.meta ?? {} };

  const quote = result.indicators?.quote?.[0] ?? {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const intraday = /m|h/.test(interval) && !interval.endsWith("mo");

  const dividends: Record<string, number> = {};
  for (const d of Object.values(result.events?.dividends ?? {})) {
    if (isNum(d?.date) && isNum(d?.amount)) dividends[toIsoDay(d.date)] = d.amount;
  }

  const bars: PriceBar[] = [];
  result.timestamp.forEach((ts, i) => {
    const close = quote.close?.[i] ?? null;
    if (!isNum(close)) return;
    // Apply the adjusted-close ratio across the whole bar so highs, lows and
    // opens stay consistent with the close a chart is drawn from.
    const adjClose = adj?.[i];
    const factor = isNum(adjClose) && close ? adjClose / close : 1;
    const date = intraday ? toIsoMinute(ts) : toIsoDay(ts);
    bars.push({
      date,
      open: isNum(quote.open?.[i]) ? (quote.open![i] as number) * factor : null,
      high: isNum(quote.high?.[i]) ? (quote.high![i] as number) * factor : null,
      low: isNum(quote.low?.[i]) ? (quote.low![i] as number) * factor : null,
      close: close * factor,
      volume: isNum(quote.volume?.[i]) ? (quote.volume![i] as number) : null,
      dividend: dividends[date.slice(0, 10)],
    });
  });

  return { bars, meta: result.meta ?? {} };
}

/** The lightweight quote fields the chart endpoint carries in its metadata.
 *  This is the equivalent of `fast_info`: it answers even when the heavier
 *  quote endpoint is rate-limited. */
export function metaToFastInfo(meta: Record<string, unknown>): Info {
  const n = (k: string) => (isNum(meta[k]) ? (meta[k] as number) : null);
  return {
    last_price: n("regularMarketPrice"),
    previous_close: n("chartPreviousClose") ?? n("previousClose"),
    year_high: n("fiftyTwoWeekHigh"),
    year_low: n("fiftyTwoWeekLow"),
    fifty_day_average: n("fiftyDayAverage"),
    two_hundred_day_average: n("twoHundredDayAverage"),
    market_cap: n("marketCap"),
    shares: n("sharesOutstanding"),
    currency: typeof meta["currency"] === "string" ? meta["currency"] : null,
    exchange: typeof meta["fullExchangeName"] === "string" ? meta["fullExchangeName"] : meta["exchangeName"] ?? null,
    shortName: typeof meta["shortName"] === "string" ? meta["shortName"] : null,
    longName: typeof meta["longName"] === "string" ? meta["longName"] : null,
  };
}

// --- profile snapshot --------------------------------------------------------

const SUMMARY_MODULES = [
  "price",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "assetProfile",
  "summaryProfile",
  "calendarEvents",
].join(",");

interface QuoteSummaryResponse {
  quoteSummary?: { result?: Record<string, unknown>[]; error?: unknown };
}

/** Yahoo wraps most numbers as `{ raw, fmt }`; unwrap to the raw value so the
 *  rest of the app never has to know. */
function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if ("raw" in obj) return obj.raw;
  }
  return value;
}

function flattenSummary(modules: Record<string, unknown>): Info {
  const out: Info = {};
  for (const section of Object.values(modules)) {
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;
    for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
      const v = unwrap(value);
      if (v === null || v === undefined) continue;
      if (typeof v === "object" && !Array.isArray(v)) continue;
      // The first module to report a field wins, matching the order above:
      // price and summaryDetail are the most reliable.
      if (!(key in out)) out[key] = v;
    }
  }
  return out;
}

export async function fetchInfo(ticker: string, revalidate = 900): Promise<Info> {
  const data = await getAuthed<QuoteSummaryResponse>(
    (crumb) =>
      `${QUERY2}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${SUMMARY_MODULES}` +
      (crumb ? `&crumb=${encodeURIComponent(crumb)}` : ""),
    revalidate,
  );
  const result = data.quoteSummary?.result?.[0];
  if (!result) return {};
  const info = flattenSummary(result);

  // `price` reports the live figure under a different name than the rest of the
  // app expects; normalise it once here rather than at every call site.
  if (!isNum(info.currentPrice) && isNum(info.regularMarketPrice)) {
    info.currentPrice = info.regularMarketPrice;
  }
  return info;
}

// --- financial statements ----------------------------------------------------

// Yahoo's timeseries keys, mapped onto the line-item names the rest of the app
// uses. Keeping the map explicit means a statement rebuilt from any source is
// indistinguishable downstream.
const INCOME_KEYS: [string, string][] = [
  ["TotalRevenue", "Total Revenue"],
  ["CostOfRevenue", "Cost Of Revenue"],
  ["GrossProfit", "Gross Profit"],
  ["OperatingExpense", "Operating Expense"],
  ["ResearchAndDevelopment", "Research And Development"],
  ["SellingGeneralAndAdministration", "Selling General And Administration"],
  ["OperatingIncome", "Operating Income"],
  ["NetNonOperatingInterestIncomeExpense", "Net Non Operating Interest Income Expense"],
  ["InterestExpense", "Interest Expense"],
  ["OtherIncomeExpense", "Other Income Expense"],
  ["PretaxIncome", "Pretax Income"],
  ["TaxProvision", "Tax Provision"],
  ["NetIncome", "Net Income"],
  ["NetIncomeCommonStockholders", "Net Income Common Stockholders"],
  ["BasicEPS", "Basic EPS"],
  ["DilutedEPS", "Diluted EPS"],
  ["BasicAverageShares", "Basic Average Shares"],
  ["DilutedAverageShares", "Diluted Average Shares"],
  ["EBIT", "EBIT"],
  ["EBITDA", "EBITDA"],
  ["NormalizedEBITDA", "Normalized EBITDA"],
  ["TaxRateForCalcs", "Tax Rate For Calcs"],
];

const BALANCE_KEYS: [string, string][] = [
  ["CashAndCashEquivalents", "Cash And Cash Equivalents"],
  ["OtherShortTermInvestments", "Other Short Term Investments"],
  ["AccountsReceivable", "Accounts Receivable"],
  ["Inventory", "Inventory"],
  ["CurrentAssets", "Current Assets"],
  ["NetPPE", "Net PPE"],
  ["Goodwill", "Goodwill"],
  ["OtherIntangibleAssets", "Other Intangible Assets"],
  ["TotalNonCurrentAssets", "Total Non Current Assets"],
  ["TotalAssets", "Total Assets"],
  ["AccountsPayable", "Accounts Payable"],
  ["CurrentDebt", "Current Debt"],
  ["CurrentLiabilities", "Current Liabilities"],
  ["LongTermDebt", "Long Term Debt"],
  ["TotalNonCurrentLiabilitiesNetMinorityInterest", "Total Non Current Liabilities"],
  ["TotalLiabilitiesNetMinorityInterest", "Total Liabilities Net Minority Interest"],
  ["CommonStock", "Common Stock"],
  ["RetainedEarnings", "Retained Earnings"],
  ["StockholdersEquity", "Stockholders Equity"],
  ["TotalDebt", "Total Debt"],
  ["NetDebt", "Net Debt"],
  ["ShareIssued", "Share Issued"],
  ["OrdinarySharesNumber", "Ordinary Shares Number"],
  ["TreasurySharesNumber", "Treasury Shares Number"],
  ["WorkingCapital", "Working Capital"],
  ["InvestedCapital", "Invested Capital"],
  ["TangibleBookValue", "Tangible Book Value"],
];

const CASHFLOW_KEYS: [string, string][] = [
  ["OperatingCashFlow", "Operating Cash Flow"],
  ["InvestingCashFlow", "Investing Cash Flow"],
  ["FinancingCashFlow", "Financing Cash Flow"],
  ["FreeCashFlow", "Free Cash Flow"],
  ["CapitalExpenditure", "Capital Expenditure"],
  ["DepreciationAndAmortization", "Depreciation And Amortization"],
  ["StockBasedCompensation", "Stock Based Compensation"],
  ["ChangeInWorkingCapital", "Change In Working Capital"],
  ["NetIncomeFromContinuingOperations", "Net Income From Continuing Operations"],
  ["CashDividendsPaid", "Cash Dividends Paid"],
  ["RepurchaseOfCapitalStock", "Repurchase Of Capital Stock"],
  ["NetIssuancePaymentsOfDebt", "Net Issuance Payments Of Debt"],
  ["PurchaseOfBusiness", "Purchase Of Business"],
  ["NetInvestmentPurchaseAndSale", "Net Investment Purchase And Sale"],
  ["BeginningCashPosition", "Beginning Cash Position"],
  ["EndCashPosition", "End Cash Position"],
];

interface TimeseriesEntry {
  meta?: { type?: string[] };
  timestamp?: number[];
  [key: string]: unknown;
}

interface TimeseriesResponse {
  timeseries?: { result?: TimeseriesEntry[] };
}

/** Builds one statement from the timeseries payload: a sparse map of
 *  period -> value per line, collapsed onto a shared, ascending period axis. */
function buildStatement(
  results: TimeseriesEntry[],
  keys: [string, string][],
  prefix: string,
): Statement {
  const byLine = new Map<string, Map<string, number>>();
  const periodSet = new Set<string>();

  for (const entry of results) {
    const type = entry?.meta?.type?.[0];
    if (!type) continue;
    const mapping = keys.find(([k]) => `${prefix}${k}` === type);
    if (!mapping) continue;
    const rows = entry[type];
    if (!Array.isArray(rows)) continue;

    const line = byLine.get(mapping[1]) ?? new Map<string, number>();
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as { asOfDate?: string; reportedValue?: { raw?: number } | number };
      const asOf = r.asOfDate;
      const rawValue = typeof r.reportedValue === "object" ? r.reportedValue?.raw : r.reportedValue;
      if (!asOf || !isNum(rawValue)) continue;
      line.set(asOf, rawValue);
      periodSet.add(asOf);
    }
    byLine.set(mapping[1], line);
  }

  const periods = [...periodSet].sort();
  if (!periods.length) return EMPTY_STATEMENT;

  const rows: Record<string, (number | null)[]> = {};
  for (const [name, values] of byLine) {
    const series = periods.map((p) => values.get(p) ?? null);
    if (series.some(isNum)) rows[name] = series;
  }
  return Object.keys(rows).length ? { periods, rows } : EMPTY_STATEMENT;
}

/** Derive the lines Yahoo sometimes omits but that every module expects. */
export function completeStatements(s: Statements): Statements {
  const { inc, cf } = s;

  if (inc.periods.length) {
    if (!inc.rows["Gross Profit"] && inc.rows["Total Revenue"] && inc.rows["Cost Of Revenue"]) {
      inc.rows["Gross Profit"] = inc.periods.map((_, i) => {
        const r = inc.rows["Total Revenue"][i];
        const c = inc.rows["Cost Of Revenue"][i];
        return isNum(r) && isNum(c) ? r - c : null;
      });
    }
    if (!inc.rows["EBITDA"] && inc.rows["Normalized EBITDA"]) {
      inc.rows["EBITDA"] = inc.rows["Normalized EBITDA"];
    }
  }

  if (cf.periods.length && !cf.rows["Free Cash Flow"] && cf.rows["Operating Cash Flow"]) {
    // Capital expenditure is reported as a negative outflow, so free cash flow
    // is an addition rather than a subtraction.
    cf.rows["Free Cash Flow"] = cf.periods.map((_, i) => {
      const o = cf.rows["Operating Cash Flow"][i];
      const c = cf.rows["Capital Expenditure"]?.[i];
      return isNum(o) ? o + (isNum(c) ? c : 0) : null;
    });
  }

  return s;
}

export async function fetchStatements(
  ticker: string, quarterly = false, revalidate = 3600,
): Promise<Statements> {
  const prefix = quarterly ? "quarterly" : "annual";
  const allKeys = [...INCOME_KEYS, ...BALANCE_KEYS, ...CASHFLOW_KEYS].map(([k]) => `${prefix}${k}`);
  const period2 = Math.floor(Date.now() / 1000);
  // 1970 as the lower bound: Yahoo returns whatever history it holds, and the
  // app trims rather than the request.
  const params = new URLSearchParams({
    symbol: ticker,
    type: allKeys.join(","),
    period1: "493590046",
    period2: String(period2),
  });

  const data = await getAuthed<TimeseriesResponse>(
    (crumb) =>
      `${QUERY2}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}?${params}` +
      (crumb ? `&crumb=${encodeURIComponent(crumb)}` : ""),
    revalidate,
  );

  const results = data.timeseries?.result ?? [];
  return completeStatements({
    inc: buildStatement(results, INCOME_KEYS, prefix),
    bs: buildStatement(results, BALANCE_KEYS, prefix),
    cf: buildStatement(results, CASHFLOW_KEYS, prefix),
  });
}

// --- search ------------------------------------------------------------------

const ACCEPTED_QUOTE_TYPES = new Set(["EQUITY", "ETF", "INDEX", "MUTUALFUND"]);

function normHit(symbol: unknown, name: unknown, exchange: unknown, qtype: unknown): SearchHit | null {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return null;
  return {
    symbol: sym,
    name: String(name ?? sym).trim(),
    exchange: String(exchange ?? "").trim(),
    type: String(qtype ?? "").toUpperCase(),
  };
}

interface SearchResponse {
  quotes?: Record<string, unknown>[];
}

/** Yahoo's search route. Tried on both hosts because they are rate-limited
 *  independently — one throttled endpoint must not make a real company look
 *  nonexistent. */
export async function searchYahoo(query: string, maxResults = 12): Promise<SearchHit[]> {
  const params = new URLSearchParams({
    q: query,
    quotesCount: String(maxResults),
    newsCount: "0",
    listsCount: "0",
    enableFuzzyQuery: "true",
  });
  for (const host of [QUERY2, QUERY1]) {
    try {
      const data = await getJson<SearchResponse>(`${host}/v1/finance/search?${params}`, {
        revalidate: 1800,
        timeoutMs: 8000,
      });
      const hits = (data.quotes ?? [])
        .map((q) =>
          normHit(q.symbol, q.shortname ?? q.longname, q.exchange ?? q.exchDisp, q.quoteType),
        )
        .filter((h): h is SearchHit => Boolean(h) && (!h!.type || ACCEPTED_QUOTE_TYPES.has(h!.type)));
      if (hits.length) return hits;
    } catch {
      // Fall through to the next host.
    }
  }
  return [];
}

/** Last resort: treat the query as a symbol and check it against every market
 *  suffix at once. This is what rescues a search when Yahoo's search routes are
 *  throttled but the price route still answers. */
export async function probeAsSymbol(query: string, suffixes: string[]): Promise<SearchHit[]> {
  const base = query.trim().toUpperCase().replace(/\s+/g, "");
  if (!(base.length > 1 && base.length <= 12) || !/^[A-Z0-9.\-]+$/.test(base)) return [];
  const candidates = base.includes(".")
    ? [base]
    : [base, ...suffixes.map((s) => `${base}${s}`)];

  const { parallelMap } = await import("@/lib/data/http");
  const checked = await parallelMap(
    candidates.slice(0, 14),
    async (sym) => {
      try {
        const { bars, meta } = await fetchChart(sym, "5d", "1d", 1800);
        if (!bars.length) return null;
        const name = typeof meta.shortName === "string" ? meta.shortName : sym;
        const venue = typeof meta.fullExchangeName === "string" ? meta.fullExchangeName : "";
        return normHit(sym, name, venue, "EQUITY");
      } catch {
        return null;
      }
    },
    8,
  );
  return checked.filter((h): h is SearchHit => Boolean(h));
}

// --- ETF holdings ------------------------------------------------------------

interface HoldingsResponse {
  quoteSummary?: { result?: { topHoldings?: { holdings?: { symbol?: string }[] } }[] };
}

/** A sector SPDR ETF is market-cap weighted, so its top holdings *are* that
 *  sector's current leaders — and they rotate automatically as the market does,
 *  which a hardcoded peer list never would. */
export async function fetchTopHoldings(etf: string, maxN = 15): Promise<string[]> {
  try {
    const data = await getAuthed<HoldingsResponse>(
      (crumb) =>
        `${QUERY2}/v10/finance/quoteSummary/${encodeURIComponent(etf)}?modules=topHoldings` +
        (crumb ? `&crumb=${encodeURIComponent(crumb)}` : ""),
      3600,
    );
    const holdings = data.quoteSummary?.result?.[0]?.topHoldings?.holdings ?? [];
    return holdings
      .map((h) => String(h.symbol ?? "").toUpperCase())
      .filter(Boolean)
      .slice(0, maxN);
  } catch {
    return [];
  }
}

// --- news --------------------------------------------------------------------

interface NewsResponse {
  news?: Record<string, unknown>[];
}

/** The news payload has changed shape across Yahoo revisions — some entries are
 *  flat, newer ones nest the article under `content` with different field
 *  names. Both shapes are handled so this does not silently break. */
function parseNewsItem(n: Record<string, unknown>): NewsItem | null {
  const content = (n.content && typeof n.content === "object" ? n.content : n) as Record<string, unknown>;
  const title = (content.title ?? n.title) as string | undefined;
  if (!title) return null;

  const provider = content.provider as { displayName?: string } | undefined;
  const publisher =
    provider?.displayName ?? (content.publisher as string) ?? (n.publisher as string) ?? "Unknown source";

  const click = content.clickThroughUrl as { url?: string } | undefined;
  const canonical = content.canonicalUrl as { url?: string } | undefined;
  const link = click?.url ?? canonical?.url ?? (content.link as string) ?? (n.link as string) ?? "";

  const ts = content.pubDate ?? n.providerPublishTime;
  let time: number | null = null;
  if (isNum(ts)) time = ts > 1e11 ? ts : ts * 1000;
  else if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    time = Number.isNaN(parsed) ? null : parsed;
  }

  return { title, publisher, link, time };
}

export async function fetchNews(ticker: string, maxItems = 6): Promise<NewsItem[]> {
  const params = new URLSearchParams({
    q: ticker,
    quotesCount: "0",
    newsCount: String(maxItems),
    listsCount: "0",
  });
  for (const host of [QUERY2, QUERY1]) {
    try {
      const data = await getJson<NewsResponse>(`${host}/v1/finance/search?${params}`, {
        revalidate: 900,
        timeoutMs: 8000,
      });
      const items = (data.news ?? [])
        .map(parseNewsItem)
        .filter((n): n is NewsItem => Boolean(n))
        .slice(0, maxItems);
      if (items.length) return items;
    } catch {
      // Try the other host.
    }
  }
  return [];
}

// --- rates and FX ------------------------------------------------------------

/** US 10-year yield, used as the CAPM risk-free rate. Falls back to a
 *  documented constant so the DCF never dies on a network hiccup. */
export async function fetchRiskFreeRate(notes?: Notes): Promise<number> {
  try {
    const { bars } = await fetchChart("%5ETNX", "5d", "1d", 1800);
    const closes = bars.map((b) => b.close).filter(isNum) as number[];
    if (closes.length) {
      const v = closes[closes.length - 1] / 100;
      if (v > 0 && v < 0.25) return v;
    }
  } catch (err) {
    notes?.error("risk-free rate", err);
  }
  return 0.042;
}

const MAJORS = new Set(["EUR", "GBP", "AUD", "NZD"]);
const PENCE = new Set(["GBp", "GBX"]);

async function usdPerUnit(curr: string): Promise<number | null> {
  if (curr === "USD") return 1;
  // Yahoo quotes EUR/GBP/AUD/NZD as "{CUR}USD=X" (base currency first) but
  // almost everything else as "USD{CUR}=X". Mixing these up silently produces
  // an inverted rate, so both orderings are tried in the right order.
  const attempts: [string, boolean][] = MAJORS.has(curr)
    ? [[`${curr}USD=X`, false], [`USD${curr}=X`, true]]
    : [[`USD${curr}=X`, true], [`${curr}USD=X`, false]];

  for (const [symbol, invert] of attempts) {
    try {
      const { bars } = await fetchChart(symbol, "5d", "1d", 3600);
      const closes = bars.map((b) => b.close).filter(isNum) as number[];
      const px = closes[closes.length - 1];
      if (isNum(px) && px > 0) return invert ? 1 / px : px;
    } catch {
      // Try the other ordering.
    }
  }
  return null;
}

/** Returns the multiplier, or null when the pair genuinely could not be
 *  resolved. Never silently returns 1.0 for a real cross-currency pair — a
 *  wrong 1:1 rate would misstate every figure on the page. */
export async function fetchFxRate(fromCurr: string, toCurr: string): Promise<number | null> {
  if (!fromCurr || !toCurr) return 1;
  if (fromCurr === toCurr) return 1;

  // Many UK listings report price AND currency in pence ("GBp"/"GBX"), not
  // pounds; 1 GBP = 100 GBp, and "USDGBp=X" does not exist on Yahoo, so a naive
  // lookup would fall back to 1.0 — wrong by a factor of a hundred.
  const penceFrom = PENCE.has(fromCurr);
  const penceTo = PENCE.has(toCurr);
  const a = penceFrom ? "GBP" : fromCurr;
  const b = penceTo ? "GBP" : toCurr;
  if (a === b && penceFrom === penceTo) return 1;

  const [ua, ub] = await Promise.all([usdPerUnit(a), usdPerUnit(b)]);
  if (ua === null || ub === null) return null;
  let r = ua / ub;
  if (penceFrom) r /= 100;
  if (penceTo) r *= 100;
  return r;
}

/** Beta from two years of daily returns against a broad index, used when the
 *  quote endpoint does not report one. */
export async function estimateBeta(ticker: string, benchmark = "SPY"): Promise<number | null> {
  try {
    const [a, b] = await Promise.all([
      fetchChart(ticker, "2y", "1d", 3600),
      fetchChart(benchmark, "2y", "1d", 3600),
    ]);
    const byDate = new Map(b.bars.map((bar) => [bar.date, bar.close]));
    const ra: number[] = [];
    const rb: number[] = [];
    for (let i = 1; i < a.bars.length; i++) {
      const prev = a.bars[i - 1];
      const cur = a.bars[i];
      const bPrev = byDate.get(prev.date);
      const bCur = byDate.get(cur.date);
      if (!isNum(prev.close) || !isNum(cur.close) || !isNum(bPrev) || !isNum(bCur) || !prev.close || !bPrev) continue;
      ra.push(cur.close / prev.close - 1);
      rb.push(bCur / bPrev - 1);
    }
    if (ra.length < 60) return null;
    const ma = ra.reduce((x, y) => x + y, 0) / ra.length;
    const mb = rb.reduce((x, y) => x + y, 0) / rb.length;
    let cov = 0;
    let varb = 0;
    for (let i = 0; i < ra.length; i++) {
      cov += (ra[i] - ma) * (rb[i] - mb);
      varb += (rb[i] - mb) ** 2;
    }
    return varb ? cov / varb : null;
  } catch {
    return null;
  }
}
