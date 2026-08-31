// What each reported line actually means, what moves it, and what to watch.
// Keyed on the data source's own line-item names so the guide can be attached
// automatically to whatever the company happens to report.

export interface LineItemGuide {
  what: string;
  drivers: string;
  watch: string;
}

export const LINE_ITEMS: Record<string, LineItemGuide> = {
  "Total Revenue": {
    what: "Money billed to customers for goods and services over the period, after returns, discounts and rebates. It is the top line every other figure is measured against.",
    drivers: "Volume sold, price per unit, product mix, currency translation on foreign sales, and — where relevant — how much of a long contract the accountants judge to have been delivered.",
    watch: "Growth that comes only from price rises is more fragile than growth from volume. Revenue rising while receivables rise faster (the quality flags on the dashboard) can mean sales are being pulled forward on looser credit terms.",
  },
  "Cost Of Revenue": {
    what: "The direct cost of producing what was sold: materials, manufacturing labour, freight in, and the depreciation of production equipment. Costs that would disappear if the product were not made.",
    drivers: "Input and commodity prices, factory utilisation, wage rates, logistics costs, and manufacturing yield.",
    watch: "Rising faster than revenue means gross margin is compressing — either inputs cost more or pricing power has weakened. Which one it is decides whether it reverses.",
  },
  "Gross Profit": {
    what: "Revenue less the direct cost of delivering it. What is left to cover everything else: research, selling, administration, interest and tax.",
    drivers: "Pricing power, product mix, and manufacturing or delivery efficiency.",
    watch: "Gross margin is the most durable indicator of competitive position. It moves slowly, so a sustained shift in either direction is usually structural rather than noise.",
  },
  "Operating Expense": {
    what: "The cost of running the business rather than making the product: research, sales and marketing, and general administration.",
    drivers: "Headcount, marketing intensity, R&D commitment, and how much of the cost base is fixed.",
    watch: "Growing more slowly than revenue is operating leverage and lifts margins. Growing faster is either investment for future growth or loss of cost discipline — the following years tell you which.",
  },
  "Research And Development": {
    what: "Spending on developing new products and improving existing ones, expensed as incurred rather than capitalised.",
    drivers: "Engineering headcount, project pipeline, and how fast the industry's technology moves.",
    watch: "Cutting R&D flatters this year's margin at the expense of the products that would have shipped in three years. Judge it as a percentage of revenue over time, not in absolute terms.",
  },
  "Selling General And Administration": {
    what: "Salaries and costs of the sales force, marketing programmes, finance, legal, HR and executive functions.",
    drivers: "Sales headcount and commission, advertising commitments, and the fixed overhead of running a listed company.",
    watch: "For consumer businesses this is largely discretionary marketing, so it is the first lever pulled when a quarter looks weak — and the reason a margin beat is not always good news.",
  },
  "Operating Income": {
    what: "Profit from the core business before financing costs and tax. The cleanest measure of whether the operation itself makes money.",
    drivers: "Everything above it: revenue, direct costs and overheads.",
    watch: "This is the figure to compare across companies, because it is unaffected by how each one chooses to finance itself.",
  },
  EBITDA: {
    what: "Operating profit before depreciation and amortisation are subtracted — a rough proxy for cash operating earnings.",
    drivers: "The same operating factors, with non-cash charges added back.",
    watch: "It flatters capital-intensive businesses by ignoring the cost of the assets they must keep replacing. Always read it beside capital expenditure.",
  },
  "Interest Expense": {
    what: "The cost of borrowed money over the period.",
    drivers: "Debt outstanding, the fixed-versus-floating mix, and prevailing rates when debt is refinanced.",
    watch: "Compare against operating profit for interest cover. A company refinancing low-rate debt into a higher-rate market sees this line step up years before the debt itself changes.",
  },
  "Pretax Income": {
    what: "Profit after operating costs and financing but before tax.",
    drivers: "Operating income, net interest, and one-off gains or losses.",
    watch: "A large gap between operating income and pre-tax income means non-operating items are doing meaningful work — worth identifying before treating the result as repeatable.",
  },
  "Tax Provision": {
    what: "The tax charged against this period's profit, which is an accounting estimate rather than cash paid to a tax authority.",
    drivers: "Statutory rates in each country of operation, profit mix by geography, and one-off settlements or credits.",
    watch: "An unusually low effective rate in one year often reverses. The DCF clamps the derived rate to a sensible band for exactly this reason.",
  },
  "Net Income": {
    what: "The bottom line: profit attributable to shareholders after every cost, including tax.",
    drivers: "Everything above, plus one-off items that may not repeat.",
    watch: "The most managed number in the statements. The cash flow quality module checks it against cash, which is much harder to influence.",
  },
  "Basic EPS": {
    what: "Net income divided by the average number of shares outstanding.",
    drivers: "Profit, and the share count — buybacks raise it without the business improving.",
    watch: "Compare EPS growth against net income growth. A gap between them is the buyback, not the business.",
  },
  "Diluted EPS": {
    what: "Earnings per share assuming all options, convertibles and restricted stock become shares.",
    drivers: "Profit and the fully diluted share count.",
    watch: "A wide gap to basic EPS signals heavy equity compensation — a real cost to existing holders that never appears as cash.",
  },

  "Cash And Cash Equivalents": {
    what: "Money in the bank and instruments convertible to cash within about three months.",
    drivers: "Operating cash generation, capital spending, borrowing, dividends and buybacks.",
    watch: "Read alongside debt, not on its own. Large cash balances held against larger borrowings are often trapped in the wrong jurisdiction.",
  },
  "Accounts Receivable": {
    what: "Money owed by customers for goods already delivered and recognised as revenue.",
    drivers: "Sales volume, payment terms offered, and how promptly customers actually pay.",
    watch: "Growing faster than revenue means either customers are slower to pay or terms were loosened to close sales. Both bring the cash further out.",
  },
  Inventory: {
    what: "Raw materials, work in progress and finished goods not yet sold.",
    drivers: "Production plans, demand forecasts and supply-chain lead times.",
    watch: "Rising faster than revenue is the classic early signal of demand coming in below plan, and it usually ends in discounting that shows up in gross margin two quarters later.",
  },
  "Current Assets": {
    what: "Everything expected to convert to cash within a year.",
    drivers: "Cash, receivables and inventory.",
    watch: "Against current liabilities this is the liquidity question: can the next twelve months of obligations be met from the next twelve months of assets.",
  },
  "Net PPE": {
    what: "Property, plant and equipment after accumulated depreciation — the physical asset base.",
    drivers: "Capital expenditure less depreciation, plus acquisitions and disposals.",
    watch: "Shrinking net PPE while revenue grows means the asset base is being run harder, which raises returns until maintenance can no longer be deferred.",
  },
  Goodwill: {
    what: "The premium paid for acquisitions over the fair value of the identifiable assets bought.",
    drivers: "Acquisition activity and prices paid.",
    watch: "It is never a source of cash. Large goodwill relative to equity means an impairment could wipe out a big share of book value without any cash changing hands.",
  },
  "Total Assets": {
    what: "Everything the company owns or controls, at carrying value.",
    drivers: "Retained profits, borrowing, share issuance and acquisitions.",
    watch: "Assets growing faster than revenue means each unit of assets is producing less — falling asset turnover, and the second term of the DuPont breakdown on the dashboard.",
  },
  "Accounts Payable": {
    what: "Money owed to suppliers for goods and services already received.",
    drivers: "Purchase volumes and the payment terms suppliers grant.",
    watch: "Stretching payables is a cheap source of funding until suppliers push back. A sudden fall can quietly consume a quarter's cash flow.",
  },
  "Current Debt": {
    what: "Borrowings falling due within twelve months, including the current portion of longer-term debt.",
    drivers: "The maturity schedule and short-term facility use.",
    watch: "This is the refinancing risk. Large near-term maturities alongside thin cash means the company must go to the market on the market's terms.",
  },
  "Current Liabilities": {
    what: "All obligations due within a year.",
    drivers: "Payables, short-term debt, accrued costs and deferred revenue.",
    watch: "Deferred revenue inside this line is a good liability — customers who have already paid — and worth separating from the rest.",
  },
  "Long Term Debt": {
    what: "Borrowings due beyond twelve months.",
    drivers: "Issuance, repayment and refinancing decisions.",
    watch: "The level matters less than the cost and the maturity wall. Cheap long-dated debt is an asset; expensive debt maturing soon is a problem.",
  },
  "Total Liabilities Net Minority Interest": {
    what: "Everything owed to anyone other than shareholders.",
    drivers: "Debt, payables, provisions, leases and deferred tax.",
    watch: "Against total assets this gives the plain leverage picture, without the definitional arguments about what counts as debt.",
  },
  "Retained Earnings": {
    what: "Cumulative profit kept in the business rather than paid out, since inception.",
    drivers: "Net income less dividends, plus accounting adjustments.",
    watch: "A negative balance means the company has lost more over its life than it has earned, or has returned more than it made.",
  },
  "Stockholders Equity": {
    what: "The shareholders' residual claim: total assets less total liabilities. Book value.",
    drivers: "Retained profit, share issuance and buybacks.",
    watch: "Buybacks reduce equity, which mechanically raises return on equity without any operational improvement. Cross-check against return on assets.",
  },

  "Operating Cash Flow": {
    what: "Cash generated by trading, after working capital movements and before investment.",
    drivers: "Profit, non-cash charges added back, and swings in receivables, inventory and payables.",
    watch: "The single hardest figure to manipulate, and the reason the cash flow quality module compares it against net income.",
  },
  "Depreciation And Amortization": {
    what: "The accounting cost of using up long-lived assets, spread over their useful life. No cash leaves the business.",
    drivers: "The asset base and the depreciation policy applied to it.",
    watch: "Persistently below capital expenditure means the asset base is growing; persistently above means it is shrinking and today's earnings are borrowing from tomorrow's capacity.",
  },
  "Stock Based Compensation": {
    what: "The value of shares and options granted to employees, expensed but paid in equity rather than cash.",
    drivers: "Headcount, grant policy and the share price at grant.",
    watch: "Added back in cash flow because no cash moved, but it is a genuine cost to existing holders — it shows up as dilution in the share count instead.",
  },
  "Change In Working Capital": {
    what: "Cash absorbed or released by movements in receivables, inventory and payables.",
    drivers: "Growth rate, seasonality, and payment discipline on both sides.",
    watch: "Growing companies normally absorb working capital; a large release can flatter one period's cash flow and cannot repeat indefinitely.",
  },
  "Capital Expenditure": {
    what: "Cash spent on property, plant, equipment and other long-lived assets. Reported as a negative figure.",
    drivers: "Maintenance needs plus growth projects.",
    watch: "Splitting maintenance from growth capex is the key judgement in any valuation, and companies rarely disclose it. Depreciation is a rough proxy for the maintenance half.",
  },
  "Free Cash Flow": {
    what: "Operating cash flow less capital expenditure: the cash genuinely available to lenders and owners.",
    drivers: "Everything in the operating and investing sections.",
    watch: "This is what the DCF discounts. One unusual year should not anchor a valuation, which is why the model offers a normalised median instead.",
  },
  "Cash Dividends Paid": {
    what: "Cash actually paid out to shareholders during the period.",
    drivers: "The declared dividend per share and the share count.",
    watch: "Against free cash flow this is the dividend safety test, and a far better one than the earnings-based payout ratio.",
  },
  "Repurchase Of Capital Stock": {
    what: "Cash spent buying back the company's own shares.",
    drivers: "Board authorisation, spare cash and the share price.",
    watch: "Buybacks funded by debt at a high valuation destroy value as reliably as they create it when done cheaply. Check the share count actually fell — many buybacks only offset the shares issued to employees.",
  },
  "Net Issuance Payments Of Debt": {
    what: "Net cash raised from, or repaid to, lenders.",
    drivers: "Financing needs and refinancing schedules.",
    watch: "Positive year after year alongside negative free cash flow means the business is being funded by lenders rather than by customers.",
  },
};

