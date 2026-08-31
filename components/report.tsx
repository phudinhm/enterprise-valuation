"use client";

// Everything rendered in a module registers itself here, which is what makes
// the exported report an exact transcript of what the analyst was looking at —
// same figures, same numbering, same captions.

import { createContext, useContext, useRef, type ReactNode } from "react";

export type BlockKind = "section" | "kpis" | "note" | "figure" | "table" | "text";

export interface ReportBlock {
  kind: BlockKind;
  key: string;
  n?: number;
  num?: string;
  title?: string;
  sub?: string;
  tone?: string;
  text?: string;
  items?: { label: string; value: string; sub?: string }[];
  what?: string;
  how?: string;
  why?: string;
  /** Plotly figure payload, so exported charts stay interactive. */
  figure?: { data: unknown[]; layout: Record<string, unknown> };
  /** Rendered table, as header + rows of already-formatted strings. */
  table?: { columns: string[]; rows: string[][] };
}

interface Registry {
  blocks: Map<string, ReportBlock>;
  order: string[];
  sectionNumbers: Map<string, number>;
  figureNumbers: Map<string, string>;
  figureCounts: Map<number, number>;
  currentSection: number;
}

function emptyRegistry(): Registry {
  return {
    blocks: new Map(),
    order: [],
    sectionNumbers: new Map(),
    figureNumbers: new Map(),
    figureCounts: new Map(),
    currentSection: 0,
  };
}

export interface ReportApi {
  /** Allocates (or recalls) a section number for this title. */
  section(key: string, block: Omit<ReportBlock, "kind" | "key" | "n">): number;
  /** Allocates (or recalls) a "section.figure" reference. */
  figure(key: string, build: (num: string) => ReportBlock): string;
  /** Records a non-numbered block. */
  add(key: string, block: Omit<ReportBlock, "key">): void;
  blocks(): ReportBlock[];
  reset(): void;
}

const ReportContext = createContext<ReportApi | null>(null);

export function ReportProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Registry>(emptyRegistry());

  // Allocation is keyed by a stable string rather than call order, so a strict
  // mode double render — or a tab switching back and forth — never renumbers a
  // figure that the reader has already quoted.
  const api: ReportApi = {
    section(key, block) {
      const reg = ref.current;
      let n = reg.sectionNumbers.get(key);
      if (n === undefined) {
        n = reg.sectionNumbers.size + 1;
        reg.sectionNumbers.set(key, n);
      }
      reg.currentSection = n;
      api.add(key, { kind: "section", n, ...block });
      return n;
    },
    figure(key, build) {
      const reg = ref.current;
      let num = reg.figureNumbers.get(key);
      if (num === undefined) {
        const section = Math.max(reg.currentSection, 1);
        const count = (reg.figureCounts.get(section) ?? 0) + 1;
        reg.figureCounts.set(section, count);
        num = `${section}.${count}`;
        reg.figureNumbers.set(key, num);
      }
      const block = build(num);
      api.add(key, block);
      return num;
    },
    add(key, block) {
      const reg = ref.current;
      if (!reg.blocks.has(key)) reg.order.push(key);
      reg.blocks.set(key, { ...block, key } as ReportBlock);
    },
    blocks() {
      const reg = ref.current;
      return reg.order.map((k) => reg.blocks.get(k)).filter(Boolean) as ReportBlock[];
    },
    reset() {
      ref.current = emptyRegistry();
    },
  };

  return <ReportContext.Provider value={api}>{children}</ReportContext.Provider>;
}

export function useReport(): ReportApi {
  const ctx = useContext(ReportContext);
  if (ctx) return ctx;
  // A module rendered outside a provider still works; it simply is not
  // exportable, which is better than crashing the page.
  const noop: ReportApi = {
    section: () => 1,
    figure: (_k, build) => {
      build("1.1");
      return "1.1";
    },
    add: () => {},
    blocks: () => [],
    reset: () => {},
  };
  return noop;
}
