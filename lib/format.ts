// Consistent number formatting. Every figure in the app goes through here so
// units, precision and the em-dash placeholder are uniform.

export const NA = "—";

export type Num = number | null | undefined;

/** True only for a real, finite number. Mirrors the source app's `_isnum`:
 *  booleans and NaN are not numbers for our purposes, and a NaN slipping
 *  through would be truthy in every downstream `x || 0` guard. */
export function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function group(v: number, dp: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

const SCALES: [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

export function money(v: Num, sym = "$", dp = 2): string {
  if (!isNum(v)) return NA;
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  for (const [cut, suf] of SCALES) {
    if (a >= cut) return `${sign}${sym}${group(a / cut, dp)}${suf}`;
  }
  return `${sign}${sym}${group(a, dp)}`;
}

export function num(v: Num, dp = 2): string {
  if (!isNum(v)) return NA;
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  for (const [cut, suf] of SCALES) {
    if (a >= cut) return `${sign}${group(a / cut, dp)}${suf}`;
  }
  return `${sign}${group(a, dp)}`;
}

export function price(v: Num, sym = "$"): string {
  return isNum(v) ? `${sym}${group(v, 2)}` : NA;
}

/** `v` is already in percent units (12.3 means 12.3%). */
export function pct(v: Num, dp = 1, signed = false): string {
  if (!isNum(v)) return NA;
  const body = group(Math.abs(v), dp);
  if (signed) return `${v < 0 ? "-" : "+"}${body}%`;
  return `${v < 0 ? "-" : ""}${body}%`;
}

/** `v` is a fraction (0.123 means 12.3%). */
export function asPct(v: Num, dp = 1, signed = false): string {
  return isNum(v) ? pct(v * 100, dp, signed) : NA;
}

export function ratio(v: Num, dp = 2, suffix = "x"): string {
  return isNum(v) ? `${group(v, dp)}${suffix}` : NA;
}

export function fmtDate(d: string | number | Date | null | undefined): string {
  if (d === null || d === undefined || d === "") return NA;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return NA;
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Convert a monetary figure into the display currency. Returns null when the
 *  value itself is missing, so a gap in the feed reads as "not available"
 *  rather than throwing on `null * rate`. */
export function conv(value: Num, rate: number): number | null {
  return isNum(value) ? value * rate : null;
}

export function safeDiv(n: Num, d: Num): number | null {
  if (!isNum(n) || !isNum(d) || d === 0) return null;
  return n / d;
}

export function cagr(start: Num, end: Num, years: number): number | null {
  if (!isNum(start) || !isNum(end) || start <= 0 || end <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

/** First present, numeric-or-truthy value among `keys`. */
export function pick<T = unknown>(info: Record<string, unknown>, ...keys: string[]): T | null {
  for (const k of keys) {
    const v = info[k];
    if (v !== null && v !== undefined && v !== "" && !(typeof v === "number" && Number.isNaN(v))) {
      return v as T;
    }
  }
  return null;
}

export function pickNum(info: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = info[k];
    if (isNum(v)) return v;
  }
  return null;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** `debtToEquity` comes back as a percentage (e.g. 154.0 = 1.54x). */
export function deAsRatio(v: Num): number | null {
  if (!isNum(v)) return null;
  return Math.abs(v) > 5 ? v / 100 : v;
}

/** Dividend yield as a fraction.
 *
 *  `dividendYield` alone is unreliable: the upstream feed has reported it as a
 *  fraction (0.0044) in some versions and as a percentage (0.44) in others, and
 *  the two are indistinguishable from the number alone. Deriving it from the
 *  annual dividend per share and the price is unambiguous, so that is tried
 *  first; the reported fields are fallbacks, capped at a level no ordinary
 *  equity exceeds. */
export function dividendYield(info: Record<string, unknown>, px: Num): number | null {
  const rate = pickNum(info, "dividendRate", "trailingAnnualDividendRate");
  const derived = safeDiv(rate, px);
  if (derived !== null && derived >= 0 && derived < 0.25) return derived;
  for (const key of ["trailingAnnualDividendYield", "dividendYield", "yield"]) {
    const v = info[key];
    if (!isNum(v) || v <= 0) continue;
    const candidate = v > 0.25 ? v / 100 : v;
    if (candidate < 0.25) return candidate;
  }
  return null;
}

export interface DividendFacts {
  yield: number | null;
  rate: number | null;
  exDate: number | null;
  payDate: number | null;
  payout: number | null;
  fiveYearAvg: number | null;
  lastSplit: string | null;
}

/** Everything the dividend panel needs, with epoch timestamps resolved. */
export function dividendFacts(info: Record<string, unknown>, px: Num): DividendFacts {
  const asDate = (key: string): number | null => {
    const v = info[key];
    if (!isNum(v)) return null;
    // Yahoo returns seconds; anything already in milliseconds is passed through.
    const ms = v > 1e11 ? v : v * 1000;
    return Number.isFinite(ms) ? ms : null;
  };
  const fiveYr = info["fiveYearAvgDividendYield"]; // reported in percent
  return {
    yield: dividendYield(info, px),
    rate: pickNum(info, "dividendRate", "trailingAnnualDividendRate"),
    exDate: asDate("exDividendDate"),
    payDate: asDate("dividendDate"),
    payout: isNum(info["payoutRatio"]) ? (info["payoutRatio"] as number) : null,
    fiveYearAvg: isNum(fiveYr) ? (fiveYr as number) / 100 : null,
    lastSplit: typeof info["lastSplitFactor"] === "string" ? (info["lastSplitFactor"] as string) : null,
  };
}

/** Initials tile used in place of a remote logo lookup. Third-party logo
 *  services fail often enough (and add a blocking request) that a rendered
 *  monogram is both faster and more reliable. */
export function monogram(name: string): string {
  const words = (name || "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
}

export function timeAgo(ms: number | null | undefined): string {
  if (!ms) return "";
  const delta = Date.now() - ms;
  const days = Math.floor(delta / 86400000);
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(delta / 3600000);
  if (hours > 0) return `${hours}h ago`;
  return `${Math.max(Math.floor(delta / 60000), 1)}m ago`;
}

/** Tone for a KPI accent stripe. `good`/`bad` are thresholds; pass
 *  `higherBetter = false` for metrics where a low reading is the good one. */
export function toneFor(value: Num, good: number, bad: number, higherBetter = true): Tone {
  if (!isNum(value)) return "flat";
  if (higherBetter) return value >= good ? "good" : value <= bad ? "bad" : "warn";
  return value <= good ? "good" : value >= bad ? "bad" : "warn";
}

export type Tone = "good" | "bad" | "warn" | "flat";
