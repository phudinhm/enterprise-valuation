"use client";

// The guide loads no market data, so it renders instantly.

import { Section, Card } from "@/components/ui/primitives";
import { APP_NAME, DATA_SOURCE, MODULES } from "@/lib/constants";
import type { ThemeTokens } from "@/lib/theme";

export default function Guide({ theme }: { theme: ThemeTokens }) {
  return (
    <>
      <div className="eyebrow">{APP_NAME}</div>
      <h1 className="hdr-name">Guide &amp; method</h1>
      <div className="hdr-meta">
        What each module answers, how the numbers are built, and what the figures assume. Nothing on this page
        loads market data.
      </div>

      <Section title="Modules" sub="Pick the module that matches the question you are actually asking." />
      <div className="stack">
        {MODULES.slice(1).map(([name, purpose], idx) => (
          <div className="card" key={name}>
            <div className="card-title">
              <span className="section-num">{String(idx + 1).padStart(2, "0")}</span>&nbsp;&nbsp;{name}
            </div>
            <div className="card-body">{purpose}</div>
          </div>
        ))}
      </div>

      <Section
        title="How the report is structured"
        sub="Every module follows the same shape, so figures can be quoted and compared reliably."
      />
      <Card>
        <p>
          <b>Numbered sections and figures.</b> Each chart and table carries a stable reference such as{" "}
          <i>Figure 5.2</i> (section 5, second exhibit), and every figure has a &ldquo;how to read
          this&rdquo; note covering what it shows, how to read it and why it matters.
        </p>
        <p>
          <b>Consistent units.</b> All monetary figures are converted into your selected display currency
          using a live FX rate; if a rate cannot be fetched, the app says so and leaves the figures in the
          native currency rather than silently applying a 1:1 rate.
        </p>
        <p>
          <b>Stated basis.</b> Statements are labelled Annual, Quarterly or TTM. TTM sums the last four
          reported quarters for flow items and uses the most recent quarter-end for balance sheet items.
        </p>
        <p>
          <b>Exportable.</b> Any view can be exported as a standalone HTML report with its charts and captions
          intact, and every figure offers the numbers behind it as CSV.
        </p>
        <p style={{ marginBottom: 0 }}>
          <b>Shareable.</b> The company, module, period, basis, currency and theme all live in the URL, so any
          screen you are looking at is a link you can send to someone else.
        </p>
      </Card>

      <Section
        title="Method notes and limitations"
        sub="The assumptions behind the calculated figures, stated up front."
      />
      <Card>
        <p>
          <b>Discount rate.</b> WACC is built from CAPM: a live 10-year Treasury yield as the risk-free rate,
          an equity risk premium you control, the company&apos;s reported beta, and an after-tax cost of debt
          weighted by market values of equity and debt.
        </p>
        <p>
          <b>DCF shape.</b> Three phases — an explicit high-growth stage, a fade stage that converges toward
          the terminal rate, then Gordon growth in perpetuity. The share of value coming from the terminal
          figure is always shown, because a model where 90% of value sits beyond the forecast horizon deserves
          less weight.
        </p>
        <p>
          <b>Scores.</b> The composite score is a weighted average of five pillars, each an average of the
          sub-metrics that could be computed. Missing inputs are skipped and weights renormalise. It is a
          screening aid, not a recommendation.
        </p>
        <p style={{ marginBottom: 0 }}>
          <b>Data.</b> The primary source is {DATA_SOURCE}, which rate-limits by source address — so two
          independent backups stand behind it, neither needing an API key. <b>Stooq</b> supplies daily price
          history for most developed markets when the primary price endpoint is throttled.{" "}
          <b>SEC EDGAR&apos;s XBRL company-facts API</b> supplies the statements themselves, straight from the
          regulator, for companies that file in the United States. When even the quote endpoint is empty, the
          headline metrics are recomputed from those statements, and the page says which figures were computed
          rather than quoted. Whichever source answered is named in the provenance panel at the foot of every
          view. All of it can still contain gaps, restatements and classification quirks, particularly outside
          the United States — verify against the primary filing before anything consequential rests on a
          number.
        </p>
      </Card>

      <Section
        title="Coverage"
        sub="Any listed company on any market the data source can reach. Nothing about the company universe is bundled with the app."
      />
      <Card>
        <p>
          <b>Search resolves live.</b> A name or partial symbol goes through the search endpoint on both
          hosts, and when all of those are throttled the query is probed as a symbol across every market
          suffix in parallel. One rate-limited endpoint cannot make a real company look nonexistent.
        </p>
        <p>
          <b>Markets are selectable for every exchange suffix</b>, from Vietnam&apos;s HOSE through to Brazil,
          Saudi Arabia and the Nordics.
        </p>
        <p>
          <b>Quotes degrade gracefully.</b> When the quote endpoint is rate-limited — routine on shared cloud
          hosting — the headline metrics are recomputed from the company&apos;s own filings, and the page says
          which figures were computed rather than quoted.
        </p>
        <p style={{ marginBottom: 0 }}>
          <b>Primary sources are linked per market</b>, with that market&apos;s own reporting rhythm: SEC
          EDGAR for the US, HOSE and Vietstock for Vietnam, EDINET for Japan, HKEXnews for Hong Kong, and so
          on.
        </p>
      </Card>

      <div className="foot" style={{ color: theme.faint }}>
        {APP_NAME} · Data: {DATA_SOURCE} · Educational use only, not investment advice.
      </div>
    </>
  );
}
