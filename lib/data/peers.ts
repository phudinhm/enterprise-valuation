// Peer discovery and the cross-company tables. Every fan-out here runs
// concurrently: the sequential version of a ten-name peer group was ten round
// trips end to end.

import { isNum, safeDiv, pickNum } from "@/lib/format";
import { parallelMap, settle, Notes } from "@/lib/data/http";
import { fetchInfo, fetchChart, fetchStatements, fetchTopHoldings, fetchFxRate } from "@/lib/data/yahoo";
import { median, latestRow, isEmpty } from "@/lib/data/frame";
import { SECTOR_ETF_MAP, marketLabel } from "@/lib/constants";
import type { Info, PeerRow, LeaderRow, IndustryBenchmark } from "@/lib/data/types";

/** Resolve one FX multiplier per distinct currency, not one per holding. */
async function fxMap(currencies: Set<string>, target: string): Promise<Record<string, number>> {
  const list = [...currencies];
  const rates = await parallelMap(list, async (c) => (await fetchFxRate(c, target)) ?? 1, 6);
  return Object.fromEntries(list.map((c, i) => [c, rates[i]]));
}

async function loadInfos(tickers: string[], notes?: Notes): Promise<Info[]> {
  return parallelMap(
    tickers,
    (t) => settle(fetchInfo(t), {} as Info, notes, `quote ${t}`),
    8,
  );
}

/** Peers matched on the finer-grained `industry` classification where possible,
 *  falling back to same-sector names. Candidates come from the sector ETF's
 *  live top holdings rather than a hardcoded five-name list, so the peer group
 *  rotates as the market does. */
export async function suggestPeers(
  ticker: string, sector: string | null, industry: string | null, maxN = 8,
): Promise<string[]> {
  const etf = sector ? SECTOR_ETF_MAP[sector] : undefined;
  if (!etf) return [];
  const candidates = (await fetchTopHoldings(etf, 20)).filter(
    (c) => c.toUpperCase() !== ticker.toUpperCase(),
  );
  if (!candidates.length) return [];

  const infos = await loadInfos(candidates);
  const sameIndustry: string[] = [];
  const sameSector: string[] = [];
  candidates.forEach((c, i) => {
    const info = infos[i];
    if (industry && info.industry === industry) sameIndustry.push(c);
    else if (info.sector === sector) sameSector.push(c);
  });
  const result = sameIndustry.length >= 3 ? sameIndustry : [...sameIndustry, ...sameSector];
  return result.slice(0, maxN);
}

export async function tickerNames(tickers: string[]): Promise<Record<string, string>> {
  const known: Record<string, string> = {
    SPY: "SPDR S&P 500 ETF Trust",
    QQQ: "Invesco QQQ Trust (Nasdaq-100)",
  };
  const todo = tickers.filter((t) => !(t in known));
  const infos = await loadInfos(todo);
  const out: Record<string, string> = { ...known };
  todo.forEach((t, i) => {
    out[t] = (infos[i].shortName as string) || (infos[i].longName as string) || "";
  });
  return Object.fromEntries(tickers.map((t) => [t, out[t] ?? ""]));
}

/** The peer matrix. Multiples that are meaningless or off-scale are dropped
 *  rather than plotted, because one 4,000x P/E flattens every other bar. */
export async function loadComparables(tickers: string[], targetCurrency: string): Promise<PeerRow[]> {
  if (!tickers.length) return [];
  const infos = await loadInfos(tickers);
  const currencies = new Set(infos.map((i) => (i.currency as string) || "USD"));
  const fx = await fxMap(currencies, targetCurrency);

  const rows: PeerRow[] = [];
  tickers.forEach((t, idx) => {
    const i = infos[idx];
    if (!i || !Object.keys(i).length) return;
    const price = pickNum(i, "currentPrice", "regularMarketPrice", "previousClose");
    if (!isNum(price)) return;
    const rate = fx[(i.currency as string) || "USD"] ?? 1;

    let pe = pickNum(i, "trailingPE");
    if (isNum(pe) && (pe > 500 || pe < 0)) pe = null;
    let evEbitda = pickNum(i, "enterpriseToEbitda");
    if (isNum(evEbitda) && (evEbitda > 200 || evEbitda < 0)) evEbitda = null;

    const fcf = pickNum(i, "freeCashflow");
    const mcap = pickNum(i, "marketCap");
    const asPoints = (k: string) => (isNum(i[k]) ? (i[k] as number) * 100 : null);

    rows.push({
      ticker: t,
      name: (i.shortName as string) || (i.longName as string) || t,
      price: price * rate,
      pe,
      forwardPe: pickNum(i, "forwardPE"),
      pb: pickNum(i, "priceToBook"),
      evSales: pickNum(i, "priceToSalesTrailing12Months"),
      evEbitda,
      fcfYield: isNum(fcf) && isNum(mcap) ? (safeDiv(fcf, mcap) ?? 0) * 100 : null,
      opMargin: asPoints("operatingMargins"),
      roe: asPoints("returnOnEquity"),
      revenueGrowth: asPoints("revenueGrowth"),
      netDebtEbitda: safeDiv(
        (pickNum(i, "totalDebt") ?? 0) - (pickNum(i, "totalCash") ?? 0),
        pickNum(i, "ebitda"),
      ),
      marketCap: isNum(mcap) ? mcap * rate : null,
    });
  });
  return rows;
}

/** Leaderboard rows: one profile fetch and one price fetch per company, both
 *  fanned out, rather than two sequential calls each. */
