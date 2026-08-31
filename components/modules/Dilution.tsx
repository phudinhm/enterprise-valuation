"use client";

// Stock compensation is added back in the cash flow statement because no cash
// moved. It is still a real cost — it is paid in ownership rather than in cash,
// and it lands on the share count.

import { useMemo } from "react";
import { Section, KpiGrid, Note, EmptyState } from "@/components/ui/primitives";
import Figure from "@/components/ui/Figure";
import { bars, line, CATEGORY_AXIS, csvFrom } from "@/components/modules/shared";
import { col, dropna, isEmpty, seriesWithPeriods, toDisplay, yearLabels } from "@/lib/data/frame";
import { asPct, cagr, isNum, money, price as fmtPrice, safeDiv, toneFor } from "@/lib/format";
import type { ModuleProps } from "@/components/modules/types";

export default function Dilution({ co, fx, sym, theme, explainOpen }: ModuleProps) {
  const incD = useMemo(() => toDisplay(co.annual.inc, fx), [co, fx]);
  const cfD = useMemo(() => toDisplay(co.annual.cf, fx), [co, fx]);
  const bsD = useMemo(() => toDisplay(co.annual.bs, fx), [co, fx]);

  if (isEmpty(cfD) || isEmpty(incD)) {
    return <EmptyState message="This module needs both an income statement and a cash flow statement." />;
  }

  const sharesSeries =
    col(incD, "Diluted Average Shares", "Basic Average Shares") ?? col(bsD, "Share Issued");
  const sharesPeriods =
    col(incD, "Diluted Average Shares", "Basic Average Shares") ? incD.periods : bsD.periods;

  const sbcSeries = col(cfD, "Stock Based Compensation");
  const ocfSeries = col(cfD, "Operating Cash Flow");
  let fcfSeries = col(cfD, "Free Cash Flow");
  if (!fcfSeries && ocfSeries) {
    const capex = col(cfD, "Capital Expenditure");
    fcfSeries = ocfSeries.map((v, i) =>
      isNum(v) ? v + (isNum(capex?.[i]) ? (capex![i] as number) : 0) : null,
    );
  }
  const revSeries = col(incD, "Total Revenue");

  const sharesPresent = dropna(sharesSeries);
  const shareCagr =
    sharesPresent.length >= 2
      ? cagr(sharesPresent[0], sharesPresent[sharesPresent.length - 1], sharesPresent.length - 1)
      : null;

  const lastOf = (s: (number | null)[] | null): number | null => {
    const present = dropna(s);
    return present.length ? present[present.length - 1] : null;
  };

  const sbc = lastOf(sbcSeries);
  const ocf = lastOf(ocfSeries);
  const fcf = lastOf(fcfSeries);
  const rev = lastOf(revSeries);
  const shares = sharesPresent.length ? sharesPresent[sharesPresent.length - 1] : co.shares;

  const adjFcf = isNum(fcf) && isNum(sbc) ? fcf - sbc : fcf;
  const fcfPs = safeDiv(fcf, shares);
  const adjFcfPs = safeDiv(adjFcf, shares);
  const priceNow = (co.price ?? 0) * fx;

  // Reported free cash flow beside the same figure with stock compensation
  // subtracted rather than added back.
  const comparison =
    fcfSeries && sbcSeries
      ? {
          labels: yearLabels(cfD.periods),
          reported: fcfSeries,
          after: fcfSeries.map((v, i) => (isNum(v) && isNum(sbcSeries[i]) ? v - (sbcSeries[i] as number) : null)),
        }
      : null;

  const sharesWithPeriods = seriesWithPeriods(
    { periods: sharesPeriods, rows: { s: sharesSeries ?? [] } },
    "s",
  );

  return (
    <>
      <Section
        title="What is left for owners, after paying people in stock"
        sub="Stock compensation is added back in the cash flow statement because no cash moved. It is still a real cost — it is paid in ownership rather than in cash, and it lands on the share count."
      />

      <KpiGrid
        id="dilution"
        minWidth={205}
        items={[
          {
            label: "Diluted share count CAGR",
            value: asPct(shareCagr, 1, true),
            sub: "Annual change across the reported history",
            tone: toneFor(isNum(shareCagr) ? shareCagr * 100 : null, 0, 2, false),
            help: "Positive means each existing share owns a little less of the company every year.",
          },
          {
            label: "Stock compensation",
            value: money(sbc, sym),
            sub: `${asPct(safeDiv(sbc, rev))} of revenue · ${asPct(safeDiv(sbc, ocf))} of operating cash flow`,
            tone: toneFor(isNum(sbc) ? (safeDiv(sbc, rev) ?? 0) * 100 : null, 3, 12, false),
          },
          {
            label: "Reported FCF per share",
            value: fmtPrice(fcfPs, sym),
            sub: "As the cash flow statement presents it",
            tone: "flat",
          },
          {
            label: "FCF per share after stock comp",
            value: fmtPrice(adjFcfPs, sym),
            sub: `${asPct(isNum(adjFcf) && fcf ? (safeDiv(adjFcf, fcf) ?? 1) - 1 : null, 1, true)} against the reported figure`,
            tone: toneFor(isNum(adjFcf) && fcf ? (safeDiv(adjFcf, fcf) ?? 0) * 100 : null, 90, 70),
            help: "Treating stock compensation as the cost it is, rather than adding it back.",
          },
          {
            label: "Yield on owner earnings",
            value: asPct(safeDiv(adjFcfPs, priceNow)),
            sub: "Adjusted free cash flow per share against the price",
            tone: toneFor(priceNow ? (safeDiv(adjFcfPs, priceNow) ?? 0) * 100 : null, 5, 2),
          },
        ]}
      />

      <div className="row two">
        {sharesWithPeriods.values.length >= 2 ? (
          <Figure
            title="Diluted share count over time"
            theme={theme}
            height={320}
            legend="off"
            explainOpen={explainOpen}
            what="The number of shares the company's earnings are divided between, each reported year."
            how="A line drifting **up** means existing holders own a shrinking slice — earnings per share grows more slowly than earnings. A line drifting **down** means buybacks are outrunning issuance, and per-share figures grow faster than the business."
            why={
              `At ${asPct(shareCagr, 1, true)} a year, this is ` +
              ((shareCagr ?? 0) > 0.01
                ? "a meaningful drag on per-share returns that compounds silently."
                : "not materially diluting existing holders.") +
              " Buybacks that merely offset issuance return nothing to owners; they just stop the leak."
            }
            data={[
              line(
                yearLabels(sharesWithPeriods.periods),
                sharesWithPeriods.values,
                "Diluted shares",
                theme.accent,
                { width: 2.6, mode: "lines+markers" },
              ),
            ]}
            layout={{ xaxis: CATEGORY_AXIS, yaxis: { title: "Shares outstanding" } }}
            csv={csvFrom(yearLabels(sharesWithPeriods.periods), { "Diluted shares": sharesWithPeriods.values })}
          />
        ) : (
          <EmptyState message="Share count history is not reported for this company." />
        )}

        {comparison ? (
          <Figure
            title="Free cash flow, before and after the cost of stock compensation"
            theme={theme}
            height={320}
            explainOpen={explainOpen}
            what="Reported free cash flow beside the same figure with stock-based compensation subtracted rather than added back."
            how="The gap is the part of reported cash flow that exists because employees were paid in ownership instead of cash. For companies where the gap is wide, the headline free cash flow yield is measuring something the owners never receive."
            why="Whether stock compensation is a real expense is one of the few genuine accounting debates left. The defensible position: it is real, because the alternative was paying cash, and the bill arrives as dilution."
            data={[
              bars(comparison.labels, comparison.reported, "Reported free cash flow", theme.accentSoft),
              bars(comparison.labels, comparison.after, "After stock compensation", theme.warning, 0.9),
            ]}
            layout={{ barmode: "overlay", xaxis: CATEGORY_AXIS, yaxis: { title: sym } }}
            csv={csvFrom(comparison.labels, {
              "Reported FCF": comparison.reported,
              "After stock comp": comparison.after,
            })}
          />
        ) : (
          <EmptyState message="Stock-based compensation is not reported separately for this company." />
        )}
      </div>

      <Note
        id="dilution-note"
        tone={(shareCagr ?? 0) > 0.01 ? "warn" : "neu"}
        text={[
          `Reported free cash flow of **${money(fcf, sym)}** becomes **${money(adjFcf, sym)}** once stock compensation of ${money(sbc, sym)} is treated as the cost it is.`,
          "",
          `- **Per share, that is ${fmtPrice(fcfPs, sym)} against ${fmtPrice(adjFcfPs, sym)}** — and per share is the only unit that matters to an owner, because it already accounts for the shares the company issued along the way.`,
          `- **The share count is compounding at ${asPct(shareCagr, 1, true)} a year.** ${
            (shareCagr ?? 0) > 0.01
              ? "Over a decade that alone consumes a meaningful share of the returns, before the business has done anything wrong."
              : "That is low enough not to materially change the investment case."
          }`,
          "- **Watch buybacks against issuance, not in isolation.** A company can spend heavily on repurchases and still end the year with more shares outstanding. The chart above settles that question in one line, where the buyback announcement does not.",
          `- Stock compensation of ${asPct(safeDiv(sbc, rev))} of revenue is ${
            (safeDiv(sbc, rev) ?? 0) > 0.08
              ? "high enough that the valuation multiples elsewhere in this app understate what owners are paying"
              : "modest relative to revenue"
          }.`,
        ].join("\n")}
      />
    </>
  );
}
