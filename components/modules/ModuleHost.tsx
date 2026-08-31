"use client";

// Modules are loaded on demand: opening the guide downloads no chart code, and
// a reader who never opens the portfolio never pays for it.

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { ModuleProps } from "@/components/modules/types";
import type { ThemeTokens } from "@/lib/theme";
import { Loading } from "@/components/ui/primitives";

const loading = () => <Loading label="Preparing this module…" />;

const REGISTRY: Record<string, ComponentType<ModuleProps>> = {
  "Executive Dashboard": dynamic(() => import("./ExecutiveDashboard"), { loading }),
  "Technical Analysis": dynamic(() => import("./TechnicalAnalysis"), { loading }),
  "Financial Statements": dynamic(() => import("./FinancialStatements"), { loading }),
  "Cash Flow Quality": dynamic(() => import("./CashFlowQuality"), { loading }),
  "Capital Allocation": dynamic(() => import("./CapitalAllocation"), { loading }),
  "Solvency & Debt": dynamic(() => import("./Solvency"), { loading }),
  "Dilution & Owner Earnings": dynamic(() => import("./Dilution"), { loading }),
  "Intrinsic Valuation": dynamic(() => import("./IntrinsicValuation"), { loading }),
  "Peer Comparables": dynamic(() => import("./PeerComparables"), { loading }),
  "Compare Companies": dynamic(() => import("./CompareCompanies"), { loading }),
  "Risk & Scenarios": dynamic(() => import("./RiskScenarios"), { loading }),
  "Investment Simulator": dynamic(() => import("./InvestmentSimulator"), { loading }),
  Portfolio: dynamic(() => import("./Portfolio"), { loading }),
  "Price & Capital Dynamics": dynamic(() => import("./PriceDynamics"), { loading }),
  "Market Leaders": dynamic(() => import("./MarketLeaders"), { loading }),
};

const Guide = dynamic(() => import("./Guide"), { loading });

export default function ModuleHost({
  module, props, theme,
}: { module: string; props: ModuleProps | null; theme: ThemeTokens }) {
  if (module === "Guide & Method" || !props) return <Guide theme={theme} />;
  const Component = REGISTRY[module];
  if (!Component) return null;
  return <Component {...props} />;
}
