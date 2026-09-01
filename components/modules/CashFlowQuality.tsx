"use client";

// Accounting profit is an opinion; cash is a fact. This module tests how much
// of one becomes the other, and what it costs to keep the business running.

import { useMemo } from "react";
import { Section, KpiGrid, Note, EmptyState } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import { bars, line, waterfall, CATEGORY_AXIS, csvFrom } from "@/components/modules/shared";
import { col, isEmpty, last, toDisplay, yearLabels } from "@/lib/data/frame";
import {
  conv, asPct, isNum, money, pickNum, price as fmtPrice, ratio, safeDiv, toneFor } from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";

export default function CashFlowQuality({ co, fx, sym, theme, explainOpen }: ModuleProps) {
  const cfD = useMemo(() => toDisplay(co.annual.cf, fx), [co, fx]);
  const incD = useMemo(() => toDisplay(co.annual.inc, fx), [co, fx]);

  if (isEmpty(cfD)) return <EmptyState message="No cash flow statement available for this symbol." />;

  const x = yearLabels(cfD.periods);
  const ocf = col(cfD, "Operating Cash Flow");
  const capex = col(cfD, "Capital Expenditure");
  let fcf = col(cfD, "Free Cash Flow");
  if (!fcf && ocf && capex) {
    // Capex is reported negative, so free cash flow is an addition.
    fcf = ocf.map((v, i) => (isNum(v) ? v + (isNum(capex[i]) ? (capex[i] as number) : 0) : null));
  }
  const ni = col(incD, "Net Income");

  const lOcf = last(cfD, "Operating Cash Flow");
  const lFcf = fcf ? [...fcf].reverse().find(isNum) ?? null : null;
  const lNi = last(incD, "Net Income");
  const lCapex = isNum(last(cfD, "Capital Expenditure")) ? Math.abs(last(cfD, "Capital Expenditure")!) : null;
  const lRev = last(incD, "Total Revenue");

  const conversion = safeDiv(lOcf, lNi);
  const intensity = safeDiv(lCapex, lOcf);
  const fcfMargin = safeDiv(lFcf, lRev);
  const divPaid = Math.abs(last(cfD, "Cash Dividends Paid") ?? 0);
  const buyback = Math.abs(last(cfD, "Repurchase Of Capital Stock") ?? 0);

  const evMcap = conv(co.marketCap, fx);
  const evDebt = (pickNum(co.info, "totalDebt") ?? 0) * fx;
  const evCash = (pickNum(co.info, "totalCash") ?? 0) * fx;
  // Without a market capitalisation there is no enterprise value to bridge to,
  // so that section is withheld rather than drawn from a zero.
  const evTotal = isNum(evMcap) ? evMcap + evDebt - evCash : null;
  const netPos = evDebt - evCash;

  const intensityWord =
    (intensity ?? 0) < 0.25 ? "asset-light" : (intensity ?? 0) < 0.8 ? "moderately capital-intensive" : "heavily capital-intensive";

  return (
    <>
      <Section
        title="Does the profit turn into cash?"
        sub="Accounting profit is an opinion; cash is a fact. This section tests how much of one becomes the other."
      />

      <KpiGrid
        id="cashflow-headline"
        items={[
          { label: "Operating cash flow", value: money(lOcf, sym), sub: "Latest reported year", tone: (lOcf ?? 0) > 0 ? "good" : "bad" },
          {
            label: "Free cash flow",
            value: money(lFcf, sym),
            sub: `${asPct(fcfMargin)} of revenue`,
            tone: (lFcf ?? 0) > 0 ? "good" : "bad",
            help: "Operating cash flow after capital expenditure: the cash genuinely available to owners and lenders.",
          },
          {
            label: "Cash conversion",
            value: ratio(conversion),
            sub: "Operating cash flow per unit of net income",
            tone: toneFor(conversion, 1.0, 0.7),
            help: "Above 1.0x means reported profit is more than covered by cash.",
          },
          {
            label: "Capital intensity",
            value: asPct(intensity),
            sub: "Capex as a share of operating cash flow",
            tone: toneFor(isNum(intensity) ? intensity * 100 : null, 25, 80, false),
          },
          {
            label: "FCF per share",
            value: fmtPrice(safeDiv(lFcf, co.shares), sym),
            sub: `Price is ${ratio(safeDiv(conv(co.price, fx), safeDiv(lFcf, co.shares)))} of it`,
            tone: "flat",
          },
          {
            label: "Cash returned to owners",
            value: money(divPaid + buyback, sym),
            sub: `Dividends ${money(divPaid, sym)} · buybacks ${money(buyback, sym)}`,
            tone: (lFcf ?? 0) >= divPaid + buyback ? "good" : "warn",
            help: "Distributions funded from free cash flow are sustainable; those funded from debt are not.",
          },
        ]}
      />

      <div className="row two">
        <Figure
          title="Cash from operations against reported profit"
          theme={theme}
          height={320}
          explainOpen={explainOpen}
          what="Operating cash flow (bars) beside net income (dotted line) for each reported year."
          how="Bars **above** the line means cash exceeds accounting profit — usually depreciation and other non-cash charges, which is healthy. Bars persistently **below** the line means profit is being recognised before the cash arrives."
          why="One year below the line is normal for a fast-growing business building receivables and inventory. Several years below it is the classic pattern behind an earnings disappointment."
          data={[
            ...(ocf ? [bars(x, ocf, "Operating cash flow", theme.success)] : []),
            ...(ni ? [line(yearLabels(incD.periods), ni, "Net income", theme.accent, { width: 2.5, dash: "dot", mode: "lines+markers" })] : []),
          ]}
          layout={{ xaxis: CATEGORY_AXIS, yaxis: { title: sym } }}
          csv={csvFrom(x, { ...(ocf ? { "Operating cash flow": ocf } : {}), ...(ni ? { "Net income": ni } : {}) })}
        />

        <Figure
          title="Reinvestment against cash generated"
          theme={theme}
          height={320}
          explainOpen={explainOpen}
          what="Capital expenditure (bars, shown as a positive amount) against operating cash flow (line)."
          how="The gap between line and bars is roughly free cash flow. Bars approaching the line mean almost everything generated is being spent again to keep the business running or growing."
          why={`At ${asPct(intensity)} of operating cash flow, this business is ${intensityWord}. That determines how much of its growth can be self-funded.`}
          data={[
            ...(capex ? [bars(x, capex.map((v) => (isNum(v) ? Math.abs(v) : null)), "Capital expenditure", theme.danger, 0.8)] : []),
            ...(ocf ? [line(x, ocf, "Operating cash flow", theme.success, { width: 2.5, mode: "lines+markers" })] : []),
          ]}
          layout={{ xaxis: CATEGORY_AXIS, yaxis: { title: sym } }}
          csv={csvFrom(x, {
            ...(capex ? { Capex: capex.map((v) => (isNum(v) ? Math.abs(v) : null)) } : {}),
            ...(ocf ? { OCF: ocf } : {}),
          })}
        />
      </div>

      {isNum(lNi) && isNum(lFcf) ? (
        <Figure
          title="From accounting profit to free cash flow"
          theme={theme}
          height={340}
          legend="off"
          explainOpen={explainOpen}
          what="The two adjustments that separate the profit figure in the income statement from the cash left at the end of the year."
          how="The first step adds back non-cash charges and removes working-capital absorption; the second subtracts what was spent on plant, equipment and other long-lived assets. Whichever step is larger is where cash is really being decided."
          why="This is the single most useful chart for a dividend or buyback question: only the final bar can fund distributions without borrowing."
          data={waterfall(
            ["Net income", "Non-cash & working capital", "Capital expenditure", "Free cash flow"],
            [lNi, (lOcf ?? lNi) - lNi, -(lCapex ?? 0), 0],
            ["absolute", "relative", "relative", "total"],
            theme,
          )}
          layout={{ yaxis: { title: sym } }}
        />
      ) : null}

      <Section
        title="Enterprise value bridge"
        sub="What it would cost to acquire the whole business rather than just its equity."
      />

      {!isNum(evMcap) ? (
        <EmptyState
          message="No market capitalisation is available, so the enterprise value bridge cannot be built."
          hint="It needs a live quote. The reported cash flow above does not, which is why it is still shown."
        />
      ) : (
      <div className="row wide-right">
        <KpiGrid
          record={false}
          minWidth={185}
          items={[
            { label: "Market capitalisation", value: money(evMcap, sym), sub: "The equity alone", tone: "flat" },
            { label: "Plus total debt", value: money(evDebt, sym), sub: "Assumed by an acquirer", tone: "flat" },
            { label: "Less cash", value: money(evCash, sym), sub: "Comes with the business", tone: "flat" },
            { label: "Enterprise value", value: money(evTotal, sym), sub: "The cost of the whole business", tone: "flat" },
          ]}
        />
        <Figure
          title="Enterprise value composition"
          theme={theme}
          height={320}
          legend="off"
          explainOpen={explainOpen}
          what="Market capitalisation adjusted for the debt an acquirer would assume and the cash they would receive."
          how="Debt **adds** to the cost of acquiring a business; cash **reduces** it. The further enterprise value sits above market cap, the more of this company is financed by lenders rather than owners."
          why="Enterprise value is the right numerator when comparing companies with different debt loads — which is why EV/EBITDA travels better across peers than P/E does."
          data={waterfall(
            ["Market cap", "Plus debt", "Less cash", "Enterprise value"],
            [evMcap, evDebt, -evCash, 0],
            ["absolute", "relative", "relative", "total"],
            theme,
            true,
          )}
          layout={{ yaxis: { title: sym } }}
        />
      </div>
      )}

      <Note
        id="cashflow-note"
        tone={netPos > 0 && (lFcf ?? 0) < divPaid + buyback ? "warn" : "neu"}
        text={[
          `Enterprise value is **${money(evTotal, sym)}**, against a market capitalisation of ${money(evMcap, sym)}. The company holds a net **${netPos >= 0 ? "debt" : "cash"}** position of ${money(Math.abs(netPos), sym)}.`,
          "",
          `- ${
            netPos >= 0
              ? "Net debt magnifies both returns and risk: interest is paid before shareholders see anything, and refinancing happens on the market's terms rather than the company's."
              : "A net cash position is optionality: it funds downturns, acquisitions and buybacks without needing anyone's permission. It also drags on return on equity while it sits idle."
          }`,
          `- Free cash flow of ${money(lFcf, sym)} covers the ${money(divPaid + buyback, sym)} returned to shareholders ${
            (lFcf ?? 0) > (divPaid + buyback) * 1.2
              ? "comfortably"
              : (lFcf ?? 0) >= divPaid + buyback
                ? "only just"
                : "not at all — the shortfall is being financed"
          }.`,
          `- Cross-check the leverage read against net debt / EBITDA of ${ratio(safeDiv(co.netDebt, pickNum(co.info, "ebitda")))} on the dashboard before drawing a conclusion.`,
        ].join("\n")}
      />
    </>
  );
}
