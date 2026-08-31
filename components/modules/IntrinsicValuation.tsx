"use client";

// What the business is worth on its own cash generation, independent of what
// the market happens to pay for it today.

import { useMemo, useState } from "react";
import { Section, SubHead, KpiGrid, Note, EmptyState, Slider, Segmented, Caption, Eyebrow } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import DataTable from "@/components/ui/DataTable";
import { waterfall } from "@/components/modules/shared";
import { capmWacc, dcf, effectiveTaxRate, grahamNumber, impliedCostOfDebt, impliedGrowth, lynchValue } from "@/lib/analytics/valuation";
import { last, median, toDisplay } from "@/lib/data/frame";
import { asPct, clamp, isNum, money, pickNum, price as fmtPrice, ratio, safeDiv, toneFor } from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";

const FCF_BASES = ["Latest", "Normalised", "Custom"] as const;

interface ScenarioRow {
  scenario: string;
  growth: number;
  discount: number;
  terminal: number;
  fairValue: number;
  upside: number | null;
  probability: number;
}

export default function IntrinsicValuation({ co, extras, fx, sym, targetCurrency, theme, explainOpen }: ModuleProps) {
  const info = co.info;
  const incA = co.annual.inc;
  const bsA = co.annual.bs;

  const taxRate = effectiveTaxRate(last(incA, "Pretax Income"), last(incA, "Tax Provision"));
  const beta = pickNum(info, "beta") ?? 1.0;
  const costDebt = impliedCostOfDebt(
    last(incA, "Interest Expense"),
    pickNum(info, "totalDebt") ?? last(bsA, "Total Debt"),
  );

  const [erpPct, setErpPct] = useState(5.0);
  const erp = erpPct / 100;

  const autoWacc = useMemo(() => {
    const { wacc } = capmWacc(beta, co.riskFreeRate, erp, costDebt, taxRate, co.marketCap, pickNum(info, "totalDebt") ?? 0);
    return clamp(wacc, 0.04, 0.2);
  }, [beta, co.riskFreeRate, erp, costDebt, taxRate, co.marketCap, info]);

  const { costEquity, weightEquity, weightDebt } = capmWacc(
    beta, co.riskFreeRate, erp, costDebt, taxRate, co.marketCap, pickNum(info, "totalDebt") ?? 0,
  );

  // The stage-1 default is the median of reported revenue growth, earnings
  // growth and the multi-year revenue CAGR, capped for conservatism.
  const suggestedGrowth = useMemo(() => {
    const candidates = [
      pickNum(info, "revenueGrowth"),
      pickNum(info, "earningsGrowth"),
      extras.revCagr ?? null,
    ].filter(isNum) as number[];
    const m = candidates.length ? median(candidates) ?? 0.05 : 0.05;
    return clamp(m, 0, 0.15);
  }, [info, extras]);

  const [waccPct, setWaccPct] = useState<number | null>(null);
  const [g1Pct, setG1Pct] = useState<number | null>(null);
  const [years1, setYears1] = useState(5);
  const [termGPct, setTermGPct] = useState(2.5);
  const [fcfBasis, setFcfBasis] = useState<(typeof FCF_BASES)[number]>("Latest");
  const [customFcf, setCustomFcf] = useState<number | null>(null);

  const wacc = (waccPct ?? Number((autoWacc * 100).toFixed(1))) / 100;
  const g1 = (g1Pct ?? Number((suggestedGrowth * 100).toFixed(1))) / 100;
  const termG = termGPct / 100;
  // The fade stage converges from stage 1 toward the terminal rate, so growth
  // decays rather than stopping abruptly.
  const g2 = (g1 + termG) / 2;

  const baseLatest = (co.baseFcf ?? 0) * fx;
  const baseNorm = (co.normalisedFcf ?? 0) * fx;
  const baseFcf =
    fcfBasis === "Latest" ? baseLatest : fcfBasis === "Normalised" ? baseNorm : customFcf ?? baseLatest;

  const shares = co.shares;
  const netDebtDisp = co.netDebt * fx;
  const curPrice = (co.price ?? 0) * fx;

  const result = useMemo(
    () => dcf(baseFcf, g1, years1, g2, wacc, termG, netDebtDisp, shares),
    [baseFcf, g1, years1, g2, wacc, termG, netDebtDisp, shares],
  );

  const implied = useMemo(
    () => impliedGrowth(curPrice, baseFcf, years1, g2, wacc, termG, netDebtDisp, shares),
    [curPrice, baseFcf, years1, g2, wacc, termG, netDebtDisp, shares],
  );

  const scenarios = useMemo<ScenarioRow[]>(() => {
    const defs: [string, number, number, number, number][] = [
      ["Bear", Math.max(g1 - 0.06, -0.15), wacc + 0.015, Math.max(termG - 0.005, 0), 0.25],
      ["Base", g1, wacc, termG, 0.5],
      ["Bull", g1 + 0.05, Math.max(wacc - 0.01, termG + 0.02), Math.min(termG + 0.005, 0.045), 0.25],
    ];
    const rows: ScenarioRow[] = [];
    for (const [name, gg, ww, tt, prob] of defs) {
      const r = dcf(baseFcf, gg, years1, g2, ww, tt, netDebtDisp, shares);
      if (!r) continue;
      rows.push({
        scenario: name,
        growth: gg * 100,
        discount: ww * 100,
        terminal: tt * 100,
        fairValue: r.fairValue,
        upside: curPrice ? (r.fairValue / curPrice - 1) * 100 : null,
        probability: prob * 100,
      });
    }
    return rows;
  }, [baseFcf, g1, years1, g2, wacc, termG, netDebtDisp, shares, curPrice]);

  const weighted = scenarios.reduce((a, s) => a + s.fairValue * (s.probability / 100), 0);

  const sensitivity = useMemo(() => {
    const wLo = Math.max(wacc - 0.02, termG + 0.01);
    const wHi = wacc + 0.02;
    const gLo = Math.max(termG - 0.01, 0);
    const gHi = termG + 0.01;
    const wRange = Array.from({ length: 5 }, (_, i) => wLo + ((wHi - wLo) * i) / 4);
    const gRange = Array.from({ length: 5 }, (_, i) => gLo + ((gHi - gLo) * i) / 4);
    const grid = wRange.map((w) =>
      gRange.map((g) => dcf(baseFcf, g1, years1, g2, w, g, netDebtDisp, shares)?.fairValue ?? null),
    );
    return { wRange, gRange, grid };
  }, [wacc, termG, baseFcf, g1, years1, g2, netDebtDisp, shares]);

  return (
    <>
      <Section
        title="Discounted cash flow"
        sub="What the business is worth on its own cash generation, independent of what the market happens to pay for it today."
      />

      <div className="row wide-right">
        <div>
          <Eyebrow>Assumptions</Eyebrow>
          <Slider
            label="Equity risk premium (%)"
            min={3}
            max={8}
            step={0.25}
            value={erpPct}
            onChange={setErpPct}
            format={(v) => `${v.toFixed(2)}%`}
            help="The extra annual return investors demand for holding equities over government bonds."
          />
          <Slider
            label="Discount rate / WACC (%)"
            min={4}
            max={20}
            step={0.1}
            value={waccPct ?? Number((autoWacc * 100).toFixed(1))}
            onChange={setWaccPct}
            format={(v) => `${v.toFixed(1)}%`}
            help="Pre-filled from CAPM using the live 10-year yield, the reported beta and the company's own after-tax cost of debt."
          />
          <Slider
            label="Stage 1 growth (%)"
            min={-10}
            max={40}
            step={0.5}
            value={g1Pct ?? Number((suggestedGrowth * 100).toFixed(1))}
            onChange={setG1Pct}
            format={(v) => `${v.toFixed(1)}%`}
            help="Free cash flow growth during the explicit forecast."
          />
          <Slider
            label="Stage 1 length (years)"
            min={3}
            max={10}
            step={1}
            value={years1}
            onChange={setYears1}
            format={(v) => `${v}y`}
          />
          <Slider
            label="Terminal growth (%)"
            min={0}
            max={4}
            step={0.1}
            value={termGPct}
            onChange={setTermGPct}
            format={(v) => `${v.toFixed(1)}%`}
            help="Perpetual growth after the fade. Must stay below long-run nominal GDP."
          />

          <div style={{ marginTop: 12 }}>
            <Segmented
              label="Starting cash flow"
              options={FCF_BASES}
              value={fcfBasis}
              onChange={setFcfBasis}
              help="Normalised uses the median free cash flow across reported years, which avoids anchoring the whole model on one unusually good or bad year."
            />
          </div>
          {fcfBasis === "Custom" ? (
            <input
              type="number"
              value={customFcf ?? Math.round(baseLatest)}
              onChange={(e) => setCustomFcf(Number(e.target.value))}
              aria-label={`Free cash flow (${sym})`}
              style={{ marginTop: 8 }}
            />
          ) : null}
          <Caption>
            Latest {money(baseLatest, sym)} · median {money(baseNorm, sym)}
          </Caption>

          <details className="explain">
            <summary>Where these defaults come from</summary>
            <div className="exp-block">
              <p>
                <b>Discount rate {(autoWacc * 100).toFixed(1)}%</b> — CAPM: risk-free{" "}
                {(co.riskFreeRate * 100).toFixed(2)}% (live 10-year Treasury) + beta {beta.toFixed(2)} ×
                equity risk premium {(erp * 100).toFixed(1)}% gives a cost of equity of{" "}
                {(costEquity * 100).toFixed(1)}%. Blended with an after-tax cost of debt of{" "}
                {(costDebt * (1 - taxRate) * 100).toFixed(1)}% at weights {(weightEquity * 100).toFixed(0)}%
                equity / {(weightDebt * 100).toFixed(0)}% debt.
              </p>
              <p>
                <b>Effective tax rate {(taxRate * 100).toFixed(1)}%</b> — tax provision over pre-tax income
                from the latest income statement, clamped to a 0–40% band so a one-off credit cannot distort
                the model.
              </p>
              <p>
                <b>Stage 1 growth {(suggestedGrowth * 100).toFixed(1)}%</b> — the median of reported revenue
                growth, earnings growth and the multi-year revenue CAGR, capped at 15% for conservatism.
              </p>
              <p style={{ marginBottom: 0 }}>
                <b>Fade stage</b> — five further years growing at {(g2 * 100).toFixed(1)}%, halfway between
                stage 1 and the terminal rate, so growth decays rather than stopping abruptly.
              </p>
            </div>
          </details>
        </div>

        <div>
          {!result || !shares ? (
            <EmptyState
              message="The DCF cannot be computed for this symbol."
              hint="It needs a share count and a positive free cash flow figure. Loss-making or cash-burning companies are better approached through the peer comparables module."
            />
          ) : (
            <DcfOutput />
          )}
        </div>
      </div>
    </>
  );

  function DcfOutput() {
    if (!result) return null;
    const fair = result.fairValue;
    const rawUpside = safeDiv(fair, curPrice);
    const upside = rawUpside === null ? null : rawUpside - 1;
    const termShare = result.terminalShare;
    const gap = implied === null ? null : g1 - implied;

    const eps = pickNum(info, "trailingEps");
    const bvps = pickNum(info, "bookValue");
    const methods: [string, number | null][] = [
      ["DCF — base case", fair],
      ["DCF — probability weighted", weighted || null],
      ["Graham number", (grahamNumber(eps, bvps) ?? 0) * fx || null],
      ["Peter Lynch (PEG = 1)", (lynchValue(eps, (pickNum(info, "earningsGrowth") ?? 0) * 100) ?? 0) * fx || null],
      ["Analyst mean target", (pickNum(info, "targetMeanPrice") ?? 0) * fx || null],
      ["52-week high", (pickNum(info, "fiftyTwoWeekHigh") ?? 0) * fx || null],
      ["52-week low", (pickNum(info, "fiftyTwoWeekLow") ?? 0) * fx || null],
    ];
    const validMethods = methods.filter(([, v]) => isNum(v) && v > 0) as [string, number][];

    return (
      <>
        <KpiGrid
          id="dcf-headline"
          minWidth={195}
          items={[
            {
              label: "Fair value per share",
              value: fmtPrice(fair, sym),
              sub: `Against ${fmtPrice(curPrice, sym)} in the market`,
              tone: (upside ?? 0) > 0.1 ? "good" : (upside ?? 0) < -0.1 ? "bad" : "warn",
            },
            {
              label: "Upside to fair value",
              value: asPct(upside, 1, true),
              sub: "Model versus market",
              tone: toneFor(upside !== null ? upside * 100 : null, 10, -10),
            },
            {
              label: "Enterprise value",
              value: money(result.enterpriseValue, sym),
              sub: `Market says ${money((pickNum(info, "enterpriseValue") ?? 0) * fx, sym)}`,
              tone: "flat",
            },
            {
              label: "Value beyond the forecast",
              value: asPct(termShare),
              sub: "Share of value in the terminal figure",
              tone: toneFor(termShare !== null ? termShare * 100 : null, 60, 85, false),
              help: "The higher this is, the more the answer depends on assumptions no one can verify.",
            },
          ]}
        />

        <Figure
          title="How the valuation is built"
          theme={theme}
          height={310}
          legend="off"
          explainOpen={explainOpen}
          what="Present value of the explicit forecast, plus the present value of everything after it, less net debt, giving the value attributable to shareholders."
          how="Look at the relative height of the first two bars. If the terminal bar dwarfs the forecast bar, the model is mostly an opinion about the distant future rather than a projection of the next few years."
          why={`Here ${asPct(termShare)} of enterprise value sits in the terminal figure. Above roughly 75% is normal for a growth company and a reason to weight the sensitivity grid below more heavily than the point estimate.`}
          data={waterfall(
            ["Forecast cash flows", "Terminal value", "Enterprise value", "Net debt", "Equity value"],
            [result.pvExplicit, result.pvTerminal, 0, -netDebtDisp, 0],
            ["absolute", "relative", "total", "relative", "total"],
            theme,
          )}
          layout={{ yaxis: { title: sym } }}
        />

        <SubHead
          title="Reverse DCF — what the market is already assuming"
          sub="Holding your discount rate and terminal assumptions fixed, this solves for the stage-1 growth rate that would exactly justify today's price."
        />

        {implied === null ? (
          <Caption>
            No growth rate within a −60% to +100% range reproduces the current price under these assumptions —
            usually a sign the discount rate or starting cash flow needs revisiting.
          </Caption>
        ) : (
          <>
            <KpiGrid
              id="reverse-dcf"
              minWidth={210}
              items={[
                { label: "Growth priced in by the market", value: asPct(implied), sub: "Stage-1 growth implied by today's price", tone: "flat" },
                { label: "Growth you assumed", value: asPct(g1), sub: "Your stage-1 input", tone: "flat" },
                {
                  label: "Difference",
                  value: asPct(gap, 1, true),
                  sub: "Positive means you are more optimistic than the market",
                  tone: (gap ?? 0) > 0.01 ? "good" : (gap ?? 0) < -0.01 ? "bad" : "warn",
                },
              ]}
            />
            <Note
              id="reverse-dcf-note"
              tone={(gap ?? 0) > 0 ? "pos" : "warn"}
              text={[
                `At ${fmtPrice(curPrice, sym)}, the market is implicitly assuming free cash flow grows about **${asPct(implied)}** a year through stage 1.`,
                "",
                `- The useful question is not "is the fair value right" but **"is that implied growth achievable?"** Compare it against the company's own history: revenue has compounded at ${asPct(extras.revCagr)} over the reported period.`,
                `- ${
                  (gap ?? 0) > 0
                    ? "You are assuming faster growth than the market, which is where the upside in this model comes from. That view needs a reason: a product cycle, a margin programme, an end-market shift."
                    : "You are assuming slower growth than the market, so this model shows downside. The market may be seeing something your assumptions do not capture."
                }`,
                "- A reverse DCF sidesteps the biggest weakness of a forward DCF: it stops you arguing with a point estimate and makes you argue with an assumption instead.",
              ].join("\n")}
            />
          </>
        )}

        <SubHead title="Scenarios" sub="The same model under three futures, with a probability-weighted result." />
        {scenarios.length ? (
          <div className="row wide-left">
            <DataTable
              title="Scenario outcomes"
              what="Each scenario flexes growth, the discount rate and terminal growth together, the way they actually move."
              columns={[
                { key: "scenario", header: "Scenario", render: (r: ScenarioRow) => r.scenario, align: "left" },
                { key: "growth", header: "Stage 1 growth", render: (r: ScenarioRow) => `${r.growth.toFixed(1)}%` },
                { key: "discount", header: "Discount rate", render: (r: ScenarioRow) => `${r.discount.toFixed(1)}%` },
                { key: "terminal", header: "Terminal growth", render: (r: ScenarioRow) => `${r.terminal.toFixed(1)}%` },
                { key: "fair", header: "Fair value", render: (r: ScenarioRow) => fmtPrice(r.fairValue, sym) },
                { key: "upside", header: "Upside", render: (r: ScenarioRow) => (isNum(r.upside) ? `${r.upside >= 0 ? "+" : ""}${r.upside.toFixed(1)}%` : "—") },
                { key: "prob", header: "Probability", render: (r: ScenarioRow) => `${r.probability.toFixed(0)}%` },
              ]}
              rows={scenarios}
              rowKey={(r) => r.scenario}
            />
            <KpiGrid
              record={false}
              minWidth={200}
              items={[
                {
                  label: "Probability-weighted value",
                  value: fmtPrice(weighted, sym),
                  sub: `${asPct(curPrice ? weighted / curPrice - 1 : null, 1, true)} versus market`,
                  tone: toneFor(curPrice ? (weighted / curPrice - 1) * 100 : null, 10, -10),
                },
                {
                  label: "Range width",
                  value: fmtPrice(
                    Math.max(...scenarios.map((s) => s.fairValue)) - Math.min(...scenarios.map((s) => s.fairValue)),
                    sym,
                  ),
                  sub: "Bull less bear — the honest uncertainty",
                  tone: "flat",
                },
              ]}
            />
          </div>
        ) : null}

        <SubHead title="Sensitivity" sub="Fair value across a grid of discount rates and terminal growth rates." />
        <Figure
          title="Fair value sensitivity to discount rate and terminal growth"
          theme={theme}
          height={330}
          legend="off"
          explainOpen={explainOpen}
          what={`Fair value per share in ${targetCurrency} across a grid around your base assumptions. The market price today is ${fmtPrice(curPrice, sym)}.`}
          how="Find the cells at or above the current price. If most of the grid clears it, the conclusion survives a range of reasonable assumptions. If only the top-right corner does — lowest discount rate, highest terminal growth — the case depends on everything going right."
          why="A DCF's honest output is a range, not a number. This grid is that range."
          data={[
            {
              type: "heatmap",
              z: sensitivity.grid,
              x: sensitivity.gRange.map((g) => `${(g * 100).toFixed(1)}%`),
              y: sensitivity.wRange.map((w) => `${(w * 100).toFixed(1)}%`),
              colorscale: "RdYlGn",
              text: sensitivity.grid.map((row) => row.map((v) => (isNum(v) ? v.toFixed(0) : "—"))),
              texttemplate: "%{text}",
              textfont: { size: 11 },
              colorbar: { title: { text: `Value (${sym})` } },
              hovertemplate: "Discount %{y} · terminal %{x}<br>%{z:,.2f}<extra></extra>",
            },
          ]}
          layout={{
            xaxis: { title: "Terminal growth", type: "category" },
            yaxis: { title: "Discount rate", type: "category", autorange: "reversed" },
          }}
          csv={{
            columns: ["Discount rate", ...sensitivity.gRange.map((g) => `${(g * 100).toFixed(1)}%`)],
            rows: sensitivity.wRange.map((w, i) => [`${(w * 100).toFixed(1)}%`, ...sensitivity.grid[i]]),
          }}
        />

        <SubHead
          title="Valuation summary across methods"
          sub="Every independent estimate this app can compute, on one scale, against the market price."
        />
        {validMethods.length ? (
          <Figure
            title="Independent value estimates against the market price"
            theme={theme}
            height={330}
            legend="off"
            explainOpen={explainOpen}
            what="Each bar is a separate method's implied value per share; the dashed line is what the market is charging today."
            how="Bars to the **right** of the line imply the shares are cheap on that method; to the **left**, expensive. Agreement between methods that rest on different inputs — cash flows, book value, earnings — is far more persuasive than any single bar."
            why="Methods disagreeing sharply is information too: it usually means one input (a one-off earnings item, an unusual balance sheet, an aggressive growth assumption) is doing all the work."
            data={[
              {
                type: "bar",
                orientation: "h",
                x: validMethods.map(([, v]) => v),
                y: validMethods.map(([k]) => k),
                marker: { color: validMethods.map(([, v]) => (v > curPrice ? theme.success : theme.danger)) },
                text: validMethods.map(([, v]) => fmtPrice(v, sym)),
                textposition: "outside",
                opacity: 0.85,
              },
            ]}
            layout={{
              xaxis: { title: `Implied value per share (${sym})` },
              margin: { l: 190, r: 80, t: 26, b: 44 },
              shapes: [
                { type: "line", x0: curPrice, x1: curPrice, yref: "paper", y0: 0, y1: 1, line: { dash: "dash", color: theme.text, width: 2 } },
              ],
              annotations: [
                { x: curPrice, yref: "paper", y: 1, text: "Market price", showarrow: false, yanchor: "bottom", font: { size: 11.5, color: theme.text } },
              ],
            }}
            csv={{ columns: ["Method", "Implied value"], rows: validMethods.map(([k, v]) => [k, v]) }}
          />
        ) : null}

        <Note
          id="dcf-note"
          tone={(upside ?? 0) > 0.1 ? "pos" : (upside ?? 0) < -0.1 ? "neg" : "neu"}
          text={[
            `On these assumptions the model puts fair value at **${fmtPrice(fair, sym)}**, against a market price of ${fmtPrice(curPrice, sym)} — a gap of **${asPct(upside, 1, true)}**.`,
            "",
            "- **The two inputs that matter most** are the discount rate and the starting cash flow. A one-point change in the discount rate moves the answer far more than a one-point change in growth, because it compounds through every discount factor and through the terminal value.",
            `- **Before trusting the gap**, check that the starting free cash flow of ${money(baseFcf, sym)} is representative rather than a peak or a trough — the Normalised option uses the median of reported years for exactly this reason.`,
            "- **A large gap is not proof the market is wrong.** More often it means your growth or risk assumptions differ from consensus, which the reverse DCF above makes explicit.",
          ].join("\n")}
        />
      </>
    );
  }
}
