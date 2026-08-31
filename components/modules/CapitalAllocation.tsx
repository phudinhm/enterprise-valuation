"use client";

// Growth is only worth having if the capital funding it earns more than that
// capital costs. This module measures the spread, then follows where the cash
// actually went.

import { useMemo } from "react";
import { Section, KpiGrid, Note, EmptyState } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import { bars, waterfall, CATEGORY_AXIS, csvFrom } from "@/components/modules/shared";
import { capmWacc, effectiveTaxRate, impliedCostOfDebt } from "@/lib/analytics/valuation";
import { col, isEmpty, last, sum, toDisplay, yearLabels } from "@/lib/data/frame";
import { asPct, clamp, isNum, money, pct, pickNum, safeDiv, toneFor } from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";

/** Total debt plus equity less cash: the capital the operating business
 *  actually has at its disposal, which is what a return should be measured
 *  against. */
function investedCapital(row: Record<string, number | null>): number | null {
  let debt = row["Total Debt"];
  if (!isNum(debt)) {
    const lt = row["Long Term Debt"];
    const st = row["Current Debt"];
    debt = (isNum(lt) ? lt : 0) + (isNum(st) ? st : 0);
  }
  const eq = row["Stockholders Equity"];
  if (!isNum(eq)) return null;
  const cash = row["Cash And Cash Equivalents"];
  return debt + eq - (isNum(cash) ? cash : 0);
}

