import type { Company } from "@/lib/data/types";
import type { Extras } from "@/lib/analytics/scorecard";
import type { ThemeTokens } from "@/lib/theme";
import type { StatementBasis } from "@/lib/constants";

/** What every module receives. Assembled once by the shell so a module never
 *  has to know how the company was loaded or how the currency was resolved. */
export interface ModuleProps {
  co: Company;
  extras: Extras;
  /** Multiplier from the company's reporting currency to the display one. */
  fx: number;
  /** Currency symbol for the display currency. */
  sym: string;
  targetCurrency: string;
  nativeCurrency: string;
  theme: ThemeTokens;
  basis: StatementBasis;
  period: string;
  periodLabel: string;
  interval: string;
  explainOpen: boolean;
}
