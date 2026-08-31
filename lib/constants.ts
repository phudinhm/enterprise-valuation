// Static reference data: venues, filing sources, currency symbols and the
// module map. Nothing about the *company* universe is bundled — only the
// exchanges and the sector ETFs used to discover peers live here.

export const APP_NAME = "Investment Terminal";
export const APP_TAGLINE = "Fundamental research, valuation and reporting";
export const DATA_SOURCE = "Yahoo Finance";

export const MODULES: [string, string][] = [
  ["Guide & Method", "How the terminal is put together and when to use each module."],
  ["Executive Dashboard", "One screen: composite score, valuation, profitability, health, dividends, quality flags."],
  ["Technical Analysis", "Price action, trend, momentum and volatility."],
  ["Financial Statements", "Reported figures, line-by-line explanations and industry-relative common size."],
  ["Cash Flow Quality", "Whether reported profit actually converts into cash."],
  ["Capital Allocation", "Return on invested capital against the cost of it, and where the cash went."],
  ["Solvency & Debt", "Maturity profile, leverage, interest cover and a refinancing stress test."],
  ["Dilution & Owner Earnings", "Share-count creep and free cash flow after the cost of paying people in stock."],
  ["Intrinsic Valuation", "Three-phase DCF, reverse DCF, scenarios and sensitivity."],
  ["Peer Comparables", "Relative valuation against live-matched industry peers."],
  ["Compare Companies", "Two or more companies side by side on price, quality, valuation and growth."],
  ["Risk & Scenarios", "Volatility, drawdown, value at risk and Monte Carlo paths."],
  ["Investment Simulator", "What an investment made on a past date would be worth today."],
  ["Portfolio", "Allocation against targets, concentration limits, TWRR and money-weighted return."],
  ["Price & Capital Dynamics", "Price, market cap, news context and the EV bridge."],
  ["Market Leaders", "Cross-company ranking by market cap and revenue."],
];

export const MODULE_SLUGS = MODULES.map(([name]) =>
  name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
);

export const MODULE_LABELS = MODULES.map(([name], i) => `${String(i).padStart(2, "0")}. ${name}`);

export function slugToModule(slug: string | null | undefined): string {
  const i = MODULE_SLUGS.indexOf((slug || "").toLowerCase());
  return MODULES[i >= 0 ? i : 1][0];
}

export function moduleToSlug(name: string): string {
  const i = MODULES.findIndex(([n]) => n === name);
  return MODULE_SLUGS[i >= 0 ? i : 1];
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", VND: "₫", GBP: "£", GBp: "p", GBX: "p",
  JPY: "¥", CNY: "¥", CHF: "CHF ", HKD: "HK$", SGD: "S$",
  KRW: "₩", INR: "₹", CAD: "C$", AUD: "A$", NZD: "NZ$", SEK: "kr ",
};

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? `${code} `;
}

export const SECTOR_ETF_MAP: Record<string, string> = {
  Technology: "XLK", "Financial Services": "XLF", Healthcare: "XLV",
  "Consumer Cyclical": "XLY", "Consumer Defensive": "XLP", Energy: "XLE",
  "Communication Services": "XLC", Industrials: "XLI", Utilities: "XLU",
  "Real Estate": "XLRE", "Basic Materials": "XLB",
};

// Yahoo's exchange suffixes. This is a mapping of *venues*, not of companies:
// no company list is bundled with the app, so any symbol on any of these
// markets resolves live.
export const EXCHANGE_LABELS: Record<string, string> = {
  "": "United States", VN: "Vietnam (HOSE/HNX)", DE: "Germany (Xetra)",
  F: "Germany (Frankfurt)", L: "United Kingdom (LSE)", IL: "London (intl)",
  T: "Japan (Tokyo)", SS: "China (Shanghai)", SZ: "China (Shenzhen)",
  HK: "Hong Kong", TW: "Taiwan", TWO: "Taiwan (OTC)", KS: "South Korea (KOSPI)",
  KQ: "South Korea (KOSDAQ)", NS: "India (NSE)", BO: "India (BSE)",
  SI: "Singapore", AX: "Australia (ASX)", NZ: "New Zealand",
  TO: "Canada (TSX)", V: "Canada (TSXV)", NE: "Canada (NEO)",
  SW: "Switzerland (SIX)", PA: "France (Euronext Paris)",
  AS: "Netherlands (Euronext)", BR: "Belgium (Euronext)",
  LS: "Portugal (Euronext)", MI: "Italy (Borsa Italiana)",
  MC: "Spain (BME)", VI: "Austria (Wiener Börse)", IR: "Ireland (Euronext)",
  ST: "Sweden (Nasdaq Stockholm)", OL: "Norway (Oslo Børs)",
  CO: "Denmark (Nasdaq Copenhagen)", HE: "Finland (Nasdaq Helsinki)",
  IC: "Iceland", WA: "Poland (GPW)", PR: "Czechia (PSE)",
  IS: "Türkiye (Borsa Istanbul)", TA: "Israel (TASE)", SR: "Saudi Arabia (Tadawul)",
  QA: "Qatar", AE: "UAE (Abu Dhabi)", CA: "Egypt (EGX)", JO: "South Africa (JSE)",
  SA: "Brazil (B3)", MX: "Mexico (BMV)", BA: "Argentina (BYMA)",
  SN: "Chile (Santiago)", CN: "Canada (CSE)", BK: "Thailand (SET)",
  JK: "Indonesia (IDX)", KL: "Malaysia (Bursa)", PS: "Philippines (PSE)",
  AT: "Greece (ATHEX)", BD: "Hungary (BSE)", RG: "Latvia", TL: "Estonia",
};