export default function CapitalAllocation({ co, fx, sym, theme, explainOpen }: ModuleProps) {
  const incD = useMemo(() => toDisplay(co.annual.inc, fx), [co, fx]);
  const bsD = useMemo(() => toDisplay(co.annual.bs, fx), [co, fx]);
  const cfD = useMemo(() => toDisplay(co.annual.cf, fx), [co, fx]);

  if (isEmpty(incD) || isEmpty(bsD)) {
    return <EmptyState message="This module needs both an income statement and a balance sheet." />;
  }

  const taxRate = effectiveTaxRate(last(incD, "Pretax Income"), last(incD, "Tax Provision"));
  const ebitSeries = col(incD, "EBIT") ?? col(incD, "Operating Income");
  if (!ebitSeries) {
    return <EmptyState message="Operating profit is not reported, so ROIC cannot be computed." />;
  }

  // ROIC per period, computed only where the income statement and balance sheet
  // both report the period.
  const incIndex = new Map(incD.periods.map((p, i) => [p, i]));
  const roicRows: { period: string; nopat: number; capital: number; roic: number }[] = [];
  bsD.periods.forEach((period, bi) => {
    const ii = incIndex.get(period);
    if (ii === undefined) return;
    const row = Object.fromEntries(Object.entries(bsD.rows).map(([k, v]) => [k, v[bi] ?? null]));
    const ic = investedCapital(row);
    const ebit = ebitSeries[ii];
    if (!isNum(ic) || ic <= 0 || !isNum(ebit)) return;
    const nopat = ebit * (1 - taxRate);
    roicRows.push({ period, nopat, capital: ic, roic: (nopat / ic) * 100 });
  });

  const beta = pickNum(co.info, "beta") ?? 1.0;
  const costDebt = impliedCostOfDebt(last(incD, "Interest Expense"), last(bsD, "Total Debt"));
  const { wacc, costEquity } = capmWacc(
    beta, co.riskFreeRate, 0.05, costDebt, taxRate,
    (co.marketCap ?? 0) * fx,
    (pickNum(co.info, "totalDebt") ?? last(bsD, "Total Debt") ?? 0) * (pickNum(co.info, "totalDebt") ? fx : 1),
  );
  const waccPct = clamp(wacc, 0.04, 0.2) * 100;

  const latestRoic = roicRows.length ? roicRows[roicRows.length - 1].roic : null;
  const spread = latestRoic !== null ? latestRoic - waccPct : null;

  // Incremental return: the extra NOPAT earned on the extra capital committed.
  let ronic: number | null = null;
  if (roicRows.length >= 2) {
    const dNopat = roicRows[roicRows.length - 1].nopat - roicRows[0].nopat;
    const dIc = roicRows[roicRows.length - 1].capital - roicRows[0].capital;
    if (dIc > 0) ronic = (dNopat / dIc) * 100;
  }

  const ocfTotal = col(cfD, "Operating Cash Flow") ? sum(col(cfD, "Operating Cash Flow")) : null;

  const totalOf = (name: string) => Math.abs(sum(col(cfD, name)));
  const capex = totalOf("Capital Expenditure");
  const acq = totalOf("Purchase Of Business");
  const buyback = totalOf("Repurchase Of Capital Stock");
  const divs = totalOf("Cash Dividends Paid");
  const debtFlow = sum(col(cfD, "Net Issuance Payments Of Debt"));
  const debtRepaid = debtFlow < 0 ? Math.abs(debtFlow) : 0;

  const uses = Object.entries({
    "Capital expenditure": capex,
    Acquisitions: acq,
    Buybacks: buyback,
    Dividends: divs,
    "Debt repaid": debtRepaid,
  }).filter(([, v]) => v > 0);

  const retained = (ocfTotal ?? 0) - uses.reduce((a, [, v]) => a + v, 0);
  const reinvestShare = safeDiv(capex + acq, ocfTotal);
  const returnShare = safeDiv(buyback + divs, ocfTotal);

  return (
    <>
      <Section
        title="Return on invested capital"
        sub="Growth is only worth having if the capital funding it earns more than that capital costs. This section measures the spread, and then follows where the cash actually went."
      />

      <KpiGrid
        id="roic"
        minWidth={205}
        items={[
          {
            label: "ROIC",
            value: pct(latestRoic),
            sub: roicRows.length
              ? `NOPAT ${money(roicRows[roicRows.length - 1].nopat, sym)} on ${money(roicRows[roicRows.length - 1].capital, sym)}`
              : "",
            tone: toneFor(latestRoic, 12, 6),
            help: "After-tax operating profit divided by debt plus equity less cash.",
          },
          {
            label: "WACC",
            value: pct(waccPct),
            sub: `Cost of equity ${asPct(costEquity)} at beta ${beta.toFixed(2)}`,
            tone: "flat",
            help: "The blended cost of the capital funding the business, from CAPM.",
          },
          {
            label: "Spread",
            value: pct(spread, 1, true),
            sub: "ROIC less WACC — value created per unit of capital",
            tone: toneFor(spread, 2, -1),
            help: "Positive means each unit of capital employed earns more than it costs. Negative means growth destroys value however fast revenue climbs.",
          },
          {
            label: "Incremental ROIC",
            value: pct(ronic),
            sub: "Extra NOPAT per unit of extra capital, across the reported period",
            tone: toneFor(ronic, 12, 5),
            help: "The return on the capital most recently committed, which matters far more than the average return on capital committed years ago.",
          },
        ]}
      />

      {roicRows.length ? (
        <Figure
          title="Return on invested capital against its cost"
          theme={theme}
          height={340}
          legend="off"
          explainOpen={explainOpen}
          what="ROIC for each reported year, with the current cost of capital drawn across it. Bars are green where the business earned more than its capital cost and red where it did not."
          how="The **gap** is the whole story. A company earning 18% on capital that costs 8% creates value with every unit it reinvests; one earning 5% on capital that costs 9% destroys value with every unit, and growing faster only destroys it faster."
          why="This is the single test that separates a compounding business from one that is merely large. Revenue growth tells you nothing about it."
          data={[
            bars(
              yearLabels(roicRows.map((r) => r.period)),
              roicRows.map((r) => r.roic),
              "ROIC",
              roicRows.map((r) => (r.roic >= waccPct ? theme.success : theme.danger)),
            ),
          ]}
          layout={{
            xaxis: CATEGORY_AXIS,
            yaxis: { title: "%", ticksuffix: "%" },
            shapes: [
              {
                type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: waccPct, y1: waccPct,
                line: { dash: "dash", color: theme.accent, width: 1.5 },
              },
            ],
            annotations: [
              {
                xref: "paper", x: 0, yref: "y", y: waccPct, text: `WACC ${waccPct.toFixed(1)}%`,
                showarrow: false, yanchor: "bottom", xanchor: "left",
                font: { size: 11.5, color: theme.accent },
              },
            ],
          }}
          csv={csvFrom(
            yearLabels(roicRows.map((r) => r.period)),
            {
              NOPAT: roicRows.map((r) => r.nopat),
              "Invested capital": roicRows.map((r) => r.capital),
              "ROIC %": roicRows.map((r) => r.roic),
            },
          )}
        />
      ) : null}

      <Section
        title="Where the cash went"
        sub="Every unit of cash the business generated, and the choice management made with it."
      />

      {ocfTotal === null ? (
        <EmptyState message="No cash flow history available." />
      ) : (
        <>
          <Figure
            title="Cash deployment across the reported period"
            theme={theme}
            height={380}
            legend="off"
            explainOpen={explainOpen}
            what="Total cash generated from operations, and every use it was put to, summed across all reported years."
            how="Read the relative sizes. Heavy **capital expenditure** means the business must keep feeding itself; heavy **acquisitions** mean growth is being bought rather than built, and should be checked against the ROIC trend above; heavy **buybacks and dividends** mean management could not find enough to reinvest in at an attractive return."
            why="Capital allocation is the decision that compounds. A business with a high ROIC that returns all its cash is a bond; one with a low ROIC that reinvests all of it is a value trap."
            data={waterfall(
              ["Operating cash flow", ...uses.map(([k]) => k), "Left on the balance sheet"],
              [ocfTotal, ...uses.map(([, v]) => -v), 0],
              ["absolute", ...uses.map(() => "relative" as const), "total"],
              theme,
            )}
            layout={{ yaxis: { title: `Cumulative over the reported period (${sym})` } }}
            csv={{
              columns: ["Use", "Amount"],
              rows: [
                ["Operating cash flow", ocfTotal],
                ...uses.map(([k, v]) => [k, v] as [string, number]),
                ["Retained", retained],
              ],
            }}
          />

          <Note
            id="capital-note"
            tone={(spread ?? 0) > 2 ? "pos" : (spread ?? 0) > -1 ? "warn" : "neg"}
            text={[
              `Over the reported period the business generated **${money(ocfTotal, sym)}** from operations and put **${asPct(reinvestShare)}** of it back into the business, returning **${asPct(returnShare)}** to shareholders.`,
              "",
              `- **ROIC of ${pct(latestRoic)} against a cost of capital of ${pct(waccPct)}** means each unit reinvested ${(spread ?? 0) > 0 ? "creates" : "destroys"} value. ${
                (spread ?? 0) > 2
                  ? "Reinvestment is the right call at this spread, and the heavier it is the better — provided incremental returns hold up."
                  : (spread ?? 0) < 1
                    ? "At a spread this thin, returning cash to shareholders is usually the better use of it than reinvestment."
                    : ""
              }`,
              `- **Incremental ROIC of ${pct(ronic)}** is the forward-looking figure: it measures the capital committed most recently, not the legacy asset base. When it runs well below the average ROIC, the returns that built the company's reputation are not being repeated on new money.`,
              `- **Acquisitions of ${money(acq, sym)}** deserve separate scrutiny: they are the deployment route with the worst average outcome across markets, and their effect shows up in ROIC only after the goodwill lands on the balance sheet.`,
            ].join("\n")}
          />
        </>
      )}
    </>
  );
}
