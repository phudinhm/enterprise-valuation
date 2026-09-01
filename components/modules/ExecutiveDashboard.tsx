"use client";

// One screen answering: what is the market paying, what is the business
// earning, how solid is the balance sheet, and where are the warning signs.

import { useMemo, useState } from "react";
import {
  Section, SubHead, KpiGrid, Note, Checklist, ScoreBars, EmptyState, Tabs, Card, Eyebrow,
} from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import { bars, line, waterfall, CATEGORY_AXIS, csvFrom, secondaryAxisLayout } from "@/components/modules/shared";
import { buildScorecard, qualityFlags } from "@/lib/analytics/scorecard";
import { grahamNumber } from "@/lib/analytics/valuation";
import { col, last, toDisplay, yearLabels, latestRow, isEmpty } from "@/lib/data/frame";
import {
  asPct, conv, deAsRatio, dividendFacts, fmtDate, isNum, money, pickNum, price as fmtPrice,
  ratio, safeDiv, toneFor, NA,
} from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";

const TABS = [
  "Growth & margins", "Valuation", "Returns", "Balance sheet", "Quality flags", "Dividends", "Profile",
];

export default function ExecutiveDashboard(props: ModuleProps) {
  const { co, extras, fx, sym, targetCurrency, theme, explainOpen } = props;
  const info = co.info;
  const [tab, setTab] = useState(TABS[0]);

  const scorecard = useMemo(() => buildScorecard(co, extras), [co, extras]);
  const incD = useMemo(() => toDisplay(co.annual.inc, fx), [co, fx]);
  const bsD = useMemo(() => toDisplay(co.annual.bs, fx), [co, fx]);
  const cfD = useMemo(() => toDisplay(co.annual.cf, fx), [co, fx]);

  const total = scorecard.total;
  const bandColour = (total ?? 0) >= 65 ? theme.success : (total ?? 0) >= 40 ? theme.warning : theme.danger;

  const pe = pickNum(info, "trailingPE");
  const fcfYield = safeDiv(co.baseFcf, co.marketCap);
  const de = deAsRatio(pickNum(info, "debtToEquity"));
  const ev = pickNum(info, "enterpriseValue");
  const divFacts = dividendFacts(info, co.price);
  const divYield = divFacts.yield;
  const ndEbitda = safeDiv(co.netDebt, pickNum(info, "ebitda"));

  const scored = scorecard.pillars.filter((p) => isNum(p.score));
  const strongest = scored.length ? scored.reduce((a, b) => ((b.score ?? 0) > (a.score ?? 0) ? b : a)) : null;
  const weakest = scored.length ? scored.reduce((a, b) => ((b.score ?? 0) < (a.score ?? 0) ? b : a)) : null;

  const summary = [
    `**${co.name}** is a ${co.industry !== NA ? co.industry.toLowerCase() : "diversified"} business in the`,
    `${co.sector} sector, capitalised at **${money(conv(co.marketCap, fx), sym)}** and trading at`,
    `**${fmtPrice(conv(co.price, fx), sym)}**.`,
    "",
    `- **What the market pays.** ${isNum(pe) && pe > 0 ? `A trailing P/E of ${ratio(pe)}` : "Earnings are negative or unreported, so P/E is not meaningful"}` +
      `${fcfYield !== null ? ` and a free cash flow yield of ${asPct(fcfYield)}` : ""}.` +
      `${isNum(extras.vsSma200) ? ` The shares sit ${asPct(extras.vsSma200, 1, true)} versus their 200-day average` : ""}` +
      `${isNum(extras.rangePos) ? ` and ${(extras.rangePos * 100).toFixed(0)}% of the way up the 52-week range` : ""}.`,
    `- **What the business earns.** Return on equity of ${asPct(pickNum(info, "returnOnEquity"))} on operating margins of ${asPct(pickNum(info, "operatingMargins"))}` +
      `${extras.revCagr !== null && extras.revCagr !== undefined ? `, with revenue compounding at ${asPct(extras.revCagr)} over the reported history` : ""}.`,
    `- **How it is financed.** ${de !== null ? `Debt to equity of ${ratio(de)}` : "Leverage is unreported"} with a current ratio of ${ratio(pickNum(info, "currentRatio"))} and a net ${co.netDebt >= 0 ? "debt" : "cash"} position of ${money(conv(Math.abs(co.netDebt), fx), sym)}.`,
    `- **Where to look next.** ${strongest ? `Strongest pillar: **${strongest.name}** (${(strongest.score ?? 0).toFixed(0)}/100). ` : ""}` +
      `${weakest ? `Weakest: **${weakest.name}** (${(weakest.score ?? 0).toFixed(0)}/100) — start there.` : ""}`,
  ].join("\n");

  return (
    <>
      <Section
        title="Executive summary"
        sub="A single screen answering: what is the market paying, what is the business earning, how solid is the balance sheet, and where are the warning signs."
      />

      <div className="row wide-right">
        <div>
          <div className="card">
            <Eyebrow>Composite screen</Eyebrow>
            <div className="verdict" style={{ marginTop: 8 }}>
              <div>
                <div className="verdict-score" style={{ color: bandColour }}>
                  {total === null ? "—" : total.toFixed(0)}
                  <span style={{ fontSize: 15, color: theme.faint }}>/100</span>
                </div>
                <div className="verdict-band" style={{ color: bandColour }}>
                  {scorecard.band}
                </div>
              </div>
              <div className="verdict-text">
                {scorecard.blurb}
                <br />
                <span style={{ color: theme.faint }}>
                  Built from {scorecard.coverage} of {scorecard.totalDrivers} possible inputs.
                </span>
              </div>
            </div>
          </div>
          <div style={{ height: 10 }} />
          <ScoreBars pillars={scorecard.pillars} theme={theme} />
        </div>

        <Note
          id="exec-summary"
          text={summary}
          tone={(total ?? 0) >= 65 ? "pos" : (total ?? 0) >= 40 ? "warn" : "neg"}
          title="What the numbers say"
        />
      </div>

      <KpiGrid
        id="exec-headline"
        items={[
          {
            label: "Market cap",
            value: money(conv(co.marketCap, fx), sym),
            sub: `Enterprise value ${money(conv(ev, fx), sym)}`,
            tone: "flat",
            help: "Share price times shares outstanding: the value of the equity alone.",
          },
          {
            label: "Trailing P/E",
            value: ratio(pe),
            sub: `Forward ${ratio(pickNum(info, "forwardPE"))}`,
            tone: toneFor(pe, 18, 35, false),
            help: "Price paid per unit of last year's earnings.",
          },
          {
            label: "EV / EBITDA",
            value: ratio(pickNum(info, "enterpriseToEbitda")),
            sub: "Capital-structure neutral",
            tone: toneFor(pickNum(info, "enterpriseToEbitda"), 10, 20, false),
            help: "Enterprise value against cash operating earnings; comparable across different debt levels.",
          },
          {
            label: "FCF yield",
            value: asPct(fcfYield),
            sub: `FCF ${money(conv(co.baseFcf, fx), sym)}`,
            tone: toneFor(isNum(fcfYield) ? fcfYield * 100 : null, 5, 2),
            help: "Free cash flow divided by market cap: the cash return at today's price.",
          },
          {
            label: "Return on equity",
            value: asPct(pickNum(info, "returnOnEquity")),
            sub: `ROA ${asPct(pickNum(info, "returnOnAssets"))}`,
            tone: toneFor(isNum(info.returnOnEquity) ? (info.returnOnEquity as number) * 100 : null, 15, 5),
            help: "Profit generated per unit of shareholder capital.",
          },
          {
            label: "Operating margin",
            value: asPct(pickNum(info, "operatingMargins")),
            sub: `Gross ${asPct(pickNum(info, "grossMargins"))}`,
            tone: toneFor(isNum(info.operatingMargins) ? (info.operatingMargins as number) * 100 : null, 15, 3),
            help: "Profit from core operations as a share of revenue.",
          },
          {
            label: "Net debt / EBITDA",
            value: ratio(ndEbitda),
            sub: `Current ratio ${ratio(pickNum(info, "currentRatio"))}`,
            tone: toneFor(ndEbitda, 2, 4, false),
            help: "Years of cash earnings needed to repay net debt.",
          },
          {
            label: "Dividend yield",
            value: asPct(divYield),
            sub: divFacts.exDate
              ? `Ex-dividend ${fmtDate(divFacts.exDate)}`
              : `Payout ${asPct(divFacts.payout)}`,
            tone: "flat",
            help:
              "Annual dividend per share divided by the current price. Derived from the dividend rate rather " +
              "than the reported yield field, which is inconsistent between data versions.",
          },
        ]}
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "Growth & margins" ? (
        <GrowthMargins {...props} incD={incD} />
      ) : tab === "Valuation" ? (
        <ValuationTab />
      ) : tab === "Returns" ? (
        <ReturnsTab {...props} incD={incD} bsD={bsD} />
      ) : tab === "Balance sheet" ? (
        <BalanceTab {...props} bsD={bsD} />
      ) : tab === "Quality flags" ? (
        <QualityTab />
      ) : tab === "Dividends" ? (
        <DividendsTab {...props} cfD={cfD} />
      ) : (
        <ProfileTab />
      )}
    </>
  );

  // --- tabs ------------------------------------------------------------------

  function GrowthMargins({ incD }: ModuleProps & { incD: ReturnType<typeof toDisplay> }) {
    if (isEmpty(incD) || !col(incD, "Total Revenue")) {
      return <EmptyState message="No income statement history available for this symbol." />;
    }
    const x = yearLabels(incD.periods);
    const revenue = col(incD, "Total Revenue")!;
    const netIncome = col(incD, "Net Income");

    const marginRows: Record<string, (number | null)[]> = {};
    for (const [label, key] of [["Gross", "Gross Profit"], ["Operating", "Operating Income"], ["Net", "Net Income"]] as const) {
      const series = col(incD, key);
      if (series) marginRows[label] = series.map((v, i) => safeDiv(v, revenue[i]) === null ? null : (safeDiv(v, revenue[i])! * 100));
    }

    return (
      <div className="row wide-left">
        <Figure
          title="Revenue against net income"
          theme={theme}
          height={330}
          explainOpen={explainOpen}
          what={`Reported revenue (bars, left axis) and net income (line, right axis) by fiscal year, in ${targetCurrency}.`}
          how="Compare the *slopes*, not the levels: the two axes are scaled independently. Net income pulling away from revenue means operating leverage — fixed costs spread over a bigger base. Net income flattening while revenue climbs means margin compression."
          why={`Revenue has compounded at ${asPct(extras.revCagr)} a year over the reported history. Growth that does not reach the bottom line eventually shows up in the multiple the market is willing to pay.`}
          data={[
            bars(x, revenue, "Revenue", theme.accentSoft),
            ...(netIncome
              ? [{ ...line(x, netIncome, "Net income", theme.success, { width: 3, mode: "lines+markers" }), yaxis: "y2" }]
              : []),
          ]}
          layout={{ xaxis: CATEGORY_AXIS, ...secondaryAxisLayout(`Revenue (${sym})`, `Net income (${sym})`) }}
          csv={csvFrom(x, { Revenue: revenue, ...(netIncome ? { "Net income": netIncome } : {}) })}
        />

        {Object.keys(marginRows).length ? (
          <Figure
            title="Margin structure over time"
            theme={theme}
            height={330}
            explainOpen={explainOpen}
            what="Gross, operating and net margin, each as a percentage of revenue."
            how="The **gap between the lines** is where money goes: gross to operating is overheads and R&D, operating to net is interest and tax. Widening gaps mean costs growing faster than sales."
            why="Margin direction is usually a better early signal than any single year's level, because it reflects pricing power and cost discipline before they reach earnings."
            data={Object.entries(marginRows).map(([label, values], i) =>
              line(x, values, `${label} margin`, [theme.accentSoft, theme.success, theme.warning][i] ?? theme.info, {
                width: 2.5,
                mode: "lines+markers",
              }),
            )}
            layout={{ xaxis: CATEGORY_AXIS, yaxis: { title: "% of revenue", ticksuffix: "%" } }}
            csv={csvFrom(x, marginRows)}
          />
        ) : (
          <EmptyState message="Margin detail is not reported for this symbol." />
        )}
      </div>
    );
  }

  function ValuationTab() {
    const multiples: Record<string, number> = {};
    const candidates: [string, number | null][] = [
      ["Trailing P/E", pickNum(info, "trailingPE")],
      ["Forward P/E", pickNum(info, "forwardPE")],
      ["P/B", pickNum(info, "priceToBook")],
      ["P/S", pickNum(info, "priceToSalesTrailing12Months")],
      ["EV/EBITDA", pickNum(info, "enterpriseToEbitda")],
      ["EV/Revenue", pickNum(info, "enterpriseToRevenue")],
      ["PEG", pickNum(info, "pegRatio", "trailingPegRatio")],
    ];
    for (const [k, v] of candidates) if (isNum(v) && v > 0 && v < 500) multiples[k] = v;

    const target = pickNum(info, "targetMeanPrice");
    const upside = isNum(target) ? (safeDiv(target, co.price) ?? 1) - 1 : null;
    const graham = grahamNumber(pickNum(info, "trailingEps"), pickNum(info, "bookValue"));

    return (
      <div className="row wide-left">
        {Object.keys(multiples).length ? (
          <Figure
            title="Valuation multiples at a glance"
            theme={theme}
            height={300}
            legend="off"
            explainOpen={explainOpen}
            what="Every headline multiple the data source reports for this company, on one scale."
            how="Read across, not down: a high P/E next to a low EV/EBITDA usually means leverage or non-operating items are distorting the equity multiple. PEG below 1.0x means the market is paying less than one unit of P/E per unit of growth."
            why="Absolute multiples say little on their own — the peer comparables module puts these against live peers."
            data={[
              {
                type: "bar",
                orientation: "h",
                x: Object.values(multiples),
                y: Object.keys(multiples),
                marker: { color: theme.accentSoft },
                text: Object.values(multiples).map((v) => `${v.toFixed(1)}x`),
                textposition: "outside",
              },
            ]}
            layout={{ xaxis: { title: "Multiple (x)" }, margin: { l: 110, r: 60, t: 26, b: 40 } }}
            csv={{
              columns: ["Multiple", "Value"],
              rows: Object.entries(multiples).map(([k, v]) => [k, v]),
            }}
          />
        ) : (
          <EmptyState
            message="No valuation multiples reported."
            hint="Common for loss-making or thinly covered names."
          />
        )}

        <div>
          <KpiGrid
            record={false}
            minWidth={210}
            items={[
              {
                label: "Analyst consensus",
                value: ((info.recommendationKey as string) || "none").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                sub: `${pickNum(info, "numberOfAnalystOpinions") ?? NA} contributing analysts`,
                tone: "flat",
              },
              {
                label: "Mean target price",
                value: fmtPrice(conv(target, fx), sym),
                sub: upside !== null ? `${asPct(upside, 1, true)} versus the current price` : "",
                tone: toneFor(upside !== null ? upside * 100 : null, 10, -5),
              },
              {
                label: "Graham number",
                value: fmtPrice(graham !== null ? graham * fx : null, sym),
                sub: "Defensive-investor ceiling: √(22.5 × EPS × book value)",
                tone: "flat",
              },
            ]}
          />
          <Note
            record={false}
            tone="neu"
            title="Reading this panel"
            text="Consensus targets are an input, not an answer: they cluster around the current price and move after it, not before. The intrinsic valuation module builds an independent value from cash flows."
          />
        </div>
      </div>
    );
  }

  function ReturnsTab({ incD, bsD }: ModuleProps & { incD: ReturnType<typeof toDisplay>; bsD: ReturnType<typeof toDisplay> }) {
    const rev = last(incD, "Total Revenue");
    const ni = last(incD, "Net Income");
    const ta = last(bsD, "Total Assets");
    const eq = last(bsD, "Stockholders Equity");
    const netMargin = safeDiv(ni, rev);
    const assetTurn = safeDiv(rev, ta);
    const leverage = safeDiv(ta, eq);
    const roe =
      netMargin !== null && assetTurn !== null && leverage !== null ? netMargin * assetTurn * leverage : null;

    return (
      <div className="row wide-right">
        <KpiGrid
          record={false}
          minWidth={165}
          items={[
            { label: "Net margin", value: asPct(netMargin), sub: "Profit per unit of sales", tone: toneFor(netMargin !== null ? netMargin * 100 : null, 10, 2) },
            { label: "Asset turnover", value: ratio(assetTurn), sub: "Sales per unit of assets", tone: toneFor(assetTurn, 1.0, 0.3) },
            { label: "Equity multiplier", value: ratio(leverage), sub: "Assets per unit of equity", tone: toneFor(leverage, 2.0, 4.0, false) },
            { label: "Return on equity", value: asPct(roe), sub: "Product of the three above", tone: toneFor(roe !== null ? roe * 100 : null, 15, 5) },
          ]}
        />

        {roe !== null ? (
          <Figure
            title="DuPont decomposition of return on equity"
            theme={theme}
            height={310}
            legend="off"
            explainOpen={explainOpen}
            what="How each of the three DuPont components contributes to the final return on equity."
            how="Start from net margin, then see how much of the final ROE comes from turning assets over quickly versus from financing assets with debt. A tall third bar means leverage is doing the work."
            why="Two companies can report identical ROE for completely different reasons. Margin-driven and turnover-driven returns tend to persist; leverage-driven returns reverse when credit tightens."
            data={waterfall(
              ["Net margin", "× Asset turnover", "× Leverage", "= ROE"],
              [
                (netMargin ?? 0) * 100,
                ((netMargin ?? 0) * (assetTurn ?? 0) - (netMargin ?? 0)) * 100,
                ((netMargin ?? 0) * (assetTurn ?? 0) * (leverage ?? 0) - (netMargin ?? 0) * (assetTurn ?? 0)) * 100,
                0,
              ],
              ["absolute", "relative", "relative", "total"],
              theme,
            )}
            layout={{ yaxis: { ticksuffix: "%" } }}
          />
        ) : (
          <EmptyState message="Not enough balance-sheet detail to decompose ROE." />
        )}
      </div>
    );
  }

  function BalanceTab({ bsD }: ModuleProps & { bsD: ReturnType<typeof toDisplay> }) {
    if (isEmpty(bsD)) return <EmptyState message="No balance sheet history available." />;
    const x = yearLabels(bsD.periods);
    const equity = col(bsD, "Stockholders Equity");
    const debt = col(bsD, "Total Debt");
    const totalLiab = col(bsD, "Total Liabilities Net Minority Interest");
    const other = totalLiab
      ? totalLiab.map((v, i) => (isNum(v) ? v - (isNum(debt?.[i]) ? (debt![i] as number) : 0) : null))
      : null;
    const latest = latestRow(bsD);
    const ca = latest["Current Assets"] ?? 0;
    const cl = latest["Current Liabilities"] ?? 0;

    return (
      <div className="row wide-left">
        <Figure
          title="Capital structure over time"
          theme={theme}
          height={320}
          explainOpen={explainOpen}
          what="How the asset base has been funded each year: shareholders' equity, interest-bearing debt, and other liabilities."
          how="Watch the **mix**, not just the height. Debt growing faster than equity means leverage is rising; equity growing while debt is flat usually means retained profits are funding the business."
          why="Capital structure determines who bears the risk. The more of the bar that is debt, the more sensitive equity value is to a downturn in earnings."
          data={[
            ...(equity ? [bars(x, equity, "Equity", theme.success)] : []),
            ...(debt ? [bars(x, debt, "Total debt", theme.danger)] : []),
            ...(other ? [bars(x, other, "Other liabilities", theme.faint, 0.6)] : []),
          ]}
          layout={{ barmode: "stack", xaxis: CATEGORY_AXIS, yaxis: { title: sym } }}
          csv={csvFrom(x, {
            ...(equity ? { Equity: equity } : {}),
            ...(debt ? { "Total debt": debt } : {}),
            ...(other ? { "Other liabilities": other } : {}),
          })}
        />

        <KpiGrid
          record={false}
          minWidth={175}
          items={[
            {
              label: "Working capital",
              value: money(ca - cl, sym),
              sub: "Current assets less current liabilities",
              tone: ca - cl > 0 ? "good" : "bad",
            },
            {
              label: "Cash & equivalents",
              value: money(latest["Cash And Cash Equivalents"], sym),
              sub: "Immediately deployable",
              tone: "flat",
            },
            {
              label: "Goodwill",
              value: money(latest["Goodwill"], sym),
              sub: "Acquisition premium carried on the balance sheet",
              tone: "flat",
            },
            {
              label: "Retained earnings",
              value: money(latest["Retained Earnings"], sym),
              sub: "Cumulative profit kept in the business",
              tone: (latest["Retained Earnings"] ?? 0) > 0 ? "good" : "warn",
            },
          ]}
        />
      </div>
    );
  }

  function QualityTab() {
    const fTests = extras.fTests ?? [];
    const z = extras.zScore;
    return (
      <div className="row wide-left">
        <div>
          <SubHead
            title="Earnings-quality checklist"
            sub="Eight tests on whether reported profit is backed by cash and a sound balance sheet."
          />
          <Checklist rows={qualityFlags(co, extras)} />
        </div>
        <div>
          <SubHead title="Distress and strength scores" sub="Two long-standing academic screens, shown with their inputs." />
          <KpiGrid
            record={false}
            minWidth={210}
            items={[
              {
                label: "Altman Z-score",
                value: ratio(z, 2, ""),
                sub: "Above 3.0 safe · 1.8–3.0 grey zone · below 1.8 distress",
                tone: toneFor(z, 3.0, 1.8),
                help: "A five-factor bankruptcy screen built for public manufacturers; less meaningful for banks and asset-light software.",
              },
              {
                label: "Piotroski F-score",
                value: isNum(extras.fScore) ? `${extras.fScore}/9` : NA,
                sub: "Nine pass/fail tests on profitability, leverage and efficiency",
                tone: toneFor(extras.fScore, 7, 3),
              },
            ]}
          />
          {fTests.length ? (
            <Checklist
              rows={fTests.map((t) => ({
                label: t.label,
                state: t.pass ? "pass" : "fail",
                value: t.detail,
                detail: "",
              }))}
            />
          ) : null}
        </div>
      </div>
    );
  }

  function DividendsTab({ cfD }: ModuleProps & { cfD: ReturnType<typeof toDisplay> }) {
    const divPaid = Math.abs(last(cfD, "Cash Dividends Paid") ?? 0);
    const buyback = Math.abs(last(cfD, "Repurchase Of Capital Stock") ?? 0);
    const fcfNow = (co.baseFcf ?? 0) * fx;
    const mcapNow = conv(co.marketCap, fx);
    const buybackYield = safeDiv(buyback, mcapNow);
    const totalYield = (divYield ?? 0) + (buybackYield ?? 0);
    const cover = divPaid ? safeDiv(fcfNow, divPaid) : null;

    if (!isNum(divYield) && !divPaid) {
      return (
        <EmptyState
          message="This company does not currently pay a dividend."
          hint="Retained cash shows up in the balance sheet and, for buybacks, in the financing section of the cash flow statement."
        />
      );
    }

    // Per-share dividends actually paid, taken from the price history's own
    // actions, summed by calendar year.
    const perYear = new Map<string, number>();
    for (const d of co.dividendHistory) {
      const year = d.date.slice(0, 4);
      perYear.set(year, (perYear.get(year) ?? 0) + d.amount * fx);
    }
    const years = [...perYear.keys()].sort();

    return (
      <>
        <KpiGrid
          id="dividends"
          minWidth={200}
          items={[
            { label: "Dividend yield", value: asPct(divYield), sub: `Five-year average ${asPct(divFacts.fiveYearAvg)}`, tone: "flat" },
            { label: "Annual dividend", value: fmtPrice(conv(divFacts.rate, fx), sym), sub: "Per share, most recent annualised rate", tone: "flat" },
            {
              label: "Ex-dividend date",
              value: fmtDate(divFacts.exDate),
              sub: "Buy before this date to receive the next payment",
              tone: "flat",
              help: "On the ex-dividend date the shares trade without the upcoming payment, and the price typically opens lower by roughly the dividend amount.",
            },
            { label: "Next payment", value: fmtDate(divFacts.payDate), sub: "Date the declared dividend is paid", tone: "flat" },
            {
              label: "Payout ratio",
              value: asPct(divFacts.payout),
              sub: "Share of earnings distributed",
              tone: toneFor(isNum(divFacts.payout) ? divFacts.payout * 100 : null, 60, 90, false),
              help: "Above roughly 80% of earnings leaves little room to keep paying through a weak year.",
            },
            {
              label: "Free cash flow cover",
              value: ratio(cover),
              sub: `FCF ${money(fcfNow, sym)} against ${money(divPaid, sym)} paid`,
              tone: toneFor(cover, 1.5, 1.0),
            },
            { label: "Buyback yield", value: asPct(buybackYield), sub: `${money(buyback, sym)} of stock repurchased`, tone: "flat" },
            {
              label: "Total shareholder yield",
              value: asPct(totalYield),
              sub: "Dividends plus buybacks against market cap",
              tone: "flat",
              help: "The full cash return to owners; a company with no dividend can still return a lot.",
            },
          ]}
        />

        {years.length ? (
          <Figure
            title="Dividends paid per share, by year"
            theme={theme}
            height={300}
            legend="off"
            explainOpen={explainOpen}
            what="Every dividend recorded against the shares, summed by calendar year."
            how="Look for an unbroken, rising staircase. A **flat** run means the real value of the income is being eroded by inflation; a **cut** is the single most reliable signal that management sees pressure it has not yet talked about."
            why="Note that a partial current year will look like a fall simply because not every payment has happened yet."
            data={[bars(years, years.map((y) => perYear.get(y) ?? null), "Dividend per share", theme.accentSoft)]}
            layout={{ xaxis: CATEGORY_AXIS, yaxis: { title: `Dividends per share (${sym})` } }}
            csv={csvFrom(years, { "Dividend per share": years.map((y) => perYear.get(y) ?? null) })}
          />
        ) : divPaid ? (
          <Figure
            title="Total cash paid out as dividends"
            theme={theme}
            height={300}
            legend="off"
            explainOpen={explainOpen}
            what="The cash actually leaving the business as dividends each reported year."
            how="Rising totals with a flat per-share dividend would mean the share count grew. Compare against free cash flow in the cash flow quality module to see whether the payment is funded by the business or by borrowing."
            why="This is the company-level view; the per-share view is what an individual holder receives."
            data={[
              bars(
                yearLabels(cfD.periods),
                (col(cfD, "Cash Dividends Paid") ?? []).map((v) => (isNum(v) ? Math.abs(v) : null)),
                "Dividends paid",
                theme.accentSoft,
              ),
            ]}
            layout={{ xaxis: CATEGORY_AXIS, yaxis: { title: `Total dividends paid (${sym})` } }}
          />
        ) : null}

        <Note
          id="dividend-note"
          tone={(cover ?? 0) > 1.5 ? "pos" : divPaid ? "warn" : "neu"}
          text={[
            `The shares yield **${asPct(divYield)}**, against a five-year average of ${asPct(divFacts.fiveYearAvg)}, and the next ex-dividend date on record is **${fmtDate(divFacts.exDate)}**.`,
            "",
            "- **The ex-dividend date is the one that matters for eligibility.** Buy on or after it and the seller keeps the upcoming payment. The price typically drops by roughly the dividend on that morning, so buying just before it is not free income.",
            `- **Cover, not yield, is the safety question.** Free cash flow covers the dividend ${ratio(cover)} over, and the payout ratio is ${asPct(divFacts.payout)} of earnings. A high yield alongside thin cover is usually the market pricing in a cut rather than an opportunity.`,
            `- **Buybacks count too.** Adding ${asPct(buybackYield)} of repurchases gives a total shareholder yield of ${asPct(totalYield)}, which is the fairer comparison against a company that returns cash a different way.`,
          ].join("\n")}
        />
      </>
    );
  }

  function ProfileTab() {
    const emp = pickNum(info, "fullTimeEmployees");
    const ipo = pickNum(info, "firstTradeDateEpochUtc");
    const facts: [string, string][] = [
      ["Sector", co.sector],
      ["Industry", co.industry],
      ["Employees", isNum(emp) ? emp.toLocaleString("en-US") : NA],
      ["First traded", isNum(ipo) ? fmtDate(ipo * 1000) : NA],
      ["Country", (info.country as string) || NA],
      ["Website", (info.website as string) || NA],
    ];
    return (
      <Card title={co.name}>
        <p>{(info.longBusinessSummary as string) || "No description available."}</p>
        <hr style={{ margin: "14px 0" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14 }}>
          {facts.map(([k, v]) => (
            <div key={k}>
              <div className="eyebrow">{k}</div>
              <div style={{ fontSize: 13, marginTop: 2, overflowWrap: "anywhere" }}>{v}</div>
            </div>
          ))}
        </div>
      </Card>
    );
  }
}
