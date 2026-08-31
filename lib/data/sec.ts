// Backup statement source: the SEC's XBRL company-facts API — the filings
// themselves, straight from the regulator. US filers only, but authoritative,
// and it needs no API key.
//
// The SEC asks that automated requests identify themselves; that is the
// User-Agent below. The 10-requests-per-second guidance is respected simply by
// how little this is called: twice per company, both cached for a day.

import { getJson } from "@/lib/data/http";
import { isNum } from "@/lib/format";
import type { Statement, Statements } from "@/lib/data/frame";
import { EMPTY_STATEMENT, EMPTY_STATEMENTS } from "@/lib/data/frame";
import { completeStatements } from "@/lib/data/yahoo";

const SEC_UA = "Investment Terminal research app (contact via repository)";

// XBRL concepts mapped onto the line-item names the rest of the app expects, so
// a statement rebuilt from EDGAR is indistinguishable downstream.
const SEC_INCOME: Record<string, string[]> = {
  "Total Revenue": [
    "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues",
    "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax",
  ],
  "Cost Of Revenue": ["CostOfGoodsAndServicesSold", "CostOfRevenue"],
  "Gross Profit": ["GrossProfit"],
  "Research And Development": ["ResearchAndDevelopmentExpense"],
  "Selling General And Administration": ["SellingGeneralAndAdministrativeExpense"],
  "Operating Expense": ["OperatingExpenses", "CostsAndExpenses"],
  "Operating Income": ["OperatingIncomeLoss"],
  "Interest Expense": ["InterestExpense", "InterestIncomeExpenseNet"],
  "Pretax Income": [
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  ],
  "Tax Provision": ["IncomeTaxExpenseBenefit"],
  "Net Income": ["NetIncomeLoss", "ProfitLoss"],
};

const SEC_INCOME_PERSHARE: Record<string, string[]> = {
  "Basic EPS": ["EarningsPerShareBasic"],
  "Diluted EPS": ["EarningsPerShareDiluted"],
};

const SEC_INCOME_SHARES: Record<string, string[]> = {
  "Basic Average Shares": ["WeightedAverageNumberOfSharesOutstandingBasic"],
  "Diluted Average Shares": ["WeightedAverageNumberOfDilutedSharesOutstanding"],
};

const SEC_BALANCE: Record<string, string[]> = {
  "Cash And Cash Equivalents": ["CashAndCashEquivalentsAtCarryingValue"],
  "Accounts Receivable": ["AccountsReceivableNetCurrent"],
  Inventory: ["InventoryNet"],
  "Current Assets": ["AssetsCurrent"],
  "Net PPE": ["PropertyPlantAndEquipmentNet"],
  Goodwill: ["Goodwill"],
  "Total Assets": ["Assets"],
  "Accounts Payable": ["AccountsPayableCurrent"],
  "Current Liabilities": ["LiabilitiesCurrent"],
  "Current Debt": ["LongTermDebtCurrent", "DebtCurrent"],
  "Long Term Debt": ["LongTermDebtNoncurrent", "LongTermDebt"],
  "Total Liabilities Net Minority Interest": ["Liabilities"],
  "Retained Earnings": ["RetainedEarningsAccumulatedDeficit"],
  "Stockholders Equity": [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  ],
  "Ordinary Shares Number": ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"],
  "Total Debt": ["DebtLongtermAndShorttermCombinedAmount"],
};

const SEC_CASHFLOW: Record<string, string[]> = {
  "Operating Cash Flow": [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ],
  "Depreciation And Amortization": [
    "DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet",
  ],
  "Stock Based Compensation": ["ShareBasedCompensation"],
  "Capital Expenditure": ["PaymentsToAcquirePropertyPlantAndEquipment"],
  "Investing Cash Flow": ["NetCashProvidedByUsedInInvestingActivities"],
  "Financing Cash Flow": ["NetCashProvidedByUsedInFinancingActivities"],
  "Cash Dividends Paid": ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
  "Repurchase Of Capital Stock": ["PaymentsForRepurchaseOfCommonStock"],
};

const ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F"]);
const QUARTER_FORMS = new Set(["10-Q"]);

interface TickerMapRow {
  ticker?: string;
  cik_str?: number;
}

