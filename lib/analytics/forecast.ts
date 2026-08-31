// Forward projections and outlier detection. Deliberately several methods that
// share no assumptions: agreement between them is the only weak evidence a
// price forecast can offer, and disagreement is the honest signal that the
// future is open.

import { isNum } from "@/lib/format";
import { stdev } from "@/lib/data/frame";

export interface ForecastPoint {
  date: string;
  trend: number;
  trendLow: number;
  trendHigh: number;
  rwMedian: number;
  rwLow: number;
  rwHigh: number;
  damped: number | null;
}

export interface Forecast {
  points: ForecastPoint[];
  annualDrift: number;
  annualVol: number;
  rSquared: number | null;
}

/** Holt's damped linear trend, fitted by a coarse grid search on one-step
 *  squared error. Weights recent observations far more heavily than the
 *  log-linear fit, and lets the trend decay rather than extrapolate forever. */
function holtDamped(values: number[], horizon: number): number[] | null {
  if (values.length < 10) return null;
  let best: { sse: number; level: number; trend: number; phi: number } | null = null;

  for (const alpha of [0.1, 0.2, 0.3, 0.5, 0.7, 0.9]) {
    for (const beta of [0.02, 0.05, 0.1, 0.2, 0.4]) {
      for (const phi of [0.8, 0.9, 0.95, 0.98]) {
        let level = values[0];
        let trend = values[1] - values[0];
        let sse = 0;
        for (let i = 1; i < values.length; i++) {
          const forecastOne = level + phi * trend;
          const err = values[i] - forecastOne;
          sse += err * err;
          const prevLevel = level;
          level = alpha * values[i] + (1 - alpha) * forecastOne;
          trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
        }
        if (!Number.isFinite(sse)) continue;
        if (!best || sse < best.sse) best = { sse, level, trend, phi };
      }
    }
  }
  if (!best) return null;

  const out: number[] = [];
  let damping = 0;
  for (let h = 1; h <= horizon; h++) {
    damping += Math.pow(best.phi, h);
    out.push(best.level + damping * best.trend);
  }
  return out.every(Number.isFinite) ? out : null;
}

/** Business days forward from a date, so the projection lands on the same grid
 *  the price series itself uses. */
function businessDays(from: Date, count: number): string[] {
  const out: string[] = [];
  const d = new Date(from.getTime());
  while (out.length < count) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function buildForecast(
  dates: string[], closes: number[], horizon = 60,
): Forecast | null {
  const pairs = dates
    .map((d, i) => [d, closes[i]] as const)
    .filter(([, v]) => isNum(v) && v > 0);
  if (pairs.length < 30 || horizon < 1) return null;

  const idx = pairs.map(([d]) => d);
  const px = pairs.map(([, v]) => v);
  const y = px.map((v) => Math.log(v));
  const n = y.length;
  const x = Array.from({ length: n }, (_, i) => i);

  // Ordinary least squares on log price: the "if the last N days continue" case.
  const xMean = x.reduce((a, b) => a + b, 0) / n;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - xMean) * (y[i] - yMean);
    sxx += (x[i] - xMean) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;
  const resid = y.map((v, i) => v - (slope * x[i] + intercept));
  const sigma = stdev(resid, n > 2 ? 2 : 1) ?? 0;
  const ssRes = resid.reduce((a, b) => a + b * b, 0);
  const ssTot = y.reduce((a, b) => a + (b - yMean) ** 2, 0);
  const rSquared = n > 2 && ssTot > 0 ? 1 - ssRes / ssTot : null;

  // A geometric random walk from the series' own drift and volatility. It
  // describes the range rather than a path.
  const logRet: number[] = [];
  for (let i = 1; i < n; i++) logRet.push(y[i] - y[i - 1]);
  const mu = logRet.reduce((a, b) => a + b, 0) / logRet.length;
  const sd = stdev(logRet, 1) ?? 0;
  const lastPx = px[n - 1];

  const damped = holtDamped(px, horizon);
  const futureDates = businessDays(new Date(idx[n - 1]), horizon);

  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const fx = n + h - 1;
    const logTrend = slope * fx + intercept;
    const se = sigma * Math.sqrt(1 + 1 / n + (fx - xMean) ** 2 / sxx);
    const step = h;
    points.push({
      date: futureDates[h - 1],
      trend: Math.exp(logTrend),
      trendLow: Math.exp(logTrend - 1.96 * se),
      trendHigh: Math.exp(logTrend + 1.96 * se),
      rwMedian: lastPx * Math.exp(mu * step),
      rwLow: lastPx * Math.exp(mu * step - 1.645 * sd * Math.sqrt(step)),
      rwHigh: lastPx * Math.exp(mu * step + 1.645 * sd * Math.sqrt(step)),
      damped: damped ? damped[h - 1] : null,
    });
  }

  return {
    points,
    annualDrift: Math.expm1(mu * 252),
    annualVol: sd * Math.sqrt(252),
    rSquared,
  };
}

export interface Shock {
  date: string;
  movePct: number;
  sigma: number;
}

/** Days whose move is a statistical outlier for this series.
 *
 *  Picked by standardised return rather than a fixed percentage, so the
 *  threshold adapts to how volatile the stock actually is: a 4% day is
 *  unremarkable for one name and a shock for another. */
export function detectShocks(
  dates: string[], closes: number[], zThreshold = 2.5, maxEvents = 8,
): Shock[] {
  const pairs = dates
    .map((d, i) => [d, closes[i]] as const)
    .filter(([, v]) => isNum(v) && v > 0);
  if (pairs.length < 40) return [];

  const rets: { date: string; r: number }[] = [];
  for (let i = 1; i < pairs.length; i++) {
    const prev = pairs[i - 1][1];
    if (prev === 0) continue;
    rets.push({ date: pairs[i][0], r: pairs[i][1] / prev - 1 });
  }
  if (!rets.length) return [];

  const values = rets.map((r) => r.r);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = stdev(values, 1);
  if (!sd) return [];

  return rets
    .map((r) => ({ date: r.date, movePct: r.r * 100, sigma: (r.r - mean) / sd }))
    .filter((r) => Math.abs(r.sigma) >= zThreshold)
    .sort((a, b) => Math.abs(b.sigma) - Math.abs(a.sigma))
    .slice(0, maxEvents)
    .sort((a, b) => a.date.localeCompare(b.date));
}
