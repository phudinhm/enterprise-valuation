"use client";

// The visual vocabulary every module is built from. Each primitive is defined
// once here and reused, and the ones that carry meaning also record themselves
// into the report registry.

import { useId, useState, type ReactNode } from "react";
import { useReport } from "@/components/report";
import { Markdown } from "@/components/ui/markdown";
import type { Tone } from "@/lib/format";
import type { ThemeTokens } from "@/lib/theme";

// --- section headers ---------------------------------------------------------

export function Section({ title, sub, record = true }: { title: string; sub?: string; record?: boolean }) {
  const report = useReport();
  const n = record ? report.section(`section:${title}`, { title, sub }) : 0;
  return (
    <>
      <div className="section">
        {record ? <span className="section-num">{String(n).padStart(2, "0")}</span> : null}
        <span className="section-title">{title}</span>
        <span className="section-rule" />
      </div>
      {sub ? <p className="section-sub">{sub}</p> : null}
    </>
  );
}

export function SubHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <div className="subhead">{title}</div>
      {sub ? <p className="section-sub">{sub}</p> : null}
    </>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

export function Card({ title, children, style }: { title?: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={style}>
      {title ? <div className="card-title">{title}</div> : null}
      <div className="card-body">{children}</div>
    </div>
  );
}

// --- KPI grid ----------------------------------------------------------------

export interface KpiItem {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  help?: string;
}

export function KpiGrid({
  items, minWidth = 190, record = true, id,
}: { items: KpiItem[]; minWidth?: number; record?: boolean; id?: string }) {
  const report = useReport();
  const auto = useId();
  if (record) {
    report.add(`kpis:${id ?? auto}`, {
      kind: "kpis",
      items: items.map((i) => ({ label: i.label, value: i.value, sub: i.sub })),
    });
  }
  return (
    <div className="kpi-grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))` }}>
      {items.map((item) => (
        <div key={item.label} className={`kpi ${item.tone ?? "flat"}`}>
          <div className="kpi-label">
            <span>{item.label}</span>
            {item.help ? (
              <span className="help-dot" title={item.help} aria-label={item.help}>
                ?
              </span>
            ) : null}
          </div>
          <div className="kpi-value">{item.value}</div>
          {item.sub ? <div className="kpi-sub">{item.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

// --- interpretation note -----------------------------------------------------

export type NoteTone = "pos" | "neg" | "warn" | "neu";

export function Note({
  text, tone = "neu", title = "Interpretation", record = true, id,
}: { text: string; tone?: NoteTone; title?: string; record?: boolean; id?: string }) {
  const report = useReport();
  const auto = useId();
  if (record) report.add(`note:${id ?? auto}`, { kind: "note", tone, text, title });
  return (
    <div className={`note ${tone}`}>
      <div className="note-title">{title}</div>
      <Markdown text={text} />
    </div>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return <div className={`banner ${tone}`}>{children}</div>;
}

export function Caption({ children }: { children: ReactNode }) {
  return <p className="caption">{children}</p>;
}

// --- checklist ---------------------------------------------------------------

export interface ChecklistRow {
  label: string;
  state: "pass" | "warn" | "fail" | "na";
  value: string;
  detail: string;
}

const MARKS: Record<ChecklistRow["state"], string> = { pass: "✓", warn: "!", fail: "✕", na: "–" };

export function Checklist({ rows }: { rows: ChecklistRow[] }) {
  return (
    <div>
      {rows.map((row) => (
        <div className="chk" key={row.label}>
          <div className={`chk-mark chk-${row.state}`}>{MARKS[row.state]}</div>
          <div>
            <span className="chk-label">{row.label}</span>
            {row.value ? <span className="chk-detail"> — {row.value}</span> : null}
            {row.detail ? <div className="chk-detail">{row.detail}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- score bars --------------------------------------------------------------

export function ScoreBars({
  pillars, theme,
}: { pillars: { name: string; score: number | null }[]; theme: ThemeTokens }) {
  return (
    <div className="card">
      {pillars.map((p) => {
        const value = p.score ?? 0;
        const colour = value >= 65 ? theme.success : value >= 40 ? theme.warning : theme.danger;
        return (
          <div className="score-row" key={p.name}>
            <div className="score-name">{p.name}</div>
            <div className="score-track">
              <div className="score-fill" style={{ width: `${Math.max(value, 1)}%`, background: colour }} />
            </div>
            <div className="score-val">{p.score === null ? "—" : value.toFixed(0)}</div>
          </div>
        );
      })}
    </div>
  );
}

// --- 52-week range bar -------------------------------------------------------

export function RangeBar({
  low, high, current, format,
}: { low: number; high: number; current: number; format: (v: number) => string }) {
  const span = high - low;
  const position = span > 0 ? Math.min(Math.max((current - low) / span, 0), 1) : 0;
  return (
    <div className="rng">
      <div className="rng-track">
        <div className="rng-fill" style={{ width: `${position * 100}%` }} />
        <div className="rng-mark" style={{ left: `calc(${position * 100}% - 1px)` }} />
      </div>
      <div className="rng-labels">
        <span>{format(low)}</span>
        <span>52-week range</span>
        <span>{format(high)}</span>
      </div>
    </div>
  );
}

// --- empty state -------------------------------------------------------------

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty-msg">{message}</div>
      {hint ? <div className="empty-hint">{hint}</div> : null}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="spinner-line">
      <span className="spinner-dot" />
      <span>{label}</span>
    </div>
  );
}

// --- controls ----------------------------------------------------------------

export function Segmented<T extends string>({
  label, options, value, onChange, help,
}: { label?: string; options: readonly T[]; value: T; onChange: (v: T) => void; help?: string }) {
  return (
    <div>
      {label ? (
        <label className="field" title={help}>
          {label}
          {help ? <span className="help-dot" style={{ marginLeft: 6 }} title={help}>?</span> : null}
        </label>
      ) : null}
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === value}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Tabs({
  tabs, active, onChange,
}: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === active}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label, help, children,
}: { label: string; help?: string; children: ReactNode }) {
  return (
    <div>
      <label className="field" title={help}>
        {label}
        {help ? <span className="help-dot" style={{ marginLeft: 6 }} title={help}>?</span> : null}
      </label>
      {children}
    </div>
  );
}

export function Slider({
  label, min, max, step, value, onChange, format, help,
}: {
  label: string; min: number; max: number; step: number; value: number;
  onChange: (v: number) => void; format?: (v: number) => string; help?: string;
}) {
  return (
    <Field label={label} help={help}>
      <div className="slider-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
        />
        <span className="slider-val">{format ? format(value) : value}</span>
      </div>
    </Field>
  );
}

export function Explain({
  open, children,
}: { open?: boolean; children: ReactNode }) {
  const [isOpen, setOpen] = useState(Boolean(open));
  return (
    <details className="explain" open={isOpen} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>How to read this figure</summary>
      <div className="exp-block">{children}</div>
    </details>
  );
}