const MARKET_ORDER = [
  "", "VN", "DE", "L", "T", "HK", "SS", "SZ", "TW", "KS", "NS", "SI",
  "AX", "TO", "SW", "PA", "AS", "MI", "MC", "ST", "OL", "CO", "HE",
  "BR", "IR", "VI", "LS", "WA", "IS", "TA", "SR", "SA", "MX", "BK",
  "JK", "KL", "PS", "AT", "NZ", "JO", "BO", "KQ", "TWO", "F", "V",
];

export const MARKETS: { label: string; suffix: string }[] = [
  ...MARKET_ORDER.filter((k) => k in EXCHANGE_LABELS).map((k) => ({
    label: EXCHANGE_LABELS[k],
    suffix: k ? `.${k}` : "",
  })),
  { label: "Other / enter full symbol", suffix: "MANUAL" },
];

export const MARKET_SUFFIXES = Object.keys(EXCHANGE_LABELS).filter(Boolean).map((k) => `.${k}`);

export function marketLabel(ticker: string): string {
  const suffix = ticker && ticker.includes(".") ? ticker.split(".").pop()!.toUpperCase() : "";
  return EXCHANGE_LABELS[suffix] ?? (suffix || "International");
}

export const PERIODS: { label: string; value: string }[] = [
  { label: "5 days", value: "5d" },
  { label: "1 month", value: "1mo" },
  { label: "3 months", value: "3mo" },
  { label: "6 months", value: "6mo" },
  { label: "Year to date", value: "ytd" },
  { label: "1 year", value: "1y" },
  { label: "3 years", value: "3y" },
  { label: "5 years", value: "5y" },
  { label: "10 years", value: "10y" },
  { label: "Maximum", value: "max" },
];

export const INTERVALS: Record<string, string> = {
  "5d": "15m", "1mo": "60m", "3mo": "1d", "6mo": "1d", ytd: "1d",
  "1y": "1d", "3y": "1wk", "5y": "1wk", "10y": "1mo", max: "1mo",
};

export function periodLabel(value: string): string {
  return PERIODS.find((p) => p.value === value)?.label ?? value;
}

/** Approximate calendar length of a period, for the endpoints that take dates
 *  rather than a range token. `null` means "as far back as there is". */
export function periodDays(period: string): number | null {
  const map: Record<string, number> = {
    "5d": 7, "1mo": 31, "3mo": 93, "6mo": 186, "1y": 365,
    "3y": 1095, "5y": 1825, "10y": 3650,
  };
  return map[period] ?? null;
}

export const STATEMENT_BASES = ["Annual", "Quarterly", "TTM"] as const;
export type StatementBasis = (typeof STATEMENT_BASES)[number];

export const DISPLAY_CURRENCIES = ["Native", "USD", "EUR", "VND", "GBP", "JPY"];

export interface FilingSource {
  name: string;
  url: string;
  rhythm: string;
}

