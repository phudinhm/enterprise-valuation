// The composite screen, the earnings-quality checklist, and the derived inputs
// both share. Computed once per company from already-fetched statements.

import {
  isNum, safeDiv, cagr, asPct, ratio, num as formatNum, pickNum, deAsRatio, clamp, NA, type Num,
} from "@/lib/format";
import { col, dropna, last, latestRow, rowAt, seriesWithPeriods, isEmpty } from "@/lib/data/frame";
import { altmanZ, piotroskiF, type PiotroskiTest } from "@/lib/analytics/scoring";
import type { Company } from "@/lib/data/types";

/** Maps a metric onto 0-100. `lo` scores 0 and `hi` scores 100; passing
 *  lo > hi expresses a lower-is-better metric. */
export function scale(v: Num, lo: number, hi: number): number | null {
  if (!isNum(v)) return null;
  if (lo === hi) return 50;
  return clamp(((v - lo) / (hi - lo)) * 100, 0, 100);
}

export interface Driver {
  label: string;
  display: string;
  score: number | null;
}

export interface Pillar {
  name: string;
  weight: number;
  drivers: Driver[];
  score: number | null;
}

function pillar(name: string, weight: number, drivers: Driver[]): Pillar {
  const scored = drivers.map((d) => d.score).filter(isNum) as number[];
  return {
    name,
    weight,
    drivers,
    score: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null,
  };
}

const SCORE_BANDS: [number, string, string][] = [
  [80, "Exceptional", "Screens strongly on nearly every pillar measured here."],
  [65, "Strong", "Screens well overall, with one or two softer pillars."],
  [50, "Solid", "A balanced profile: clear strengths offset by clear weaknesses."],
  [35, "Mixed", "More weak pillars than strong ones on these measures."],
  [0, "Fragile", "Weak across most pillars measured here; treat with care."],
];

export interface Extras {
  revCagr?: number | null;
  fcfCagr?: number | null;
  cashConversion?: number | null;
  accruals?: number | null;
  interestCover?: number | null;
  gmDelta?: number | null;
  receivableGap?: number | null;
  dilution?: number | null;
  zScore?: number | null;
  fScore?: number | null;
  fTests?: PiotroskiTest[];
  rangePos?: number | null;
  vsSma200?: number | null;
}

/** Derived inputs shared by the scorecard, the quality checklist and the
 *  executive summary. */
export function computeExtras(co: Company): Extras {
  const e: Extras = {};
  const { inc, bs, cf } = co.annual;
  const info = co.info;

  const rev = seriesWithPeriods(inc, "Total Revenue");
  if (rev.values.length >= 2) {
    e.revCagr = cagr(rev.values[0], rev.values[rev.values.length - 1], rev.values.length - 1);
  }

  const fcfSeries = dropna(col(cf, "Free Cash Flow"));
  if (fcfSeries.length >= 2 && fcfSeries[0] > 0) {
    e.fcfCagr = cagr(fcfSeries[0], fcfSeries[fcfSeries.length - 1], fcfSeries.length - 1);
  }

  const ocf = last(cf, "Operating Cash Flow");
  const ni = last(inc, "Net Income");
  e.cashConversion = isNum(ni) && ni > 0 ? safeDiv(ocf, ni) : null;

  const ta = last(bs, "Total Assets");
  if (isNum(ni) && isNum(ocf) && isNum(ta) && ta !== 0) e.accruals = (ni - ocf) / ta;

  const ebit = last(inc, "EBIT", "Operating Income");
  const intExp = last(inc, "Interest Expense");
  if (isNum(ebit) && isNum(intExp) && Math.abs(intExp) > 0) {
    e.interestCover = Math.abs(safeDiv(ebit, Math.abs(intExp)) ?? 0);
  }

  const gross = col(inc, "Gross Profit");
  const revCol = col(inc, "Total Revenue");
  if (gross && revCol) {
    const gm = gross
      .map((g, i) => safeDiv(g, revCol[i]))
      .filter(isNum) as number[];
    if (gm.length >= 2) e.gmDelta = gm[gm.length - 1] - gm[gm.length - 2];
  }

  const revLatest = last(inc, "Total Revenue");
  const revPrior = dropna(col(inc, "Total Revenue"));
  const arSeries = dropna(col(bs, "Accounts Receivable"));
  if (revPrior.length >= 2 && arSeries.length >= 2) {
    const revG = safeDiv(revLatest, revPrior[revPrior.length - 2]);
    const arG = safeDiv(arSeries[arSeries.length - 1], arSeries[arSeries.length - 2]);
    if (isNum(revG) && isNum(arG)) e.receivableGap = arG - revG;
  }

  const shares = dropna(col(bs, "Share Issued", "Ordinary Shares Number"));
  if (shares.length >= 2 && shares[shares.length - 2]) {
    e.dilution = shares[shares.length - 1] / shares[shares.length - 2] - 1;
  }

  if (!isEmpty(bs) && !isEmpty(inc)) {
    e.zScore = altmanZ(latestRow(bs), latestRow(inc), co.marketCap);
    if (bs.periods.length >= 2 && inc.periods.length >= 2 && !isEmpty(cf)) {
      const f = piotroskiF(latestRow(bs), latestRow(inc), latestRow(cf), rowAt(bs, -2), rowAt(inc, -2));
      e.fScore = f.score;
      e.fTests = f.tests;
    }
  }

  const hi = pickNum(info, "fiftyTwoWeekHigh");
  const lo = pickNum(info, "fiftyTwoWeekLow");
  if (isNum(hi) && isNum(lo) && hi > lo && isNum(co.price)) {
    e.rangePos = clamp((co.price - lo) / (hi - lo), 0, 1);
  }
  const sma200 = pickNum(info, "twoHundredDayAverage");
  if (isNum(sma200) && sma200 && isNum(co.price)) e.vsSma200 = co.price / sma200 - 1;

  return e;
}

