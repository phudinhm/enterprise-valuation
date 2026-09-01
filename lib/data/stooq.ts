// Backup price source. Stooq serves daily OHLCV as CSV for most developed
// markets and needs no API key, so it works on any deployment without
// configuration — which matters because Yahoo rate-limits per source address
// and a shared serverless host hits that limit routinely.

import { getText } from "@/lib/data/http";
import type { PriceBar } from "@/lib/data/types";
import { periodDays } from "@/lib/constants";

// Stooq's own market suffixes, keyed by the Yahoo suffix this app uses.
const STOOQ_SUFFIX: Record<string, string> = {
  "": ".us", DE: ".de", F: ".de", L: ".uk", T: ".jp", HK: ".hk",
  PA: ".fr", MI: ".it", MC: ".es", AS: ".nl", BR: ".be", VI: ".at",
  SW: ".ch", ST: ".se", OL: ".no", CO: ".dk", HE: ".fi", IR: ".ie",
  LS: ".pt", AT: ".gr", WA: ".pl", PR: ".cz", BD: ".hu", IS: ".tr",
  TA: ".il", NS: ".in", BO: ".in", SS: ".cn", SZ: ".cn", KS: ".kr",
  KQ: ".kr", TW: ".tw", SI: ".sg", AX: ".au", NZ: ".nz", TO: ".ca",
  V: ".ca", SA: ".br", MX: ".mx", BA: ".ar", SN: ".cl", JO: ".za",
};

/** Translates a Yahoo symbol into Stooq's convention, or null where Stooq does
 *  not cover that market (Vietnam among them). */
export function stooqSymbol(ticker: string): string | null {
  if (!ticker) return null;
  let base = ticker;
  let suffix = "";
  if (ticker.includes(".")) {
    const idx = ticker.lastIndexOf(".");
    base = ticker.slice(0, idx);
    suffix = ticker.slice(idx + 1).toUpperCase();
  }
  const stooq = STOOQ_SUFFIX[suffix];
  if (stooq === undefined) return null;
  return `${base.replace(/-/g, ".").toLowerCase()}${stooq}`;
}

function parseCsv(text: string): PriceBar[] {
  const lines = text.trim().split(/\r?\n/);
  // Stooq answers 200 with a plain-text message rather than an error status when
  // it will not serve you — most often a daily-hit limit reached by whichever
  // other tenant shares this egress address. Reporting that as "no rows" hides
  // the only fact worth knowing, so it is raised instead.
  if (lines.length < 2 || !lines[0].includes(",")) {
    const body = text.trim().slice(0, 120) || "empty response";
    throw new Error(`Stooq did not return CSV: ${body}`);
  }
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const iDate = idx("Date");
  const iClose = idx("Close");
  if (iDate < 0 || iClose < 0) return [];
  const iOpen = idx("Open");
  const iHigh = idx("High");
  const iLow = idx("Low");
  const iVol = idx("Volume");

  const numAt = (parts: string[], i: number): number | null => {
    if (i < 0) return null;
    const v = Number(parts[i]);
    return Number.isFinite(v) ? v : null;
  };

  const bars: PriceBar[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    const date = parts[iDate]?.trim();
    const close = numAt(parts, iClose);
    if (!date || close === null) continue;
    bars.push({
      date,
      open: numAt(parts, iOpen),
      high: numAt(parts, iHigh),
      low: numAt(parts, iLow),
      close,
      volume: numAt(parts, iVol),
    });
  }
  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

/** Full daily history from Stooq, in the app's usual bar shape so it can be
 *  swapped in wherever a Yahoo history would have gone. */
export async function stooqHistory(ticker: string): Promise<PriceBar[]> {
  const symbol = stooqSymbol(ticker);
  if (!symbol) return [];
  const text = await getText(
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`,
    { revalidate: 3600, timeoutMs: 12000 },
  );
  return parseCsv(text);
}

/** Stooq serves the whole history in one file; this trims it to the period the
 *  caller asked Yahoo for, so the fallback is a drop-in replacement. */
export async function stooqWindow(ticker: string, period: string): Promise<PriceBar[]> {
  const bars = await stooqHistory(ticker);
  if (!bars.length) return bars;
  if (period === "max") return bars;
  if (period === "ytd") {
    const start = `${new Date().getUTCFullYear()}-01-01`;
    return bars.filter((b) => b.date >= start);
  }
  const days = periodDays(period);
  if (days === null) return bars;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return bars.filter((b) => b.date >= cutoff);
}
