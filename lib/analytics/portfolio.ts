// Portfolio return engines. Two measures, because they answer different
// questions and diverge whenever contributions were not evenly timed.

import { isNum } from "@/lib/format";

const DAY = 86400000;

/** Money-weighted (internal) rate of return over dated cash flows.
 *
 *  Signs follow the investor's perspective: money paid in is negative, the
 *  closing value is positive. Solved by bisection rather than Newton's method,
 *  which diverges on the irregular flows a real portfolio produces. */
export function xirr(cashflows: { date: string | number | Date; amount: number }[]): number | null {
  const flows = cashflows
    .filter((f) => isNum(f.amount))
    .map((f) => ({ t: new Date(f.date).getTime(), a: f.amount }))
    .filter((f) => Number.isFinite(f.t))
    .sort((a, b) => a.t - b.t);
  if (flows.length < 2) return null;
  if (!(flows.some((f) => f.a < 0) && flows.some((f) => f.a > 0))) return null;

  const t0 = flows[0].t;
  const npv = (rate: number) =>
    flows.reduce((acc, f) => acc + f.a / Math.pow(1 + rate, (f.t - t0) / DAY / 365), 0);

  let lo = -0.95;
  let hi = 10.0;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (fMid === 0) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/** Time-weighted return: each day's return is measured after removing the money
 *  that arrived that day, then the daily returns are chained. This isolates how
 *  the assets performed from when cash happened to be added, which is what
 *  makes it comparable with an index. */
export function twrr(values: number[], flows: number[]): number | null {
  if (!values.length) return null;
  const daily: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    if (!isNum(prev) || prev === 0 || !isNum(values[i])) continue;
    const r = (values[i] - (flows[i] ?? 0)) / prev - 1;
    if (!Number.isFinite(r)) continue;
    // A long-only portfolio cannot lose more than everything in a single day;
    // anything beyond that is a data artefact, not a return.
    if (r > -1 && r < 5) daily.push(r);
  }
  if (!daily.length) return null;
  return daily.reduce((acc, r) => acc * (1 + r), 1) - 1;
}

export interface PositionSimulation {
  /** Market value of the position on each day. */
  value: number[];
  /** Cumulative cash contributed by each day. */
  invested: number[];
  totalInvested: number;
}

/** Buys `initial` on the first day, then `monthly` on the first trading day of
 *  each subsequent month. Prices are split- and dividend-adjusted upstream, so
 *  this is a total-return simulation with dividends reinvested. */
export function simulatePosition(
  dates: string[], prices: number[], initial: number, monthly: number,
): PositionSimulation | null {
  if (!dates.length || !prices.length || !isNum(prices[0]) || prices[0] <= 0) return null;

  const contributions = new Array(prices.length).fill(0);
  contributions[0] = initial;

  if (monthly > 0) {
    let seenMonth = dates[0].slice(0, 7);
    for (let i = 1; i < dates.length; i++) {
      const month = dates[i].slice(0, 7);
      if (month !== seenMonth) {
        seenMonth = month;
        contributions[i] += monthly;
      }
    }
  }

  const value: number[] = [];
  const invested: number[] = [];
  let shares = 0;
  let cash = 0;
  for (let i = 0; i < prices.length; i++) {
    const px = prices[i];
    if (contributions[i] > 0 && isNum(px) && px > 0) {
      shares += contributions[i] / px;
      cash += contributions[i];
    }
    value.push(isNum(px) ? shares * px : value[i - 1] ?? 0);
    invested.push(cash);
  }
  return { value, invested, totalInvested: cash };
}

/** Inverse Herfindahl: how many equal-sized positions a portfolio really
 *  behaves like. A ten-name portfolio where one holding is 60% behaves like
 *  about three. */
export function effectivePositions(weights: number[]): number | null {
  const hhi = weights.reduce((a, w) => a + w * w, 0);
  return hhi > 0 ? 1 / hhi : null;
}
