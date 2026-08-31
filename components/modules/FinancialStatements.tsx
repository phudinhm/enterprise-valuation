"use client";

// Reported line items on an Annual, Quarterly or TTM basis, common-size figures
// beside live industry medians, a line-by-line explanation of every reported
// item, and a link to the market's primary filing source.

import { useMemo, useState } from "react";
import { Section, Caption, EmptyState, Tabs, Segmented, Card, Loading } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { waterfall, CATEGORY_AXIS, line, csvFrom } from "@/components/modules/shared";
import { LINE_ITEMS, SECTOR_COST_NOTES } from "@/lib/glossary";
import { filingSource } from "@/lib/constants";
import {
  col, isEmpty, last, latestRow, tailOne, toDisplay, ttmFromQuarters, yearLabels,
} from "@/lib/data/frame";
import type { Statement } from "@/lib/data/frame";
import { asPct, cagr, isNum, money, pickNum, safeDiv, NA } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { ModuleProps } from "@/components/modules/types";
import type { IndustryBenchmark } from "@/lib/data/types";

const VIEWS = ["Reported", "Common size", "Growth"] as const;
type View = (typeof VIEWS)[number];
const TABS = ["Income statement", "Balance sheet", "Cash flow", "Line by line"];
const LINE_GROUPS = ["Income statement lines", "Balance sheet lines", "Cash flow lines"];