export async function loadLeaderboard(
  tickers: string[], targetCurrency: string, asOf: string,
): Promise<LeaderRow[]> {
  if (!tickers.length) return [];
  const infos = await loadInfos(tickers);
  const currencies = new Set(infos.map((i) => (i.currency as string) || "USD"));
  const fx = await fxMap(currencies, targetCurrency);

  // Market capitalisation at the chosen date is that date's close times the
  // current share count — the only historical series available without a
  // point-in-time share register.
  const asOfDate = asOf.slice(0, 10);
  const closes = await parallelMap(
    tickers,
    async (t) => {
      try {
        const { bars } = await fetchChart(t, "5y", "1d", 3600);
        const upTo = bars.filter((b) => b.date <= asOfDate && isNum(b.close));
        return upTo.length ? (upTo[upTo.length - 1].close as number) : null;
      } catch {
        return null;
      }
    },
    8,
  );

  const rows: LeaderRow[] = [];
  tickers.forEach((t, idx) => {
    const i = infos[idx];
    if (!i || !Object.keys(i).length) return;
    const price = closes[idx] ?? pickNum(i, "currentPrice", "regularMarketPrice", "previousClose");
    if (!isNum(price)) return;
    const rate = fx[(i.currency as string) || "USD"] ?? 1;
    const shares = pickNum(i, "sharesOutstanding", "impliedSharesOutstanding") ?? 0;
    rows.push({
      ticker: t,
      name: (i.longName as string) || (i.shortName as string) || t,
      market: marketLabel(t),
      industry: (i.industry as string) || "—",
      price: price * rate,
      marketCap: price * shares * rate,
      revenue: (pickNum(i, "totalRevenue") ?? 0) * rate,
      netMargin: isNum(i.profitMargins) ? (i.profitMargins as number) * 100 : null,
      shares,
      fx: rate,
    });
  });

  return rows.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
}

/** Median common-size statements across a peer group.
 *
 *  Each peer's latest income statement is expressed as a percentage of its own
 *  revenue and each balance sheet as a percentage of its own total assets,
 *  then the median is taken line by line. That makes the comparison scale-free,
 *  so a company can be read against its industry rather than against an
 *  absolute number that means nothing on its own. */
export async function loadIndustryCommonSize(tickers: string[]): Promise<IndustryBenchmark> {
  if (!tickers.length) return { income: {}, balance: {}, n: 0, peers: [] };

  const fetched = await parallelMap(
    tickers,
    async (t) => {
      try {
        return await fetchStatements(t, false);
      } catch {
        return null;
      }
    },
    6,
  );

  const incRows: Record<string, number>[] = [];
  const bsRows: Record<string, number>[] = [];

  for (const s of fetched) {
    if (!s) continue;
    if (!isEmpty(s.inc)) {
      const row = latestRow(s.inc);
      const rev = row["Total Revenue"];
      if (isNum(rev) && rev > 0) {
        const scaled: Record<string, number> = {};
        for (const [k, v] of Object.entries(row)) if (isNum(v)) scaled[k] = (v / rev) * 100;
        incRows.push(scaled);
      }
    }
    if (!isEmpty(s.bs)) {
      const row = latestRow(s.bs);
      const ta = row["Total Assets"];
      if (isNum(ta) && ta > 0) {
        const scaled: Record<string, number> = {};
        for (const [k, v] of Object.entries(row)) if (isNum(v)) scaled[k] = (v / ta) * 100;
        bsRows.push(scaled);
      }
    }
  }

  const medianOf = (rows: Record<string, number>[]): Record<string, number> => {
    const keys = new Set(rows.flatMap((r) => Object.keys(r)));
    const out: Record<string, number> = {};
    for (const k of keys) {
      const m = median(rows.map((r) => r[k]).filter(isNum) as number[]);
      if (isNum(m)) out[k] = m;
    }
    return out;
  };

  return {
    income: medianOf(incRows),
    balance: medianOf(bsRows),
    n: Math.max(incRows.length, bsRows.length),
    peers: tickers,
  };
}

/** Aligned closing prices for several symbols — one series per ticker on a
 *  shared date axis, so returns and correlations line up without reindexing at
 *  every call site. */
export async function loadBatchCloses(
  tickers: string[], range: string, interval = "1d",
): Promise<{ dates: string[]; series: Record<string, (number | null)[]> }> {
  const unique = [...new Set(tickers)].filter(Boolean);
  if (!unique.length) return { dates: [], series: {} };

  const charts = await parallelMap(
    unique,
    async (t) => {
      try {
        return await fetchChart(t, range, interval, 3600);
      } catch {
        return { bars: [], meta: {} };
      }
    },
    8,
  );

  const dateSet = new Set<string>();
  const byTicker = unique.map((_, i) => {
    const map = new Map<string, number>();
    for (const bar of charts[i].bars) {
      if (isNum(bar.close)) {
        map.set(bar.date, bar.close);
        dateSet.add(bar.date);
      }
    }
    return map;
  });

  const dates = [...dateSet].sort();
  const series: Record<string, (number | null)[]> = {};
  unique.forEach((t, i) => {
    // Forward-fill so a market holiday in one venue does not punch a hole in a
    // cross-listing comparison.
    let lastSeen: number | null = null;
    series[t] = dates.map((d) => {
      const v = byTicker[i].get(d);
      if (isNum(v)) lastSeen = v;
      return lastSeen;
    });
  });

  return { dates, series };
}