// Where each market's own audited filings actually live. The quote provider
// carries a normalised summary; these are the primary sources to verify a
// number against, with the filing rhythm that market runs on.
export const FILING_SOURCES: Record<string, FilingSource> = {
  "": {
    name: "SEC EDGAR",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker={base}&type=10-K&dateb=&owner=include&count=40",
    rhythm: "Annual report on Form 10-K and quarterly reports on Form 10-Q, plus 8-K for material events. Full text is free and searchable.",
  },
  VN: {
    name: "HOSE disclosure and Vietstock",
    url: "https://finance.vietstock.vn/{base}/tai-chinh.htm",
    rhythm: "Báo cáo tài chính quý (unaudited quarterly), a reviewed half-year report, and an audited annual report, filed with the State Securities Commission and the exchange. Quarterly statements are typically due within 20 days of quarter end (30 for consolidated), the reviewed half-year within 45 days, and the audited annual within 90 days. Vietnamese issuers report in VND under Vietnamese Accounting Standards, which differ from IFRS in several places — treat cross-border comparisons of margins and equity with care.",
  },
  DE: {
    name: "Bundesanzeiger and company IR",
    url: "https://www.bundesanzeiger.de/pub/en/suchen?4",
    rhythm: "Annual and half-year financial reports; Prime Standard issuers also publish quarterly statements. Filings are in German and often English on the company's own investor-relations pages.",
  },
  L: {
    name: "FCA National Storage Mechanism / RNS",
    url: "https://data.fca.org.uk/#/nsm/nationalstoragemechanism",
    rhythm: "Annual report and a half-year report. Quarterly reporting has not been mandatory in the UK since 2014, so many companies publish trading updates instead of full quarterly accounts.",
  },
  T: {
    name: "EDINET and TDnet",
    url: "https://disclosure2.edinet-fsa.go.jp/",
    rhythm: "Quarterly earnings summaries (kessan tanshin) through TDnet and the annual securities report (yūkashōken hōkokusho) through EDINET. Many filings are Japanese-only; larger issuers publish English summaries.",
  },
  SS: {
    name: "Shanghai Stock Exchange / CNINFO",
    url: "http://www.cninfo.com.cn/new/index",
    rhythm: "Quarterly, half-year and annual reports are all mandatory. Filings are in Chinese; annual reports are audited under Chinese Accounting Standards.",
  },
  SZ: {
    name: "Shenzhen Stock Exchange / CNINFO",
    url: "http://www.cninfo.com.cn/new/index",
    rhythm: "Quarterly, half-year and annual reports are all mandatory, filed in Chinese.",
  },
  HK: {
    name: "HKEXnews",
    url: "https://www.hkexnews.hk/",
    rhythm: "Interim and annual reports are required; quarterly reporting is voluntary on the Main Board. Filings are published in both English and Chinese.",
  },
  KS: {
    name: "DART (Financial Supervisory Service)",
    url: "https://engdart.fss.or.kr/",
    rhythm: "Quarterly, half-year and annual reports. English summaries are available through the English DART portal.",
  },
  TW: {
    name: "MOPS (Market Observation Post System)",
    url: "https://mops.twse.com.tw/mops/web/index",
    rhythm: "Monthly revenue announcements plus quarterly and annual financial reports — the monthly revenue disclosure is unusual and useful.",
  },
  NS: {
    name: "NSE India / BSE",
    url: "https://www.nseindia.com/companies-listing/corporate-filings-financial-results",
    rhythm: "Quarterly results and an audited annual report; Indian issuers also publish detailed shareholding patterns each quarter.",
  },
  AX: {
    name: "ASX announcements",
    url: "https://www.asx.com.au/markets/company/{base}",
    rhythm: "Half-year and annual reports, plus quarterly cash-flow reports (Appendix 4C/5B) for smaller and pre-revenue companies.",
  },
  TO: {
    name: "SEDAR+",
    url: "https://www.sedarplus.ca/",
    rhythm: "Quarterly and annual filings, including the MD&A, which is where Canadian issuers explain the numbers.",
  },
  SI: {
    name: "SGX company announcements",
    url: "https://www.sgx.com/securities/company-announcements",
    rhythm: "Half-year and annual results; quarterly reporting is required only for companies flagged by the exchange.",
  },
  SW: {
    name: "SIX Exchange regulation",
    url: "https://www.six-exchange-regulation.com/en/home/publications/official-notices.html",
    rhythm: "Annual and half-year reports under IFRS or Swiss GAAP FER.",
  },
};

export const FILING_SOURCE_DEFAULT: FilingSource = {
  name: "the company's own investor-relations pages",
  url: "",
  rhythm: "Reporting frequency and deadlines vary by market. The company's investor-relations site and its exchange's disclosure portal are the authoritative sources.",
};

/** The primary filing source for a symbol's market, with the ticker filled in. */
export function filingSource(ticker: string): FilingSource {
  const suffix = ticker && ticker.includes(".") ? ticker.split(".").pop()!.toUpperCase() : "";
  const base = ticker ? ticker.split(".")[0] : "";
  const src = FILING_SOURCES[suffix] ?? FILING_SOURCE_DEFAULT;
  return { ...src, url: src.url ? src.url.replace("{base}", base) : "" };
}

