// The wire contract between the data layer and the modules. Everything is
// JSON-serialisable, so a route handler can compute it on the server and the
// client can render from it without a second round trip.

import type { Statements } from "@/lib/data/frame";

export type Info = Record<string, unknown>;

export interface Company {
  ticker: string;
  name: string;
  currency: string;
  sector: string;
  industry: string;
  exchange: string;
  /** The merged quote snapshot, topped up from fast quote and, where the quote
   *  endpoint came back thin, rebuilt from the reported statements. */
  info: Info;
  /** Fields that were computed here rather than quoted. Named so the page can
   *  say so instead of passing a calculated figure off as a reported one. */
  derived: string[];
  /** How many of the headline quote metrics actually came back. */
  quoteFields: number;
  quoteMetricCount: number;
  annual: Statements;
  quarterly: Statements;
  price: number | null;
  previousClose: number | null;
  shares: number | null;
  marketCap: number | null;
  netDebt: number;
  baseFcf: number | null;
  normalisedFcf: number | null;
  dividendHistory: { date: string; amount: number }[];
  /** Which provider actually served each piece of data. */
  sources: Record<string, string>;
  /** Non-fatal loading problems, surfaced in the provenance panel rather than
   *  silently swallowed. */
  errors: string[];
  riskFreeRate: number;
}

export interface PriceBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  dividend?: number;
}

export interface HistoryResult {
  bars: PriceBar[];
  source: string;
}

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  time: number | null;
}

export interface PeerRow {
  ticker: string;
  name: string;
  price: number | null;
  pe: number | null;
  forwardPe: number | null;
  pb: number | null;
  evSales: number | null;
  evEbitda: number | null;
  fcfYield: number | null;
  opMargin: number | null;
  roe: number | null;
  revenueGrowth: number | null;
  netDebtEbitda: number | null;
  marketCap: number | null;
}

export interface LeaderRow {
  ticker: string;
  name: string;
  market: string;
  industry: string;
  price: number | null;
  marketCap: number | null;
  revenue: number | null;
  netMargin: number | null;
  shares: number;
  fx: number;
}

export interface IndustryBenchmark {
  income: Record<string, number>;
  balance: Record<string, number>;
  n: number;
  peers: string[];
}
