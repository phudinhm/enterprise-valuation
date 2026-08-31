"use client";

// The shell: controls on the left, the selected module on the right, and the
// company header, provenance panel and export footer shared by every data view.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import Sidebar, { type TerminalState } from "@/components/Sidebar";
import { ReportProvider } from "@/components/report";
import { EmptyState, Banner, Caption, RangeBar, Loading } from "@/components/ui/primitives";
import ModuleHost from "@/components/modules/ModuleHost";
import Provenance from "@/components/Provenance";
import { useApi } from "@/lib/useApi";
import { THEMES, themeVars, type ThemeName } from "@/lib/theme";
import {
  APP_NAME, DATA_SOURCE, INTERVALS, MARKETS, MODULES, currencySymbol, marketLabel,
  moduleToSlug, periodLabel, slugToModule, type StatementBasis,
} from "@/lib/constants";
import { asPct, isNum, monogram, price as fmtPrice, pickNum } from "@/lib/format";
import { computeExtras } from "@/lib/analytics/scorecard";
import type { Company } from "@/lib/data/types";

const DEFAULTS: TerminalState = {
  ticker: "AAPL",
  market: "United States",
  symbol: "AAPL",
  module: "Executive Dashboard",
  period: "1y",
  basis: "Annual",
  currency: "Native",
  theme: "Light",
  explainOpen: false,
};

export default function Terminal() {
  const router = useRouter();
  const params = useSearchParams();

  const state: TerminalState = useMemo(() => {
    const symbol = (params.get("ticker") || DEFAULTS.symbol).toUpperCase();
    const suffix = symbol.includes(".") ? `.${symbol.split(".").pop()}` : "";
    const market = MARKETS.find((m) => m.suffix === suffix)?.label ?? DEFAULTS.market;
    return {
      ticker: symbol,
      symbol,
      market,
      module: slugToModule(params.get("view")) || DEFAULTS.module,
      period: params.get("period") || DEFAULTS.period,
      basis: (params.get("basis") as StatementBasis) || DEFAULTS.basis,
      currency: params.get("currency") || DEFAULTS.currency,
      theme: (params.get("theme") as ThemeName) || DEFAULTS.theme,
      explainOpen: params.get("explain") === "1",
    };
  }, [params]);

  const [refreshKey, setRefreshKey] = useState(0);

  const update = useCallback(
    (patch: Partial<TerminalState>) => {
      const next = { ...state, ...patch };
      const query = new URLSearchParams();
      if (next.ticker !== DEFAULTS.ticker) query.set("ticker", next.ticker);
      if (next.module !== DEFAULTS.module) query.set("view", moduleToSlug(next.module));
      if (next.period !== DEFAULTS.period) query.set("period", next.period);
      if (next.basis !== DEFAULTS.basis) query.set("basis", next.basis);
      if (next.currency !== DEFAULTS.currency) query.set("currency", next.currency);
      if (next.theme !== DEFAULTS.theme) query.set("theme", next.theme);
      if (next.explainOpen) query.set("explain", "1");
      const qs = query.toString();
      // The whole view lives in the URL, so any screen is a shareable link.
      router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    },
    [router, state],
  );

  const theme = THEMES[state.theme] ?? THEMES.Light;

  useEffect(() => {
    // The body sits outside the themed container, so its background has to be
    // painted separately or the page edges keep the previous theme.
    document.body.style.background = theme.bgGrad;
    document.body.style.color = theme.text;
    document.body.style.colorScheme = state.theme === "Dark" ? "dark" : "light";
  }, [theme, state.theme]);

  const isGuide = state.module === "Guide & Method";
  const companyUrl = isGuide || !state.ticker ? null : `/api/company?ticker=${encodeURIComponent(state.ticker)}&r=${refreshKey}`;
  const { data: company, loading, error } = useApi<Company>(companyUrl);

  const nativeCurrency = company?.currency ?? "USD";
  const wantCurrency = state.currency === "Native" ? nativeCurrency : state.currency;
  const fxUrl =
    company && wantCurrency !== nativeCurrency
      ? `/api/fx?from=${encodeURIComponent(nativeCurrency)}&to=${encodeURIComponent(wantCurrency)}`
      : null;
  const { data: fxData } = useApi<{ rate: number | null }>(fxUrl);

  // A genuine FX lookup failure must not silently misstate every figure with a
  // wrong 1:1 rate: fall back to the native currency and say so.
  const fxResolved = fxUrl ? fxData?.rate ?? null : 1;
  const fxFailed = Boolean(fxUrl) && fxData !== null && fxData?.rate === null;
  const fx = isNum(fxResolved) ? fxResolved : 1;
  const targetCurrency = fxFailed ? nativeCurrency : wantCurrency;
  const sym = currencySymbol(targetCurrency);

  const extras = useMemo(() => (company ? computeExtras(company) : {}), [company]);

  return (
    <div className="shell" style={themeVars(theme) as React.CSSProperties}>
      <Sidebar state={state} update={update} onRefresh={() => setRefreshKey((k) => k + 1)} />

      <main className="main">
        <ReportProvider key={`${state.module}:${state.ticker}`}>
          {isGuide ? (
            <ModuleHost
              module={state.module}
              props={null}
              theme={theme}
            />
          ) : loading ? (
            <Loading label={`Loading ${state.ticker}…`} />
          ) : error || !company ? (
            <EmptyState
              message={`No usable data for “${state.ticker}”`}
              hint={
                "The symbol may be delisted, mistyped, or missing its exchange suffix " +
                "(for example BMW.DE rather than BMW). The sidebar search resolves names to symbols."
              }
            />
          ) : (
            <>
              <CompanyHeader
                company={company}
                fx={fx}
                sym={sym}
                targetCurrency={targetCurrency}
                nativeCurrency={nativeCurrency}
                themeSuccess={theme.success}
                themeDanger={theme.danger}
              />

              {fxFailed ? (
                <Banner tone="warn">
                  A live {nativeCurrency} → {wantCurrency} rate was not available, so every figure below is
                  shown in the native currency ({nativeCurrency}).
                </Banner>
              ) : null}

              <DerivedNotice company={company} />

              <ModuleHost
                module={state.module}
                theme={theme}
                props={{
                  co: company,
                  extras,
                  fx,
                  sym,
                  targetCurrency,
                  nativeCurrency,
                  theme,
                  basis: state.basis,
                  period: state.period,
                  periodLabel: periodLabel(state.period),
                  interval: INTERVALS[state.period] ?? "1d",
                  explainOpen: state.explainOpen,
                }}
              />

              <Provenance
                company={company}
                basis={state.basis}
                fx={fx}
                nativeCurrency={nativeCurrency}
                targetCurrency={targetCurrency}
                module={state.module}
              />
            </>
          )}

          <div className="foot">
            {APP_NAME} · data from {DATA_SOURCE}, with Stooq and SEC EDGAR standing behind it
            <br />
            Figures are as reported by the data provider and may contain gaps or restatements. Nothing here is
            investment advice; it is an educational research tool.
          </div>
        </ReportProvider>
      </main>
    </div>
  );
}