/** Maps a ticker to its SEC central index key. US listings only. */
export async function secCik(ticker: string): Promise<string | null> {
  const upper = (ticker || "").toUpperCase();
  // A symbol carrying any suffix other than .US is not a US filer.
  if (upper.includes(".") && !upper.endsWith(".US")) return null;
  const base = upper.split(".")[0].replace(/-/g, "");
  if (!base) return null;

  const data = await getJson<Record<string, TickerMapRow>>(
    "https://www.sec.gov/files/company_tickers.json",
    { headers: { "User-Agent": SEC_UA }, revalidate: 86400, timeoutMs: 20000 },
  );
  for (const row of Object.values(data ?? {})) {
    if (String(row.ticker ?? "").toUpperCase().replace(/-/g, "") === base && isNum(row.cik_str)) {
      return `CIK${String(row.cik_str).padStart(10, "0")}`;
    }
  }
  return null;
}

interface FactEntry {
  form?: string;
  val?: number;
  start?: string;
  end?: string;
}

interface CompanyFacts {
  facts?: Record<string, Record<string, { units?: Record<string, FactEntry[]> }>>;
}

/** One concept's reported values, keyed by period end.
 *
 *  Duration facts (revenue, cash flow) are filtered by how long the period they
 *  cover actually is, because the same tag carries quarterly, half-year and
 *  annual values in one list and only the period length separates them. */
function secSeries(
  facts: CompanyFacts, tags: string[], instant: boolean, annual: boolean,
): Map<string, number> | null {
  const pool: Record<string, { units?: Record<string, FactEntry[]> }> = {};
  for (const ns of ["us-gaap", "ifrs-full", "dei"]) {
    Object.assign(pool, facts.facts?.[ns] ?? {});
  }
  const forms = annual ? ANNUAL_FORMS : QUARTER_FORMS;

  for (const tag of tags) {
    const node = pool[tag];
    if (!node) continue;
    for (const unit of ["USD", "USD/shares", "shares"]) {
      const entries = node.units?.[unit];
      if (!entries?.length) continue;
      const out = new Map<string, number>();
      for (const e of entries) {
        if (!e.form || !forms.has(e.form) || !isNum(e.val) || !e.end) continue;
        if (!instant) {
          if (!e.start) continue;
          const span = (Date.parse(e.end) - Date.parse(e.start)) / 86400000;
          const ok = annual ? span >= 330 && span <= 400 : span >= 60 && span <= 110;
          if (!ok) continue;
        }
        out.set(e.end, e.val);
      }
      if (out.size) return out;
    }
  }
  return null;
}

function buildFromFacts(
  facts: CompanyFacts, mappings: Record<string, string[]>[], instant: boolean, annual: boolean,
): Statement {
  const byLine = new Map<string, Map<string, number>>();
  const periodSet = new Set<string>();
  for (const mapping of mappings) {
    for (const [name, tags] of Object.entries(mapping)) {
      const series = secSeries(facts, tags, instant, annual);
      if (!series) continue;
      byLine.set(name, series);
      for (const key of series.keys()) periodSet.add(key);
    }
  }
  const periods = [...periodSet].sort();
  if (!periods.length) return EMPTY_STATEMENT;
  const rows: Record<string, (number | null)[]> = {};
  for (const [name, series] of byLine) {
    rows[name] = periods.map((p) => series.get(p) ?? null);
  }
  return { periods, rows };
}

/** Income statement, balance sheet and cash flow rebuilt from EDGAR's XBRL
 *  company facts, in the same shape as the primary source's. */
export async function fetchSecStatements(ticker: string, quarterly = false): Promise<Statements> {
  const cik = await secCik(ticker);
  if (!cik) return EMPTY_STATEMENTS;

  const facts = await getJson<CompanyFacts>(
    `https://data.sec.gov/api/xbrl/companyfacts/${cik}.json`,
    { headers: { "User-Agent": SEC_UA }, revalidate: 86400, timeoutMs: 25000 },
  );
  const annual = !quarterly;

  const inc = buildFromFacts(facts, [SEC_INCOME, SEC_INCOME_PERSHARE, SEC_INCOME_SHARES], false, annual);
  const bs = buildFromFacts(facts, [SEC_BALANCE], true, annual);
  const cf = buildFromFacts(facts, [SEC_CASHFLOW], false, annual);

  // EDGAR reports capital expenditure as a positive outflow; the rest of the
  // app follows the cash-flow-statement convention of a negative number.
  if (cf.rows["Capital Expenditure"]) {
    cf.rows["Capital Expenditure"] = cf.rows["Capital Expenditure"].map((v) =>
      isNum(v) ? -Math.abs(v) : null,
    );
  }

  return completeStatements({ inc, bs, cf });
}