export default function FinancialStatements(props: ModuleProps) {
  const { co, fx, sym, targetCurrency, theme, basis, explainOpen } = props;
  const [view, setView] = useState<View>("Reported");
  const [tab, setTab] = useState(TABS[0]);
  const [bridgeIndex, setBridgeIndex] = useState<number | null>(null);
  const [lineGroup, setLineGroup] = useState(LINE_GROUPS[0]);

  // Balance sheet items are stocks, not flows, so TTM uses the most recent
  // quarterly balance sheet rather than a sum.
  const { inc, bs, cf } = useMemo(() => {
    if (basis === "Quarterly") return co.quarterly;
    if (basis === "TTM") {
      return {
        inc: ttmFromQuarters(co.quarterly.inc),
        bs: isEmpty(co.quarterly.bs) ? tailOne(co.annual.bs) : tailOne(co.quarterly.bs),
        cf: ttmFromQuarters(co.quarterly.cf),
      };
    }
    return co.annual;
  }, [co, basis]);

  const incD = useMemo(() => toDisplay(inc, fx), [inc, fx]);
  const bsD = useMemo(() => toDisplay(bs, fx), [bs, fx]);
  const cfD = useMemo(() => toDisplay(cf, fx), [cf, fx]);

  // The same live peer matching the comparables module uses, so the common-size
  // view always has something to be compared against.
  const { data: peerData } = useApi<{ peers: string[] }>(
    `/api/peers?ticker=${encodeURIComponent(co.ticker)}&sector=${encodeURIComponent(co.sector)}&industry=${encodeURIComponent(co.industry)}`,
  );
  const peerList = peerData?.peers ?? [];
  const { data: bench, loading: benchLoading } = useApi<IndustryBenchmark>(
    view === "Common size" && peerList.length ? `/api/industry?tickers=${peerList.join(",")}` : null,
  );

  const src = filingSource(co.ticker);

  if (isEmpty(incD) && isEmpty(bsD) && isEmpty(cfD)) {
    return (
      <EmptyState
        message={`No ${basis.toLowerCase()} statements available for this symbol.`}
        hint="Quarterly detail is often missing outside the United States; try the Annual basis."
      />
    );
  }

  return (
    <>
      <Section
        title={`Reported financials — ${basis} basis`}
        sub={
          `As-reported line items in ${targetCurrency}` +
          (basis === "TTM" ? " (last four quarters summed for flow items)." : ".") +
          " Use the view switch to move between absolute figures, common-size percentages and growth rates."
        }
      />

      <Card title="Where these numbers come from" style={{ marginBottom: 14 }}>
        Figures here are the data provider&apos;s normalised version of {co.name}&apos;s filings. The primary
        source for this market is{" "}
        {src.url ? (
          <a href={src.url} target="_blank" rel="noopener noreferrer">
            {src.name}
          </a>
        ) : (
          <b>{src.name}</b>
        )}
        .
        <br />
        <span style={{ color: "var(--muted)" }}>{src.rhythm}</span>
      </Card>

      <Segmented
        label="View"
        options={VIEWS}
        value={view}
        onChange={setView}
        help="Common size expresses each line as a share of revenue (or total assets on the balance sheet) and adds the industry median beside it. Growth shows the period-on-period change."
      />

      {view === "Common size" ? (
        benchLoading ? (
          <Loading label="Building the industry benchmark from live peers…" />
        ) : bench?.n ? (
          <Caption>
            Industry median columns are computed live from {bench.n} peers matched on{" "}
            {co.industry !== NA ? co.industry : co.sector} ({peerList.slice(0, 6).join(", ")}
            {peerList.length > 6 ? "…" : ""}). Each peer is expressed as a share of its own revenue or assets
            before the median is taken, so size differences do not distort the comparison.
          </Caption>
        ) : (
          <Caption>
            No live peer group resolved for this company right now, so the industry median columns are omitted
            rather than filled with a placeholder.
          </Caption>
        )
      ) : null}

      <div style={{ height: 14 }} />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "Income statement" ? (
        isEmpty(incD) ? (
          <EmptyState message="No income statement on this basis." />
        ) : (
          <div className="row wide-left">
            <div className="stack">
              <StatementBlock
                statement={incD}
                items={["Total Revenue", "Cost Of Revenue", "Gross Profit"]}
                title="Revenue and gross profit"
                what="What the company sold and what it kept after the direct cost of selling it."
                base={col(incD, "Total Revenue")}
                benchKey="income"
              />
              <StatementBlock
                statement={incD}
                items={["Operating Expense", "Research And Development", "Selling General And Administration", "Operating Income"]}
                title="Operating costs and operating profit"
                what="The overhead layer between gross profit and profit from operations."
                base={col(incD, "Total Revenue")}
                benchKey="income"
              />
              <StatementBlock
                statement={incD}
                items={[
                  "Net Non Operating Interest Income Expense", "Interest Expense", "Other Income Expense",
                  "Pretax Income", "Tax Provision", "Net Income", "Basic EPS", "Diluted EPS",
                ]}
                title="Below the operating line"
                what="Financing costs, tax, and what finally reaches shareholders."
                base={col(incD, "Total Revenue")}
                benchKey="income"
              />
            </div>
            <ProfitBridge />
          </div>
        )
      ) : tab === "Balance sheet" ? (
        isEmpty(bsD) ? (
          <EmptyState message="No balance sheet on this basis." />
        ) : (
          <div className="row wide-left">
            <div className="stack">
              <StatementBlock
                statement={bsD}
                items={["Cash And Cash Equivalents", "Other Short Term Investments", "Accounts Receivable", "Inventory", "Current Assets"]}
                title="Current assets"
                what="Resources expected to convert to cash within a year."
                base={col(bsD, "Total Assets")}
                benchKey="balance"
              />
              <StatementBlock
                statement={bsD}
                items={["Net PPE", "Goodwill", "Other Intangible Assets", "Total Non Current Assets", "Total Assets"]}
                title="Non-current assets"
                what="The long-lived asset base."
                base={col(bsD, "Total Assets")}
                benchKey="balance"
              />
              <StatementBlock
                statement={bsD}
                items={["Accounts Payable", "Current Debt", "Current Liabilities", "Long Term Debt", "Total Non Current Liabilities", "Total Liabilities Net Minority Interest"]}
                title="Liabilities"
                what="What is owed, split by when it falls due."
                base={col(bsD, "Total Assets")}
                benchKey="balance"
              />
              <StatementBlock
                statement={bsD}
                items={["Common Stock", "Retained Earnings", "Stockholders Equity"]}
                title="Equity"
                what="The shareholders' residual claim."
                base={col(bsD, "Total Assets")}
                benchKey="balance"
              />
            </div>
            <BalanceCharts />
          </div>
        )
      ) : tab === "Cash flow" ? (
        isEmpty(cfD) ? (
          <EmptyState message="No cash flow statement on this basis." />
        ) : (
          <div className="stack">
            <StatementBlock
              statement={cfD}
              items={["Net Income", "Depreciation And Amortization", "Stock Based Compensation", "Change In Working Capital", "Operating Cash Flow"]}
              title="Operating activities"
              what="Cash generated by running the business."
            />
            <StatementBlock
              statement={cfD}
              items={["Capital Expenditure", "Purchase Of Business", "Net Investment Purchase And Sale", "Investing Cash Flow"]}
              title="Investing activities"
              what="Cash spent on, or released by, the asset base."
            />
            <StatementBlock
              statement={cfD}
              items={["Net Issuance Payments Of Debt", "Repurchase Of Capital Stock", "Cash Dividends Paid", "Financing Cash Flow"]}
              title="Financing activities"
              what="Cash exchanged with lenders and shareholders."
            />
            <StatementBlock
              statement={cfD}
              items={["Free Cash Flow", "End Cash Position"]}
              title="Summary"
              what="The bottom line of the cash statement."
            />
          </div>
        )
      ) : (
        <LineByLine />
      )}
    </>
  );

  // --- one grouped block of a statement, in the selected view ---------------

  function StatementBlock({
    statement, items, title, what, base, benchKey,
  }: {
    statement: Statement;
    items: string[];
    title: string;
    what: string;
    base?: (number | null)[] | null;
    benchKey?: "income" | "balance";
  }) {
    const present = items.filter((i) => statement.rows[i]);
    if (!present.length) return null;

    // Periods run newest-first, and periods with nothing in them are dropped:
    // the oldest reported year is often blank after a restatement or spin-off.
    const order = statement.periods
      .map((p, i) => ({ p, i }))
      .filter(({ i }) => present.some((name) => isNum(statement.rows[name][i])))
      .reverse();
    if (!order.length) return null;

    const labels = yearLabels(order.map((o) => o.p), basis);
    const medians = benchKey ? bench?.[benchKey] : undefined;

    interface Row {
      name: string;
      cells: (number | null)[];
      industry: number | null;
      gap: number | null;
      change: number | null;
      changePct: number | null;
    }

    const rows: Row[] = present.map((name) => {
      const series = statement.rows[name];
      let cells = order.map(({ i }) => series[i]);

      if (view === "Common size" && base) {
        cells = order.map(({ i }) => {
          const denom = base[i];
          return isNum(series[i]) && isNum(denom) && denom !== 0 ? (series[i]! / denom) * 100 : null;
        });
      } else if (view === "Growth") {
        // order is newest-first, so the prior period is the next entry along.
        cells = order.map(({ i }, pos) => {
          const prevIdx = order[pos + 1]?.i;
          if (prevIdx === undefined) return null;
          const now = series[i];
          const before = series[prevIdx];
          return isNum(now) && isNum(before) && before !== 0 ? (now / before - 1) * 100 : null;
        });
      }

      const industry = view === "Common size" && medians && isNum(medians[name]) ? medians[name] : null;
      const latestCell = cells[0];
      return {
        name,
        cells,
        industry,
        gap: isNum(latestCell) && isNum(industry) ? latestCell - industry : null,
        change:
          view === "Reported" && isNum(cells[0]) && isNum(cells[1]) ? cells[0]! - cells[1]! : null,
        changePct:
          view === "Reported" && isNum(cells[0]) && isNum(cells[1]) && cells[1] !== 0
            ? ((cells[0]! - cells[1]!) / Math.abs(cells[1]!)) * 100
            : null,
      };
    });

    const fmtCell = (v: number | null): string => {
      if (!isNum(v)) return NA;
      if (view === "Common size") return `${v.toFixed(1)}%`;
      if (view === "Growth") return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
      return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    };

    const columns: Column<Row>[] = [
      { key: "name", header: "", render: (r) => r.name, align: "left" },
      ...labels.map((label, i) => ({
        key: `p${i}`,
        header: label,
        render: (r: Row) => fmtCell(r.cells[i]),
      })),
    ];

    if (view === "Common size" && rows.some((r) => r.industry !== null)) {
      columns.push({
        key: "industry",
        header: "Industry median",
        render: (r) => (isNum(r.industry) ? `${r.industry.toFixed(1)}%` : NA),
      });
      columns.push({
        key: "gap",
        header: "Gap (pp)",
        render: (r) => (isNum(r.gap) ? `${r.gap >= 0 ? "+" : ""}${r.gap.toFixed(1)}` : NA),
      });
    } else if (view === "Reported" && rows.some((r) => r.change !== null)) {
      columns.push({
        key: "change",
        header: "Change",
        render: (r) => (isNum(r.change) ? `${r.change >= 0 ? "+" : ""}${r.change.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : NA),
      });
      columns.push({
        key: "changePct",
        header: "Change %",
        render: (r) => (isNum(r.changePct) ? `${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(1)}%` : NA),
      });
    }

    return <DataTable title={title} what={what} columns={columns} rows={rows} rowKey={(r) => r.name} />;
  }

  // --- income statement bridge ----------------------------------------------

  function ProfitBridge() {
    const labels = yearLabels(incD.periods, basis);
    const index = bridgeIndex ?? incD.periods.length - 1;
    const row = Object.fromEntries(
      Object.entries(incD.rows).map(([k, v]) => [k, v[index] ?? null]),
    ) as Record<string, number | null>;

    const rev = row["Total Revenue"] ?? 0;
    const gross = row["Gross Profit"];
    const opInc = row["Operating Income"];
    const net = row["Net Income"];
    const cogs = isNum(gross) ? -(rev - gross) : 0;
    const opex = isNum(gross) && isNum(opInc) ? -(gross - opInc) : 0;
    const below = isNum(opInc) && isNum(net) ? -(opInc - net) : 0;

    return (
      <div>
        <label className="field">Bridge period</label>
        <select
          value={index}
          onChange={(e) => setBridgeIndex(Number(e.target.value))}
          style={{ marginBottom: 10 }}
        >
          {labels.map((label, i) => (
            <option key={label} value={i}>
              {label}
            </option>
          ))}
        </select>
        <Figure
          title={`Profit bridge, ${labels[index]}`}
          theme={theme}
          height={430}
          legend="off"
          explainOpen={explainOpen}
          what="Every step from revenue down to net income, sized to the amount it adds or removes."
          how="Read left to right. Blue bars are subtotals; red bars are what was deducted to get there. The **tallest red bar is the company's largest cost**, and the fastest place to look when margins move."
          why="The bridge makes it obvious whether profit is being made or lost in production (cost of revenue), in overheads, or below the operating line in financing and tax."
          data={waterfall(
            ["Revenue", "Cost of revenue", "Gross profit", "Operating costs", "Operating profit", "Interest & tax", "Net income"],
            [rev, cogs, 0, opex, 0, below, 0],
            ["absolute", "relative", "total", "relative", "total", "relative", "total"],
            theme,
          )}
          layout={{ yaxis: { title: sym } }}
        />
      </div>
    );
  }

  // --- balance sheet side charts --------------------------------------------

  function BalanceCharts() {
    const latest = latestRow(bsD);
    const ca = latest["Current Assets"] ?? 0;
    const ta = latest["Total Assets"] ?? 0;
    const x = yearLabels(bsD.periods, basis);
    const currentAssets = col(bsD, "Current Assets");
    const currentLiabs = col(bsD, "Current Liabilities");
    const liquidity =
      currentAssets && currentLiabs
        ? currentAssets.map((v, i) => safeDiv(v, currentLiabs[i]))
        : null;

    return (
      <div className="stack">
        <Figure
          title="Asset mix"
          theme={theme}
          height={270}
          explainOpen={explainOpen}
          what="The split between assets that turn into cash within a year and those that do not."
          how="A heavy current share means flexibility, and sometimes idle capital. A heavy non-current share means the business is capital-intensive: earnings depend on assets that cannot be liquidated quickly."
          why="Asset mix sets how quickly a business can react to a downturn."
          data={[
            {
              type: "pie",
              labels: ["Current (liquid)", "Non-current (fixed)"],
              values: [ca, Math.max(ta - ca, 0)],
              hole: 0.58,
              marker: { colors: [theme.accentSoft, theme.faint] },
            },
          ]}
        />
        {liquidity ? (
          <Figure
            title="Liquidity trend"
            theme={theme}
            height={250}
            legend="off"
            explainOpen={explainOpen}
            what="Current assets divided by current liabilities, period by period."
            how="The dotted line is 1.0x, where short-term obligations exactly consume short-term assets. Below it, the company depends on refinancing or on cash still to be generated. Comfortably above 2.0x can mean capital sitting idle."
            why="The direction matters more than the level: a ratio falling steadily toward 1.0x is an early warning even while it is still technically fine."
            data={[line(x, liquidity, "Current ratio", theme.accent, { width: 2.5, mode: "lines+markers" })]}
            layout={{
              xaxis: CATEGORY_AXIS,
              shapes: [
                { type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: 1, y1: 1, line: { dash: "dot", color: theme.danger, width: 1 } },
              ],
            }}
            csv={csvFrom(x, { "Current ratio": liquidity })}
          />
        ) : null}
      </div>
    );
  }

  // --- line by line ----------------------------------------------------------

  function LineByLine() {
    const info = co.info;
    const costNote = SECTOR_COST_NOTES[co.sector];
    const summary = ((info.longBusinessSummary as string) || "").trim();
    const firstSentences = summary ? summary.split(/(?<=[.!?])\s/).slice(0, 3).join(" ") : "";
    const emp = pickNum(info, "fullTimeEmployees");
    const revLatest = last(incD, "Total Revenue");
    const revPerHead = isNum(emp) && emp ? safeDiv(revLatest, emp) : null;


    return (
      <>
        <p className="section-sub">
          Every line the company actually reports, explained: what it is, what moves it, what to watch — with
          this company&apos;s own figure, its share of the relevant total, its change on the prior period, and
          the industry median for the same line where a peer group resolved. Generated from the reported
          statements, so it follows whatever the company files.
        </p>

        <Card title="What this company actually sells">
          {firstSentences || "No business description is available from the data source."}
          <div className="card-meta" style={{ marginTop: 10 }}>
            Classified as <b>{co.industry}</b> within <b>{co.sector}</b>
            {revPerHead ? (
              <>
                {" "}
                · revenue per employee <b>{money(revPerHead, sym)}</b> across{" "}
                <b>{isNum(emp) ? emp.toLocaleString("en-US") : NA}</b> staff
              </>
            ) : null}
            {costNote ? (
              <>
                <br />
                For a business of this type the direct cost line typically contains {costNote.cogs}; operating
                expenses are usually dominated by {costNote.opex}. The filing&apos;s own breakdown is in the
                annual report — this data source does not publish segment detail.
              </>
            ) : null}
          </div>
        </Card>

        <div style={{ height: 14 }} />
        <Tabs tabs={LINE_GROUPS} active={lineGroup} onChange={setLineGroup} />

        {lineGroup === LINE_GROUPS[0] ? (
          <LineCards
            statement={incD}
            names={[
              "Total Revenue", "Cost Of Revenue", "Gross Profit", "Operating Expense",
              "Research And Development", "Selling General And Administration", "Operating Income",
              "EBITDA", "Interest Expense", "Pretax Income", "Tax Provision", "Net Income",
              "Basic EPS", "Diluted EPS",
            ]}
            base={col(incD, "Total Revenue")}
            benchKey="income"
            shareLabel="revenue"
          />
        ) : lineGroup === LINE_GROUPS[1] ? (
          <LineCards
            statement={bsD}
            names={[
              "Cash And Cash Equivalents", "Accounts Receivable", "Inventory", "Current Assets",
              "Net PPE", "Goodwill", "Total Assets", "Accounts Payable", "Current Debt",
              "Current Liabilities", "Long Term Debt", "Total Liabilities Net Minority Interest",
              "Retained Earnings", "Stockholders Equity",
            ]}
            base={col(bsD, "Total Assets")}
            benchKey="balance"
            shareLabel="total assets"
          />
        ) : (
          <LineCards
            statement={cfD}
            names={[
              "Operating Cash Flow", "Depreciation And Amortization", "Stock Based Compensation",
              "Change In Working Capital", "Capital Expenditure", "Free Cash Flow",
              "Cash Dividends Paid", "Repurchase Of Capital Stock", "Net Issuance Payments Of Debt",
            ]}
            base={col(incD, "Total Revenue")}
            shareLabel="revenue"
          />
        )}
      </>
    );
  }

  /** One explanatory card per reported line, with this company's figure beside
   *  the industry median for the same line. */
  function LineCards({
    statement, names, base, benchKey, shareLabel,
  }: {
    statement: Statement;
    names: string[];
    base?: (number | null)[] | null;
    benchKey?: "income" | "balance";
    shareLabel: string;
  }) {
    const baseLatest = base ? [...base].reverse().find(isNum) ?? null : null;
    const medians = benchKey ? bench?.[benchKey] : undefined;

    const cards = names
      .map((name) => {
        const series = statement.rows[name];
        if (!series) return null;
        const present = series.filter(isNum) as number[];
        if (!present.length) return null;

        const value = present[present.length - 1];
        const share = baseLatest ? safeDiv(value, baseLatest) : null;
        const yoy =
          present.length >= 2 && present[present.length - 2]
            ? value / present[present.length - 2] - 1
            : null;
        const growth =
          present.length >= 3 && present[0] > 0
            ? cagr(present[0], value, present.length - 1)
            : null;
        const industry = medians && isNum(medians[name]) ? medians[name] : null;
        const guide = LINE_ITEMS[name];

        const facts: string[] = [`${money(value, sym)} in the latest ${basis.toLowerCase()} period`];
        if (share !== null) facts.push(`${asPct(share)} of ${shareLabel}`);
        if (yoy !== null) facts.push(`${asPct(yoy, 1, true)} on the prior period`);
        if (growth !== null) facts.push(`${asPct(growth)} a year compounded`);
        if (industry !== null && share !== null) {
          const gap = share * 100 - industry;
          facts.push(
            Math.abs(gap) < 0.05
              ? `industry median ${industry.toFixed(1)}% — this company is in line`
              : `industry median ${industry.toFixed(1)}% — this company is ${Math.abs(gap).toFixed(1)}pp ${gap > 0 ? "above" : "below"}`,
          );
        }

        return (
          <div className="defn" key={name}>
            <div className="defn-h">
              <span className="defn-name">{name}</span>
              <span className="defn-val">{money(value, sym)}</span>
            </div>
            <div className="defn-row">
              <div className="defn-k">Figures</div>
              <div>{facts.join(" · ")}</div>
            </div>
            {guide ? (
              <>
                <div className="defn-row">
                  <div className="defn-k">What it is</div>
                  <div>{guide.what}</div>
                </div>
                <div className="defn-row">
                  <div className="defn-k">What moves it</div>
                  <div>{guide.drivers}</div>
                </div>
                <div className="defn-row">
                  <div className="defn-k">What to watch</div>
                  <div>{guide.watch}</div>
                </div>
              </>
            ) : null}
          </div>
        );
      })
      .filter(Boolean);

    if (!cards.length) return <Caption>None of these lines are reported for this company.</Caption>;
    return <div>{cards}</div>;
  }
}