// Starting universes for the leaderboard. A pool is a place to begin, not an
// index: every figure in the ranking is still fetched live per symbol.
export const MARKET_POOLS: Record<string, string[]> = {
  "United States / global": [
    "AAPL", "MSFT", "NVDA", "GOOG", "AMZN", "META", "TSLA", "BRK-B", "LLY", "TSM",
    "AVGO", "V", "JPM", "WMT", "XOM", "UNH", "MA", "PG", "JNJ", "COST",
    "HD", "MRK", "ORCL", "ABBV", "CVX", "BAC", "KO", "PEP", "CRM", "AMD",
    "NFLX", "ADBE", "TMO", "ABT", "DIS", "MCD", "CSCO", "PFE", "INTC", "IBM",
    "GE", "CAT", "NKE", "TXN", "QCOM", "HON", "LOW", "SBUX", "GS", "MS",
  ],
  "Germany (DAX)": [
    "SAP.DE", "SIE.DE", "ALV.DE", "DTE.DE", "VOW3.DE", "BMW.DE", "BAS.DE", "ADS.DE",
    "MBG.DE", "IFX.DE", "AIR.DE", "MUV2.DE", "DB1.DE", "DHL.DE", "BEI.DE",
    "RWE.DE", "EOAN.DE", "BAYN.DE", "DBK.DE", "CBK.DE", "HEI.DE", "FRE.DE", "MRK.DE",
    "CON.DE", "PUM.DE", "ZAL.DE", "1COV.DE", "SY1.DE", "QIA.DE", "RHM.DE",
  ],
  "United Kingdom (FTSE)": [
    "SHEL.L", "AZN.L", "HSBA.L", "ULVR.L", "BP.L", "RIO.L", "GSK.L", "DGE.L", "BATS.L",
    "REL.L", "GLEN.L", "LSEG.L", "CNA.L", "NG.L", "LLOY.L",
    "VOD.L", "TSCO.L", "BARC.L", "PRU.L", "STAN.L", "IMB.L", "RKT.L", "CPG.L",
    "AAL.L", "NWG.L", "SGE.L", "SSE.L", "NXT.L", "LGEN.L", "AV.L",
  ],
  "Japan (Nikkei)": [
    "7203.T", "6758.T", "9432.T", "6861.T", "8035.T", "9984.T", "8058.T", "4063.T", "9983.T",
    "7974.T", "8306.T", "6098.T", "4568.T", "6501.T", "6902.T",
    "6367.T", "4661.T", "9433.T", "8001.T", "8031.T", "6752.T", "7267.T", "4502.T",
    "9020.T", "8766.T", "6981.T", "6503.T", "5108.T", "4901.T", "8802.T",
  ],
  "Vietnam (HOSE)": [
    "VCB.VN", "VHM.VN", "VIC.VN", "GAS.VN", "VNM.VN", "HPG.VN", "BID.VN", "MSN.VN", "SAB.VN",
    "CTG.VN", "TCB.VN", "VPB.VN", "MBB.VN", "FPT.VN", "MWG.VN",
    "PLX.VN", "POW.VN", "GVR.VN", "STB.VN", "SSI.VN", "VRE.VN", "PNJ.VN", "REE.VN",
    "KDH.VN", "ACB.VN",
  ],
};

// Share counts and rates live in the statements alongside monetary items;
// multiplying them by an FX rate would turn a share count into nonsense. These
// lines are left untouched on conversion.
/** Lines reported per share rather than in whole currency units. They need
 *  decimals: an EPS of 6.08 rounded to "6" tells the reader nothing, and its
 *  year-on-year change rounds to "-0". */
export const PER_SHARE_ITEMS = new Set(["Basic EPS", "Diluted EPS"]);

export const NON_CURRENCY_ITEMS = new Set([
  "Basic Average Shares", "Diluted Average Shares", "Share Issued",
  "Ordinary Shares Number", "Treasury Shares Number", "Tax Rate For Calcs",
  "Basic EPS", "Diluted EPS",
]);

export const BENCHMARKS = [
  { label: "SPY — S&P 500", symbol: "SPY" },
  { label: "QQQ — Nasdaq 100", symbol: "QQQ" },
  { label: "None", symbol: "" },
];

export const PORTFOLIO_CATEGORIES = [
  "Core equity", "International equity", "Fixed income & cash", "Other",
];
