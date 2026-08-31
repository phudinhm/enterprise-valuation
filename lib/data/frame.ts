// A minimal column-store standing in for the pandas DataFrame the original
// used. Periods run oldest-first, exactly as `_norm_stmt` produced them, so
// `.at(-1)` is always the latest reported period.

import { isNum, type Num } from "@/lib/format";
import { NON_CURRENCY_ITEMS } from "@/lib/constants";

export interface Statement {
  /** ISO date strings, ascending. */
  periods: string[];
  /** Line item name -> one value per period (null where not reported). */
  rows: Record<string, (number | null)[]>;
}

export const EMPTY_STATEMENT: Statement = { periods: [], rows: {} };

export interface Statements {
  inc: Statement;
  bs: Statement;
  cf: Statement;
}

export const EMPTY_STATEMENTS: Statements = {
  inc: EMPTY_STATEMENT,
  bs: EMPTY_STATEMENT,
  cf: EMPTY_STATEMENT,
};

export function isEmpty(s: Statement | null | undefined): boolean {
  return !s || s.periods.length === 0 || Object.keys(s.rows).length === 0;
}

export function hasCol(s: Statement, name: string): boolean {
  return Boolean(s?.rows[name]);
}

/** One line item's series, aligned to `periods`. Returns null when the company
 *  does not report that line at all — distinct from reporting it as zero. */
export function col(s: Statement | null | undefined, ...names: string[]): (number | null)[] | null {
  if (!s) return null;
  for (const name of names) {
    const series = s.rows[name];
    if (series) return series;
  }
  return null;
}

/** The most recent reported value of a line, skipping trailing gaps. */
export function last(s: Statement | null | undefined, ...names: string[]): number | null {
  const series = col(s, ...names);
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (isNum(series[i])) return series[i] as number;
  }
  return null;
}

/** The value one reported period before the most recent one. */
export function prior(s: Statement | null | undefined, ...names: string[]): number | null {
  const series = col(s, ...names);
  if (!series) return null;
  const present = series.filter(isNum) as number[];
  return present.length >= 2 ? present[present.length - 2] : null;
}

/** The first reported value, for CAGR anchors. */
export function first(s: Statement | null | undefined, ...names: string[]): number | null {
  const series = col(s, ...names);
  if (!series) return null;
  for (const v of series) if (isNum(v)) return v;
  return null;
}

/** Every reported value of a line, gaps dropped. */
export function dropna(series: (number | null)[] | null | undefined): number[] {
  return (series ?? []).filter(isNum) as number[];
}

/** Values and their periods, gaps dropped, still aligned to each other. */
export function seriesWithPeriods(
  s: Statement | null | undefined,
  ...names: string[]
): { periods: string[]; values: number[] } {
  const series = col(s, ...names);
  if (!s || !series) return { periods: [], values: [] };
  const periods: string[] = [];
  const values: number[] = [];
  series.forEach((v, i) => {
    if (isNum(v)) {
      periods.push(s.periods[i]);
      values.push(v);
    }
  });
  return { periods, values };
}

/** A whole period as a name -> value record, for the row-wise scorers. */
export function rowAt(s: Statement | null | undefined, index: number): Record<string, number | null> {
  if (!s || s.periods.length === 0) return {};
  const i = index < 0 ? s.periods.length + index : index;
  if (i < 0 || i >= s.periods.length) return {};
  const out: Record<string, number | null> = {};
  for (const [name, series] of Object.entries(s.rows)) out[name] = series[i] ?? null;
  return out;
}

export function latestRow(s: Statement | null | undefined): Record<string, number | null> {
  return rowAt(s, -1);
}

/** Convert monetary lines into the display currency, leaving share counts and
 *  per-share figures alone. */
export function toDisplay(s: Statement | null | undefined, rate: number): Statement {
  if (!s) return EMPTY_STATEMENT;
  if (rate === 1) return s;
  const rows: Record<string, (number | null)[]> = {};
  for (const [name, series] of Object.entries(s.rows)) {
    rows[name] = NON_CURRENCY_ITEMS.has(name)
      ? series
      : series.map((v) => (isNum(v) ? v * rate : null));
  }
  return { periods: s.periods, rows };
}

/** Trailing-twelve-month flow statement: the last four reported quarters
 *  summed, stamped with the latest quarter end. */
export function ttmFromQuarters(s: Statement | null | undefined): Statement {
  if (!s || s.periods.length === 0) return EMPTY_STATEMENT;
  const startIdx = Math.max(0, s.periods.length - 4);
  const rows: Record<string, (number | null)[]> = {};
  for (const [name, series] of Object.entries(s.rows)) {
    const window = series.slice(startIdx).filter(isNum) as number[];
    rows[name] = [window.length ? window.reduce((a, b) => a + b, 0) : null];
  }
  return { periods: [s.periods[s.periods.length - 1]], rows };
}

/** Keep only the most recent period — balance sheet items are stocks, not
 *  flows, so a TTM balance sheet is the latest quarter end, not a sum. */
export function tailOne(s: Statement | null | undefined): Statement {
  if (!s || s.periods.length === 0) return EMPTY_STATEMENT;
  const i = s.periods.length - 1;
  const rows: Record<string, (number | null)[]> = {};
  for (const [name, series] of Object.entries(s.rows)) rows[name] = [series[i] ?? null];
  return { periods: [s.periods[i]], rows };
}

/** Categorical x-axis labels; keeps the chart library from inventing '2021.5'
 *  ticks on what is really a sequence of fiscal periods. */
export function yearLabels(periods: string[], basis = "Annual"): string[] {
  return periods.map((p) => {
    const d = new Date(p);
    if (Number.isNaN(d.getTime())) return String(p).slice(0, 10);
    if (basis === "Quarterly") {
      return d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
    }
    return `FY${d.getUTCFullYear()}`;
  });
}

/** Period-on-period change of a series, aligned to the same periods. */
export function pctChange(values: (number | null)[]): (number | null)[] {
  return values.map((v, i) => {
    if (i === 0) return null;
    const prev = values[i - 1];
    if (!isNum(v) || !isNum(prev) || prev === 0) return null;
    return v / prev - 1;
  });
}

export function sum(series: (number | null)[] | null | undefined): number {
  return dropna(series).reduce((a, b) => a + b, 0);
}

export function median(values: number[]): number | null {
  const v = values.filter(isNum).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mean(values: Num[]): number | null {
  const v = values.filter(isNum) as number[];
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function quantile(values: number[], q: number): number | null {
  const v = values.filter(isNum).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return v[lo];
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function stdev(values: number[], ddof = 1): number | null {
  const v = values.filter(isNum);
  if (v.length <= ddof) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const varsum = v.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(varsum / (v.length - ddof));
}
