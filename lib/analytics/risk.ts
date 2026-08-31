// Risk statistics and the forward simulation.

import { isNum } from "@/lib/format";
import { stdev, quantile } from "@/lib/data/frame";

export interface RiskStats {
  vol: number | null;
  var95: number | null;
  cvar95: number | null;
  maxDrawdown: number | null;
  sortino: number | null;
  annReturn: number | null;
}

/** Inverse standard normal CDF (Acklam's rational approximation). Used for the
 *  parametric VaR figure, replacing scipy's `norm.ppf`. */
export function normPpf(p: number, mean = 0, sd = 1): number {
  if (p <= 0 || p >= 1) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  let x: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return mean + sd * x;
}

export function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (!isNum(prev) || prev === 0 || !isNum(closes[i])) continue;
    out.push(closes[i] / prev - 1);
  }
  return out;
}

/** Every day's distance below the running peak, as a fraction. */
export function drawdownSeries(closes: number[]): number[] {
  const out: number[] = [];
  let peak = -Infinity;
  let cum = 1;
  const rets = dailyReturns(closes);
  for (const r of rets) {
    cum *= 1 + r;
    peak = Math.max(peak, cum);
    out.push(cum / peak - 1);
  }
  return out;
}

export function riskStats(closes: number[]): RiskStats | null {
  const ret = dailyReturns(closes);
  if (ret.length < 2) return null;
  const mean = ret.reduce((a, b) => a + b, 0) / ret.length;
  const sd = stdev(ret, 1) ?? 0;
  const dd = drawdownSeries(closes);
  const downside = stdev(ret.filter((r) => r < 0), 1);
  const downsideAnnual = downside ? downside * Math.sqrt(252) : null;
  const cut = quantile(ret, 0.05);
  const tail = cut === null ? [] : ret.filter((r) => r <= cut);

  return {
    vol: sd * Math.sqrt(252),
    var95: normPpf(0.05, mean, sd),
    cvar95: ret.length > 20 && tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : null,
    maxDrawdown: dd.length ? Math.min(...dd) : null,
    sortino: downsideAnnual && downsideAnnual > 0 ? (mean * 252) / downsideAnnual : null,
    annReturn: Math.pow(1 + mean, 252) - 1,
  };
}

/** Deterministic PRNG (mulberry32) so a seed reproduces a simulation exactly,
 *  the way `numpy.random.default_rng(seed)` did. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller: two independent standard normals per uniform pair. */
function normalPair(rand: () => number): [number, number] {
  let u = rand();
  const v = rand();
  if (u < 1e-12) u = 1e-12;
  const mag = Math.sqrt(-2 * Math.log(u));
  return [mag * Math.cos(2 * Math.PI * v), mag * Math.sin(2 * Math.PI * v)];
}

export interface Simulation {
  /** Percentile bands across the horizon, one entry per simulated day. */
  p5: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p95: number[];
  /** Terminal values across every path, sorted ascending. */
  finals: number[];
}

/** Geometric random walk, generated column by column so only one day of paths
 *  is held at a time — a 10,000-path, two-year run never materialises a
 *  full matrix. */
export function simulatePaths(
  lastPrice: number, mu: number, sigma: number, days: number, paths: number, seed: number,
): Simulation {
  const rand = seededRandom(seed);
  let current = new Float64Array(paths).fill(lastPrice);
  const bands: Simulation = { p5: [], p25: [], p50: [], p75: [], p95: [], finals: [] };

  for (let d = 0; d < days; d++) {
    for (let p = 0; p < paths; p += 2) {
      const [z1, z2] = normalPair(rand);
      current[p] *= 1 + (mu + sigma * z1);
      if (p + 1 < paths) current[p + 1] *= 1 + (mu + sigma * z2);
    }
    const sorted = Array.from(current).sort((a, b) => a - b);
    bands.p5.push(quantile(sorted, 0.05) ?? 0);
    bands.p25.push(quantile(sorted, 0.25) ?? 0);
    bands.p50.push(quantile(sorted, 0.5) ?? 0);
    bands.p75.push(quantile(sorted, 0.75) ?? 0);
    bands.p95.push(quantile(sorted, 0.95) ?? 0);
    if (d === days - 1) bands.finals = sorted;
  }
  return bands;
}

/** Histogram bins for a return distribution chart. */
export function histogram(values: number[], bins: number): { centers: number[]; counts: number[] } {
  if (!values.length) return { centers: [], counts: [] };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo === hi) return { centers: [lo], counts: [values.length] };
  const width = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const i = Math.min(Math.floor((v - lo) / width), bins - 1);
    counts[i]++;
  }
  return {
    centers: Array.from({ length: bins }, (_, i) => lo + width * (i + 0.5)),
    counts,
  };
}

/** Pearson correlation matrix over aligned return series. */
export function correlationMatrix(series: Record<string, number[]>): {
  keys: string[]; matrix: number[][];
} {
  const keys = Object.keys(series);
  const matrix = keys.map((a) =>
    keys.map((b) => {
      const x = series[a];
      const y = series[b];
      const n = Math.min(x.length, y.length);
      if (n < 2) return NaN;
      const xs = x.slice(x.length - n);
      const ys = y.slice(y.length - n);
      const mx = xs.reduce((p, c) => p + c, 0) / n;
      const my = ys.reduce((p, c) => p + c, 0) / n;
      let num = 0;
      let dx = 0;
      let dy = 0;
      for (let i = 0; i < n; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        dx += (xs[i] - mx) ** 2;
        dy += (ys[i] - my) ** 2;
      }
      return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
    }),
  );
  return { keys, matrix };
}
