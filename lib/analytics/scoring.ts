// Two long-standing academic screens, both returned with their inputs so the
// conclusion is auditable rather than asserted.

import { isNum, safeDiv, asPct, num as fmtNum, ratio, NA, type Num } from "@/lib/format";

type Row = Record<string, number | null>;

/** Altman Z-score for public manufacturers. Returns null when the inputs
 *  needed for a meaningful score are missing, rather than 0, which would read
 *  as "imminent distress". */
export function altmanZ(bs: Row, inc: Row, mcap: Num): number | null {
  const ta = bs["Total Assets"];
  const tl = bs["Total Liabilities Net Minority Interest"];
  if (!isNum(ta) || ta <= 0 || !isNum(tl) || tl <= 0) return null;
  if (!isNum(mcap) || mcap <= 0) return null;
  const wc = (bs["Current Assets"] ?? 0) - (bs["Current Liabilities"] ?? 0);
  const re = bs["Retained Earnings"] ?? 0;
  const ebit = inc["EBIT"] ?? inc["Operating Income"] ?? 0;
  const sales = inc["Total Revenue"] ?? 0;
  return 1.2 * (wc / ta) + 1.4 * (re / ta) + 3.3 * (ebit / ta) + 0.6 * (mcap / tl) + 1.0 * (sales / ta);
}

export interface PiotroskiTest {
  label: string;
  pass: boolean;
  detail: string;
}

/** The nine Piotroski tests, returned with the individual results so the score
 *  can be explained rather than just asserted. */
export function piotroskiF(
  bs: Row, inc: Row, cf: Row, bsPrev: Row, incPrev: Row,
): { score: number; tests: PiotroskiTest[] } {
  const tests: PiotroskiTest[] = [];
  const add = (label: string, passed: boolean, detail: string) =>
    tests.push({ label, pass: Boolean(passed), detail });

  const ni = inc["Net Income"];
  const ta = bs["Total Assets"];
  const roa = safeDiv(ni, ta);
  const roaPrev = safeDiv(incPrev["Net Income"], bsPrev["Total Assets"]);
  const cfo = cf["Operating Cash Flow"];

  add("Positive net income", isNum(ni) && ni > 0, fmtNum(ni));
  add("Positive operating cash flow", isNum(cfo) && cfo > 0, fmtNum(cfo));
  add(
    "Improving return on assets",
    roa !== null && roaPrev !== null && roa > roaPrev,
    `${asPct(roa)} vs ${asPct(roaPrev)}`,
  );
  add("Cash flow exceeds net income", isNum(cfo) && isNum(ni) && cfo > ni, "accrual quality");

  const lt = bs["Long Term Debt"] ?? 0;
  const ltPrev = bsPrev["Long Term Debt"] ?? 0;
  add("Lower long-term debt", lt <= ltPrev, `${fmtNum(lt)} vs ${fmtNum(ltPrev)}`);

  const cr = safeDiv(bs["Current Assets"], bs["Current Liabilities"]);
  const crPrev = safeDiv(bsPrev["Current Assets"], bsPrev["Current Liabilities"]);
  add(
    "Improving current ratio",
    cr !== null && crPrev !== null && cr > crPrev,
    `${ratio(cr)} vs ${ratio(crPrev)}`,
  );

  const sh = bs["Share Issued"] ?? bs["Ordinary Shares Number"];
  const shPrev = bsPrev["Share Issued"] ?? bsPrev["Ordinary Shares Number"];
  add(
    "No share dilution",
    isNum(sh) && isNum(shPrev) && sh <= shPrev,
    isNum(sh) && isNum(shPrev) ? `${fmtNum(sh, 0)} vs ${fmtNum(shPrev, 0)}` : NA,
  );

  const gm = safeDiv(inc["Gross Profit"], inc["Total Revenue"]);
  const gmPrev = safeDiv(incPrev["Gross Profit"], incPrev["Total Revenue"]);
  add(
    "Improving gross margin",
    gm !== null && gmPrev !== null && gm > gmPrev,
    `${asPct(gm)} vs ${asPct(gmPrev)}`,
  );

  const at = safeDiv(inc["Total Revenue"], ta);
  const atPrev = safeDiv(incPrev["Total Revenue"], bsPrev["Total Assets"]);
  add(
    "Improving asset turnover",
    at !== null && atPrev !== null && at > atPrev,
    `${ratio(at)} vs ${ratio(atPrev)}`,
  );

  return { score: tests.filter((t) => t.pass).length, tests };
}
