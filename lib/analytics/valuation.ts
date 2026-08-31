// Valuation models. Every one returns its components so a result can be shown
// as a bridge rather than a single opaque number.

import { isNum, clamp, safeDiv, type Num } from "@/lib/format";

export interface DcfResult {
  fairValue: number;
  enterpriseValue: number;
  equityValue: number;
  pvExplicit: number;
  pvTerminal: number;
  terminalShare: number | null;
  projectedFcf: number[];
  waccUsed: number;
}

/** Three-phase DCF: an explicit high-growth stage, a fade stage, then a
 *  Gordon-growth terminal value. */
export function dcf(
  fcf: Num, g1: Num, years1: number, g2: Num, wacc: Num, terminalG: Num,
  netDebt: Num, shares: Num, years2 = 5,
): DcfResult | null {
  if (![fcf, g1, wacc, terminalG, shares].every(isNum) || !shares) return null;
  let w = wacc as number;
  const tg = terminalG as number;
  // Keep the Gordon denominator positive; a discount rate at or below the
  // perpetual growth rate implies infinite value, which is not a valuation.
  if (w <= tg) w = tg + 0.015;

  const flows: number[] = [];
  let cur = fcf as number;
  for (let i = 0; i < Math.trunc(years1); i++) {
    cur *= 1 + (g1 as number);
    flows.push(cur);
  }
  for (let i = 0; i < Math.trunc(years2); i++) {
    cur *= 1 + (isNum(g2) ? g2 : 0);
    flows.push(cur);
  }
  if (!flows.length) return null;

  const n = flows.length;
  const pvFlows = flows.map((f, i) => f / Math.pow(1 + w, i + 1));
  const terminal = (flows[n - 1] * (1 + tg)) / (w - tg);
  const pvTerminal = terminal / Math.pow(1 + w, n);
  const pvExplicit = pvFlows.reduce((a, b) => a + b, 0);
  const ev = pvExplicit + pvTerminal;
  const equity = ev - (isNum(netDebt) ? netDebt : 0);

  return {
    fairValue: equity / (shares as number),
    enterpriseValue: ev,
    equityValue: equity,
    pvExplicit,
    pvTerminal,
    terminalShare: safeDiv(pvTerminal, ev),
    projectedFcf: flows,
    waccUsed: w,
  };
}

/** Reverse DCF: the stage-1 growth rate that makes the model agree with today's
 *  market price — i.e. what the market is already assuming. */
export function impliedGrowth(
  price: Num, fcf: Num, years1: number, g2: Num, wacc: Num, terminalG: Num,
  netDebt: Num, shares: Num,
): number | null {
  if (!isNum(price) || price <= 0 || !isNum(shares) || !shares || !isNum(fcf) || !fcf) return null;
  let lo = -0.6;
  let hi = 1.0;
  const fv = (g: number): number | null => {
    const r = dcf(fcf, g, years1, g2, wacc, terminalG, netDebt, shares);
    return r ? r.fairValue : null;
  };
  const fLo = fv(lo);
  const fHi = fv(hi);
  if (fLo === null || fHi === null || !(fLo <= price && price <= fHi)) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = fv(mid);
    if (v === null) return null;
    if (v < price) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Graham's defensive-investor ceiling: √(22.5 × EPS × book value). */
export function grahamNumber(eps: Num, bvps: Num): number | null {
  if (!isNum(eps) || !isNum(bvps) || eps <= 0 || bvps <= 0) return null;
  return Math.sqrt(22.5 * eps * bvps);
}

/** Peter Lynch's fair value at PEG = 1, with growth capped at 25%. */
export function lynchValue(eps: Num, growthPct: Num): number | null {
  if (!isNum(eps) || eps <= 0 || !isNum(growthPct) || growthPct <= 0) return null;
  return eps * Math.min(growthPct, 25);
}

export interface WaccResult {
  wacc: number;
  costEquity: number;
  weightEquity: number;
  weightDebt: number;
}

export function capmWacc(
  beta: Num, riskFree: number, erp: number, costDebt: number, taxRate: number,
  mcap: Num, debt: Num,
): WaccResult {
  const b = isNum(beta) ? beta : 1.0;
  const costEquity = riskFree + b * erp;
  const e = isNum(mcap) ? mcap : 0;
  const d = isNum(debt) ? debt : 0;
  const total = e + d;
  if (total <= 0) {
    return { wacc: costEquity, costEquity, weightEquity: 1, weightDebt: 0 };
  }
  const wE = e / total;
  const wD = d / total;
  return {
    wacc: wE * costEquity + wD * costDebt * (1 - taxRate),
    costEquity,
    weightEquity: wE,
    weightDebt: wD,
  };
}

/** Effective tax rate from the latest income statement, clamped to a 0–40%
 *  band so a one-off credit cannot distort a whole valuation. */
export function effectiveTaxRate(pretax: Num, taxProvision: Num, fallback = 0.21): number {
  if (isNum(pretax) && pretax !== 0 && isNum(taxProvision)) {
    return clamp(taxProvision / pretax, 0, 0.4);
  }
  return fallback;
}

/** After-tax cost of debt implied by the company's own interest bill, clamped
 *  to a plausible band. */
export function impliedCostOfDebt(interestExpense: Num, totalDebt: Num, fallback = 0.05): number {
  if (isNum(interestExpense) && isNum(totalDebt) && totalDebt) {
    return clamp(Math.abs(interestExpense) / totalDebt, 0.005, 0.2);
  }
  return fallback;
}