export interface Scorecard {
  total: number | null;
  band: string;
  blurb: string;
  pillars: Pillar[];
  coverage: number;
  totalDrivers: number;
}

/** A transparent composite: five weighted pillars, each an average of the
 *  sub-metrics that could actually be computed. Missing inputs are skipped and
 *  the weights renormalise, so a thinly reported company is not punished for
 *  gaps in the data feed. */
export function buildScorecard(co: Company, extras: Extras): Scorecard {
  const i = co.info;
  const n = (k: string) => pickNum(i, k);
  const asPercentPoints = (v: Num) => (isNum(v) ? v * 100 : null);

  const fcfYield = safeDiv(co.baseFcf, co.marketCap);
  const pe = n("trailingPE");
  const peg = pickNum(i, "pegRatio", "trailingPegRatio");

  const pillars: Pillar[] = [
    pillar("Valuation", 0.25, [
      { label: "FCF yield", display: asPct(fcfYield), score: scale(asPercentPoints(fcfYield), 0, 8) },
      {
        label: "Trailing P/E",
        display: ratio(pe),
        // A negative P/E is not "cheap": loss-making earnings score near the
        // floor rather than off the top of the scale.
        score: isNum(pe) ? (pe > 0 ? scale(pe, 45, 10) : 10) : null,
      },
      { label: "PEG", display: ratio(peg), score: isNum(peg) && peg > 0 ? scale(peg, 3.0, 0.8) : null },
      { label: "EV/EBITDA", display: ratio(n("enterpriseToEbitda")), score: scale(n("enterpriseToEbitda"), 25, 6) },
    ]),
    pillar("Profitability", 0.2, [
      { label: "Return on equity", display: asPct(n("returnOnEquity")), score: scale(asPercentPoints(n("returnOnEquity")), 0, 25) },
      { label: "Return on assets", display: asPct(n("returnOnAssets")), score: scale(asPercentPoints(n("returnOnAssets")), 0, 12) },
      { label: "Operating margin", display: asPct(n("operatingMargins")), score: scale(asPercentPoints(n("operatingMargins")), 0, 30) },
      { label: "Net margin", display: asPct(n("profitMargins")), score: scale(asPercentPoints(n("profitMargins")), 0, 20) },
    ]),
    pillar("Financial health", 0.2, [
      { label: "Current ratio", display: ratio(n("currentRatio")), score: scale(n("currentRatio"), 0.8, 2.5) },
      { label: "Debt / equity", display: ratio(deAsRatio(n("debtToEquity"))), score: scale(deAsRatio(n("debtToEquity")), 2.5, 0.2) },
      {
        label: "Net debt / EBITDA",
        display: ratio(safeDiv(co.netDebt, n("ebitda"))),
        score: scale(safeDiv(co.netDebt, n("ebitda")), 4.0, 0.0),
      },
      { label: "Altman Z", display: ratio(extras.zScore, 2, ""), score: scale(extras.zScore, 1.1, 3.5) },
      { label: "Interest cover", display: ratio(extras.interestCover), score: scale(extras.interestCover, 1.0, 12.0) },
    ]),
    pillar("Growth", 0.2, [
      { label: "Revenue CAGR (3y)", display: asPct(extras.revCagr), score: scale(asPercentPoints(extras.revCagr), 0, 20) },
      { label: "Earnings growth", display: asPct(n("earningsGrowth")), score: scale(asPercentPoints(n("earningsGrowth")), -10, 25) },
      { label: "FCF CAGR (3y)", display: asPct(extras.fcfCagr), score: scale(asPercentPoints(extras.fcfCagr), -5, 15) },
    ]),
    pillar("Momentum & quality", 0.15, [
      {
        label: "Piotroski F",
        display: isNum(extras.fScore) ? `${extras.fScore}/9` : NA,
        score: scale(extras.fScore, 2, 8),
      },
      { label: "Price vs 200-day", display: asPct(extras.vsSma200, 1, true), score: scale(asPercentPoints(extras.vsSma200), -25, 25) },
      { label: "52-week position", display: asPct(extras.rangePos), score: scale(asPercentPoints(extras.rangePos), 0, 100) },
      { label: "Cash conversion", display: ratio(extras.cashConversion), score: scale(extras.cashConversion, 0.5, 1.5) },
    ]),
  ];

  const scored = pillars.filter((p) => isNum(p.score));
  const wsum = scored.reduce((a, p) => a + p.weight, 0);
  const total = wsum ? scored.reduce((a, p) => a + (p.score as number) * p.weight, 0) / wsum : null;

  let band = "Not enough data";
  let blurb = "Too many inputs are missing to score this company.";
  if (isNum(total)) {
    for (const [cut, b, text] of SCORE_BANDS) {
      if (total >= cut) {
        band = b;
        blurb = text;
        break;
      }
    }
  }

  return {
    total,
    band,
    blurb,
    pillars,
    coverage: pillars.reduce((a, p) => a + p.drivers.filter((d) => isNum(d.score)).length, 0),
    totalDrivers: pillars.reduce((a, p) => a + p.drivers.length, 0),
  };
}

