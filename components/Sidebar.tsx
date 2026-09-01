"use client";

// The control panel. The module navigator is a visible list rather than a
// dropdown, so the whole map of the terminal stays on screen: switching view is
// one click, and the reader can see what else is available without opening
// anything.

import { useEffect, useState } from "react";
import { apiGet, clearApiCache } from "@/lib/useApi";
import {
  APP_NAME, APP_TAGLINE, DATA_SOURCE, DISPLAY_CURRENCIES, MARKETS, MODULES,
  PERIODS, STATEMENT_BASES, marketLabel, type StatementBasis,
} from "@/lib/constants";
import { THEME_NAMES, type ThemeName } from "@/lib/theme";
import type { SearchHit } from "@/lib/data/types";
import { Field, Segmented } from "@/components/ui/primitives";
import SourceStatus from "@/components/SourceStatus";

export interface TerminalState {
  ticker: string;
  market: string;
  symbol: string;
  module: string;
  period: string;
  basis: StatementBasis;
  currency: string;
  theme: ThemeName;
  explainOpen: boolean;
}

export interface SidebarProps {
  state: TerminalState;
  update: (patch: Partial<TerminalState>) => void;
  onRefresh: () => void;
}

export default function Sidebar({ state, update, onRefresh }: SidebarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [attempts, setAttempts] = useState<{ route: string; ok: boolean; detail: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // On a phone the controls stack above the report, so starting expanded lands
  // the reader on the inputs rather than on the analysis they asked for. Desktop
  // keeps them open, where they cost nothing.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(window.matchMedia("(max-width: 980px)").matches);
  }, []);

  async function runSearch() {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const data = await apiGet<{
        results: SearchHit[];
        attempts?: { route: string; ok: boolean; detail: string }[];
      }>(`/api/search?q=${encodeURIComponent(q)}`);
      setResults(data?.results ?? []);
      setAttempts(data?.attempts ?? []);
    } catch (err) {
      setResults([]);
      setAttempts([{ route: "request", ok: false, detail: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setSearching(false);
    }
  }

  function useHit(hit: SearchHit) {
    const suffix = hit.symbol.includes(".") ? `.${hit.symbol.split(".").pop()}` : "";
    const match = MARKETS.find((m) => m.suffix === suffix);
    update({
      symbol: hit.symbol,
      market: match ? match.label : "Other / enter full symbol",
      ticker: hit.symbol,
    });
    setResults(null);
    setQuery("");
  }

  const marketSuffix = MARKETS.find((m) => m.label === state.market)?.suffix ?? "";

  function setSymbol(raw: string) {
    const symbol = raw.toUpperCase().trim();
    // A symbol that already carries an exchange suffix overrides the market
    // selector — typing 7203.T should just work.
    const ticker = marketSuffix === "MANUAL" || symbol.includes(".") ? symbol : `${symbol}${marketSuffix}`;
    update({ symbol, ticker });
  }

  function setMarket(label: string) {
    const suffix = MARKETS.find((m) => m.label === label)?.suffix ?? "";
    const ticker =
      suffix === "MANUAL" || state.symbol.includes(".") ? state.symbol : `${state.symbol}${suffix}`;
    update({ market: label, ticker });
  }

  return (
    <aside className="sidebar no-print">
      <div className="sidebar-inner">
        <div className="side-head">
          <div className="side-mark">IT</div>
          <div className="side-brand">{APP_NAME}</div>
        </div>
        <div className="side-sub">{APP_TAGLINE}</div>

        <button
          type="button"
          className="btn sidebar-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          {collapsed ? "Show controls" : "Hide controls"}
        </button>

        <div className="sidebar-body" data-collapsed={collapsed}>
          <div className="side-group">Company</div>

          <details className="explain" open={searchOpen} onToggle={(e) => setSearchOpen((e.target as HTMLDetailsElement).open)}>
            <summary>Search by company name</summary>
            <div style={{ paddingTop: 6 }}>
              <input
                type="text"
                value={query}
                placeholder="Siemens, Toyota, Vietcombank…"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                }}
                aria-label="Company name"
              />
              <button type="button" className="btn primary" style={{ marginTop: 8, width: "100%" }} onClick={runSearch}>
                {searching ? "Searching every market…" : "Search"}
              </button>

              {results && results.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  {results.map((hit) => (
                    <button
                      key={hit.symbol}
                      type="button"
                      className="nav-item"
                      style={{ marginBottom: 4 }}
                      onClick={() => useHit(hit)}
                    >
                      {hit.symbol} · {hit.name}
                      <div style={{ fontWeight: 400, fontSize: 11.5 }}>
                        {hit.exchange || marketLabel(hit.symbol)}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

              {results && results.length === 0 && !searching ? (
                <>
                  <p className="caption">
                    Nothing came back for that. Type the symbol with its market suffix directly if you know it
                    (Vinamilk is VNM.VN, Siemens is SIE.DE, Toyota is 7203.T).
                  </p>
                  {attempts.length ? (
                    <details className="explain">
                      <summary>Why the search found nothing</summary>
                      <div className="status-detail">
                        {attempts.map((a) => (
                          <div className="status-row" key={a.route}>
                            <span className={`status-dot ${a.ok ? "ok" : "bad"}`} style={{ marginTop: 5 }} />
                            <span>
                              <span className="status-name">{a.route}</span>
                              <div className="status-why">{a.detail}</div>
                            </span>
                            <span />
                          </div>
                        ))}
                        <p className="caption" style={{ marginTop: 8 }}>
                          Every route failing means the provider is refusing this deployment rather than the
                          company being unknown. The data-source check at the foot of this panel confirms which.
                        </p>
                      </div>
                    </details>
                  ) : null}
                </>
              ) : null}

              <p className="caption">
                Searched live. No company list is bundled with this app, so renames, new listings and
                delistings are picked up immediately.
              </p>
            </div>
          </details>

          <Field label="Market">
            <select value={state.market} onChange={(e) => setMarket(e.target.value)}>
              {MARKETS.map((m) => (
                <option key={m.label} value={m.label}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Ticker symbol"
            help="A symbol that already carries an exchange suffix (7203.T) overrides the market above."
          >
            <input
              type="text"
              value={state.symbol}
              onChange={(e) => setSymbol(e.target.value)}
              aria-label="Ticker symbol"
            />
          </Field>

          <div className="side-group">View</div>
          <nav className="nav-list" aria-label="Modules">
            {MODULES.map(([name], i) => (
              <button
                key={name}
                type="button"
                className="nav-item"
                aria-current={state.module === name}
                onClick={() => update({ module: name })}
                title={MODULES[i][1]}
              >
                <span className="nav-index">{String(i).padStart(2, "0")}</span>
                <span className="nav-label">{name}</span>
              </button>
            ))}
          </nav>
          <p className="caption">{MODULES.find(([n]) => n === state.module)?.[1]}</p>

          <div className="side-group">Reporting basis</div>
          <Field label="Chart period">
            <select value={state.period} onChange={(e) => update({ period: e.target.value })}>
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          <div style={{ marginTop: 10 }}>
            <Segmented
              label="Statement basis"
              options={STATEMENT_BASES}
              value={state.basis}
              onChange={(v) => update({ basis: v })}
              help="Annual and quarterly are as reported; TTM sums the last four reported quarters."
            />
          </div>

          <Field label="Display currency">
            <select value={state.currency} onChange={(e) => update({ currency: e.target.value })}>
              {DISPLAY_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <div className="side-group">Presentation</div>
          <Field label="Theme">
            <select value={state.theme} onChange={(e) => update({ theme: e.target.value as ThemeName })}>
              {THEME_NAMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <label className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={state.explainOpen}
              onChange={(e) => update({ explainOpen: e.target.checked })}
            />
            Expand figure explanations by default
          </label>

          <div className="side-group">Data</div>
          <button
            type="button"
            className="btn"
            style={{ width: "100%" }}
            onClick={() => {
              clearApiCache();
              onRefresh();
            }}
            title="Clears every cached response and refetches on the next render."
          >
            Refresh market data
          </button>
          <div style={{ marginTop: 8 }}>
            <SourceStatus />
          </div>
          <p className="caption">Primary source: {DATA_SOURCE}, with Stooq and SEC EDGAR behind it.</p>

          <div className="foot" style={{ marginTop: 18 }}>
            Ported from the Streamlit original
            <br />
            Educational research tool — not investment advice.
          </div>
        </div>
      </div>
    </aside>
  );
}