// Typical cost structure by sector. Filings differ in how much they break out,
// so this states what usually sits inside these lines for a company of this
// type rather than inventing a breakdown the data source does not provide.
export const SECTOR_COST_NOTES: Record<string, { cogs: string; opex: string }> = {
  Technology: {
    cogs: "hosting and data-centre capacity, third-party licences, hardware components and contract manufacturing, plus support staff attached to delivery",
    opex: "engineering salaries inside research and development, with sales commissions and marketing making up most of the selling cost",
  },
  "Consumer Cyclical": {
    cogs: "raw materials, contract manufacturing, inbound freight and warehousing, plus store or fulfilment labour where retail is involved",
    opex: "store or platform operating costs, advertising, and distribution",
  },
  "Consumer Defensive": {
    cogs: "agricultural and packaging inputs, plant labour, energy and distribution",
    opex: "trade marketing and promotional spend, often as large a swing factor as input costs",
  },
  Healthcare: {
    cogs: "manufacturing of compounds or devices, quality control, and royalties on licensed intellectual property",
    opex: "clinical trial costs inside research and development, and a large specialised sales force",
  },
  "Financial Services": {
    cogs: "interest paid to depositors and lenders, and credit losses — the revenue line itself is interest and fee income, so conventional margin analysis does not transfer",
    opex: "compensation, technology and regulatory compliance",
  },
  Energy: {
    cogs: "extraction, refining and transport costs, plus depletion of reserves",
    opex: "field administration and exploration costs written off",
  },
  Industrials: {
    cogs: "steel and component inputs, factory labour, energy and freight",
    opex: "engineering, aftermarket service networks and distribution",
  },
  "Basic Materials": {
    cogs: "ore, feedstock and energy, which together usually dominate the cost base and make margins swing with commodity prices",
    opex: "logistics and site administration",
  },
  "Communication Services": {
    cogs: "content licensing and production, network capacity and interconnect fees",
    opex: "subscriber acquisition marketing and platform engineering",
  },
  Utilities: {
    cogs: "fuel and purchased power, and network maintenance",
    opex: "regulatory compliance and customer service",
  },
  "Real Estate": {
    cogs: "property operating costs, maintenance and property taxes",
    opex: "leasing commissions and corporate administration",
  },
};