export type FlagState = "pass" | "warn" | "fail" | "na";

export interface QualityFlag {
  label: string;
  state: FlagState;
  value: string;
  detail: string;
}

/** A short earnings-quality checklist. Each row states the test, the measured
 *  value, and what a failure would imply — so the conclusion is auditable
 *  rather than asserted. */
export function qualityFlags(co: Company, extras: Extras): QualityFlag[] {
  const out: QualityFlag[] = [];
  const add = (label: string, state: FlagState, value: string, detail: string) =>
    out.push({ label, state, value, detail });

  const band = (v: Num, pass: number, warn: number, higherBetter = true): FlagState => {
    if (!isNum(v)) return "na";
    if (higherBetter) return v >= pass ? "pass" : v >= warn ? "warn" : "fail";
    return v <= pass ? "pass" : v <= warn ? "warn" : "fail";
  };

  const cc = extras.cashConversion;
  add("Cash conversion", band(cc, 1, 0.8), ratio(cc),
    "Operating cash flow versus net income. Below 1.0 for several years suggests profit is not turning into cash.");

  const acc = extras.accruals;
  add("Accruals ratio", band(acc, 0.05, 0.1, false), asPct(acc),
    "(Net income minus operating cash flow) over total assets. High accruals often precede earnings disappointments.");

  const dil = extras.dilution;
  add("Share count", band(dil, 0.005, 0.03, false), asPct(dil, 1, true),
    "Year-on-year change in shares issued. Persistent growth dilutes existing holders' claim on earnings.");

  const gm = extras.gmDelta;
  add("Gross margin trend", !isNum(gm) ? "na" : gm >= 0 ? "pass" : gm > -0.02 ? "warn" : "fail",
    asPct(gm, 1, true),
    "Change in gross margin versus the prior year. Sustained erosion points to pricing or input-cost pressure.");

  const ic = extras.interestCover;
  add("Interest cover", band(ic, 5, 2), ratio(ic),
    "Operating profit over interest expense. Below about 2x leaves little room if earnings fall.");

  const nde = safeDiv(co.netDebt, pickNum(co.info, "ebitda"));
  add("Net debt / EBITDA", band(nde, 2, 3.5, false), ratio(nde),
    "Leverage relative to cash earnings. Above roughly 3.5x is where refinancing risk starts to matter.");

  const fcf = co.baseFcf;
  add("Free cash flow", !isNum(fcf) ? "na" : fcf > 0 ? "pass" : "fail", formatNum(fcf),
    "Cash left after capital spending. Negative FCF means growth is currently funded by debt or share issuance.");

  const rr = extras.receivableGap;
  add("Receivables vs revenue", band(rr, 0.05, 0.15, false), asPct(rr, 1, true),
    "Receivables growing materially faster than revenue can signal looser credit terms pulling sales forward.");

  return out;
}
