"use client";

// Leverage only matters when refinancing or earnings turn against you. This
// module sizes both.

import { useMemo, useState } from "react";
import { Section, KpiGrid, Note, EmptyState, Slider } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import DataTable from "@/components/ui/DataTable";
import { bars } from "@/components/modules/shared";
import { isEmpty, last, latestRow, toDisplay } from "@/lib/data/frame";
import { asPct, isNum, money, pickNum, ratio, safeDiv, toneFor } from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";

interface Scenario {
  bump: number;
  interest: number;
  cover: number | null;
  profitAfter: number;
}

export default function Solvency({ co, fx, sym, theme, explainOpen }: ModuleProps) {
  const [shock, setShock] = useState(200);

  const incD = useMemo(() => toDisplay(co.annual.inc, fx), [co, fx]);
  const bsD = useMemo(() => toDisplay(co.annual.bs, fx), [co, fx]);
  const cfD = useMemo(() => toDisplay(co.annual.cf, fx), [co, fx]);

  if (isEmpty(bsD)) return <EmptyState message="No balance sheet available for this symbol." />;

  const latest = latestRow(bsD);
  const currentDebt = latest["Current Debt"];
  const longDebt = latest["Long Term Debt"];
  let totalDebt = latest["Total Debt"];
  if (!isNum(totalDebt)) {
    totalDebt = (isNum(currentDebt) ? currentDebt : 0) + (isNum(longDebt) ? longDebt : 0);
  }
  const cash = latest["Cash And Cash Equivalents"];
  const netDebt = totalDebt - (isNum(cash) ? cash : 0);

  let ebitda = (pickNum(co.info, "ebitda") ?? 0) * fx;
  if (!ebitda) {
    const op = last(incD, "EBIT") ?? last(incD, "Operating Income");
    const da = last(cfD, "Depreciation And Amortization");
    ebitda = (op ?? 0) + (da ?? 0);
  }
  const ebit = last(incD, "EBIT") ?? last(incD, "Operating Income");
  const interest = Math.abs(last(incD, "Interest Expense") ?? 0);
  const cover = interest ? safeDiv(ebit, interest) : null;
  const avgRate = safeDiv(interest, totalDebt);

  const ladder = {
    "Due within 1 year": isNum(currentDebt) ? currentDebt : 0,
    "Due beyond 1 year": isNum(longDebt) ? longDebt : 0,
  };
  const ladderTotal = Object.values(ladder).reduce((a, b) => a + b, 0);

  const scenarios: Scenario[] =
    isNum(ebit) && totalDebt
      ? [0, shock / 2, shock, shock * 1.5].map((bump) => {
          const newInterest = interest + totalDebt * (bump / 10000);
          return {
            bump,
            interest: newInterest,
            cover: safeDiv(ebit, newInterest),
            profitAfter: ebit - newInterest,
          };
        })
      : [];

  const breaking = scenarios.find((s) => isNum(s.cover) && s.cover < 2)?.bump ?? null;

  return (
    <>
      <Section
        title="Can the balance sheet take a shock?"
        sub="Leverage only matters when refinancing or earnings turn against you. This section sizes both."
      />

      <KpiGrid
        id="solvency"
        minWidth={200}
        items={[
          {
            label: "Total debt",
            value: money(totalDebt, sym),
            sub: `Cash ${money(cash, sym)} · net debt ${money(netDebt, sym)}`,
            tone: "flat",
          },
          {
            label: "Net debt / EBITDA",
            value: ratio(safeDiv(netDebt, ebitda)),
            sub: "Years of cash earnings to repay net borrowings",
            tone: toneFor(safeDiv(netDebt, ebitda), 2, 4, false),
            help: "Above roughly 3.5x is where lenders start attaching conditions and refinancing gets harder.",
          },
          {
            label: "Interest cover",
            value: ratio(cover),
            sub: `Operating profit ${money(ebit, sym)} against interest ${money(interest, sym)}`,
            tone: toneFor(cover, 5, 2),
            help: "How many times over current earnings pay the interest bill. Below 2x leaves no room for a bad year.",
          },
          {
            label: "Average borrowing rate",
            value: asPct(avgRate),
            sub: "Interest expense over total debt",
            tone: toneFor(isNum(avgRate) ? avgRate * 100 : null, 4, 8, false),
            help: "A rate well below current market rates means cheap legacy debt that will reprice upward as it matures.",
          },
          {
            label: "Due within a year",
            value: money(currentDebt, sym),
            sub: `${asPct(safeDiv(currentDebt, totalDebt))} of total borrowings`,
            tone: toneFor(isNum(currentDebt) ? (safeDiv(currentDebt, totalDebt) ?? 0) * 100 : null, 15, 40, false),
          },
        ]}
      />

      {ladderTotal > 0 ? (
        <Figure
          title="Debt maturity profile, as reported"
          theme={theme}
          height={320}
          legend="off"
          explainOpen={explainOpen}
          what="Borrowings split into the portion falling due within twelve months and the portion beyond it."
          how={`Compare the left bar against cash of ${money(cash, sym)} and free cash flow of ${money((co.baseFcf ?? 0) * fx, sym)}. If near-term maturities exceed both, the company must refinance, and it will do so on whatever terms the market offers at the time.`}
          why="A full year-by-year ladder is disclosed only in the notes to the accounts, which this data source does not carry — the primary filing linked in the Financial Statements module has it. The same applies to the fixed-versus-floating split, which is a note-level disclosure."
          data={[
            {
              ...bars(Object.keys(ladder), Object.values(ladder), "Debt", [theme.danger, theme.accentSoft]),
              text: Object.values(ladder).map((v) => money(v, sym)),
              textposition: "outside",
            },
          ]}
          layout={{ yaxis: { title: sym } }}
          csv={{ columns: ["Bucket", "Amount"], rows: Object.entries(ladder) }}
        />
      ) : null}

      <Section
        title="Refinancing stress test"
        sub="What happens to interest cover if this debt is refinanced at higher rates."
      />

      <div className="controls">
        <Slider
          label="Increase in borrowing cost (basis points)"
          min={0}
          max={600}
          step={25}
          value={shock}
          onChange={setShock}
          format={(v) => `+${v}bp`}
          help="Applied to total debt, i.e. the fully-repriced case rather than only the portion maturing soon."
        />
      </div>

      {scenarios.length ? (
        <>
          <div className="row wide-left">
            <Figure
              title="Interest cover under higher borrowing costs"
              theme={theme}
              height={330}
              legend="off"
              explainOpen={explainOpen}
              what="Operating profit divided by the interest bill, if all debt repriced upward by the amount shown."
              how="Watch where the bars cross the dotted line. That is the increase in rates at which this company stops comfortably covering its interest from operating profit — and therefore the point at which covenants, credit ratings and dividend policy come under real pressure."
              why="It assumes operating profit stays flat, which is the optimistic case: rates usually rise because the economy is running hot, and they bite hardest when it subsequently is not."
              data={[
                {
                  ...bars(
                    scenarios.map((s) => `+${Math.round(s.bump)}bp`),
                    scenarios.map((s) => s.cover),
                    "Interest cover",
                    scenarios.map((s) =>
                      (s.cover ?? 0) >= 3 ? theme.success : (s.cover ?? 0) >= 1.5 ? theme.warning : theme.danger,
                    ),
                  ),
                  text: scenarios.map((s) => ratio(s.cover, 1)),
                  textposition: "outside",
                },
              ]}
              layout={{
                yaxis: { title: "Interest cover (x)" },
                shapes: [
                  { type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: 2, y1: 2, line: { dash: "dot", color: theme.danger, width: 1.5 } },
                ],
                annotations: [
                  {
                    xref: "paper", x: 0.99, yref: "y", y: 2, text: "2.0x — the level lenders watch",
                    showarrow: false, yanchor: "bottom", xanchor: "right",
                    font: { size: 11.5, color: theme.danger },
                  },
                ],
              }}
              csv={{
                columns: ["Rate increase (bps)", "Interest expense", "Interest cover", "Profit after interest"],
                rows: scenarios.map((s) => [s.bump, s.interest, s.cover, s.profitAfter]),
              }}
            />

            <DataTable
              title="Stress scenarios"
              what="Each row repriced the whole debt stack, holding operating profit constant."
              columns={[
                { key: "bump", header: "Rate increase", render: (s: Scenario) => `+${Math.round(s.bump)}bp`, align: "left" },
                { key: "interest", header: "Interest expense", render: (s: Scenario) => money(s.interest, sym) },
                { key: "cover", header: "Interest cover", render: (s: Scenario) => ratio(s.cover) },
                { key: "profit", header: "Profit after interest", render: (s: Scenario) => money(s.profitAfter, sym) },
              ]}
              rows={scenarios}
              rowKey={(s) => String(s.bump)}
            />
          </div>

          <Note
            id="solvency-note"
            tone={(cover ?? 0) >= 5 ? "pos" : (cover ?? 0) >= 2 ? "warn" : "neg"}
            text={[
              `Interest cover today is **${ratio(cover)}**, on an average borrowing cost of **${asPct(avgRate)}**.`,
              "",
              `- ${
                breaking !== null
                  ? `A ${Math.round(breaking)} basis point rise in borrowing costs would take cover below 2.0x, the level at which lenders and rating agencies start to react.`
                  : `Even a ${Math.round(shock * 1.5)} basis point rise leaves cover above 2.0x on current earnings, which is a genuinely resilient position.`
              }`,
              `- **${money(currentDebt, sym)} falls due within a year**, against cash of ${money(cash, sym)}. That is the immediate refinancing question, and it is answered by the balance sheet rather than by the income statement.`,
              `- **The average rate paid (${asPct(avgRate)}) versus current market rates** tells you which direction the interest bill is heading. Cheap legacy debt is an asset that quietly expires.`,
              "- A year-by-year maturity ladder and the fixed-versus-floating split are note-level disclosures. This module shows what the summary statements carry; the primary filing has the rest.",
            ].join("\n")}
          />
        </>
      ) : (
        <EmptyState
          message="Not enough detail to run the stress test."
          hint="It needs reported operating profit and a debt balance."
        />
      )}
    </>
  );
}