function CompanyHeader({
  company, fx, sym, targetCurrency, nativeCurrency, themeSuccess, themeDanger,
}: {
  company: Company; fx: number; sym: string; targetCurrency: string; nativeCurrency: string;
  themeSuccess: string; themeDanger: string;
}) {
  const price = (company.price ?? 0) * fx;
  const prev = company.previousClose ?? company.price ?? 0;
  const change = (company.price ?? 0) - prev;
  const changePct = prev ? (change / prev) * 100 : 0;
  const colour = change >= 0 ? themeSuccess : themeDanger;

  const hi = pickNum(company.info, "fiftyTwoWeekHigh");
  const lo = pickNum(company.info, "fiftyTwoWeekLow");

  return (
    <>
      <div className="hdr">
        <div className="hdr-left">
          <div className="monogram">{monogram(company.name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">
              {company.ticker} · {marketLabel(company.ticker)}
            </div>
            <h1 className="hdr-name">{company.name}</h1>
            <div className="hdr-meta">
              <span className="hdr-chip">{company.sector}</span>
              <span className="hdr-chip">{company.industry}</span>
              <span className="hdr-chip">{company.exchange}</span>
              Reported in {nativeCurrency} · shown in {targetCurrency}
              {nativeCurrency === targetCurrency ? "" : ` at ${fx.toFixed(4)}`}
            </div>
          </div>
        </div>
        <div className="px-box">
          <div className="px-value" style={{ color: colour }}>
            {fmtPrice(price, sym)}
          </div>
          <div className="px-chg" style={{ color: colour }}>
            {(change * fx).toFixed(2)} ({changePct >= 0 ? "+" : ""}
            {changePct.toFixed(2)}%)
          </div>
          <div className="px-meta">Previous close {fmtPrice(prev * fx, sym)}</div>
        </div>
      </div>

      {isNum(hi) && isNum(lo) && isNum(company.price) ? (
        <RangeBar
          low={lo * fx}
          high={hi * fx}
          current={company.price * fx}
          format={(v) => fmtPrice(v, sym)}
        />
      ) : null}
    </>
  );
}

/** Says plainly when the quote endpoint came back thin and the headline metrics
 *  had to be rebuilt, rather than presenting computed figures as reported ones. */
function DerivedNotice({ company }: { company: Company }) {
  if (!company.derived.length) return null;
  const shown = company.derived.slice(0, 8).join(", ") + (company.derived.length > 8 ? "…" : "");

  if (company.quoteFields < 6) {
    return (
      <Banner tone="info">
        The quote endpoint returned only {company.quoteFields} of {company.quoteMetricCount} headline metrics
        for {company.ticker} — usually rate limiting, which hits shared cloud hosts hardest. The figures below
        were recomputed from the company&apos;s own reported statements and price history instead (
        {company.derived.length} fields: {shown}). They follow the standard definitions, but they are
        calculated here rather than quoted. Use <b>Refresh market data</b> in the sidebar to try the quote
        endpoint again.
      </Banner>
    );
  }
  return (
    <Caption>
      {company.derived.length} metric(s) were not quoted and have been computed from the reported statements:{" "}
      {shown}.
    </Caption>
  );
}
