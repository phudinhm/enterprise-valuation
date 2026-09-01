"use client";

// A live read of whether the upstream providers are answering.
//
// The failure that matters most — a provider refusing this deployment's address
// range — looks identical from the outside to "this company does not exist".
// This panel tells the two apart, and names which provider is at fault.

import { useState } from "react";
import { apiGet } from "@/lib/useApi";

interface HealthCheck {
  name: string;
  affects: string;
  ok: boolean;
  ms: number;
  detail: string;
}

interface Health {
  ok: boolean;
  summary: string;
  region: string;
  checkedAt: string;
  checks: HealthCheck[];
}

export default function SourceStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [open, setOpen] = useState(false);

  async function run() {
    setOpen(true);
    setState("busy");
    try {
      // Bypass the client cache: the point is the state right now.
      const data = await apiGet<Health>(`/api/health?t=${Date.now()}`);
      // A diagnostics panel that crashes the page when diagnostics come back
      // malformed would be worse than useless, so the shape is checked rather
      // than assumed.
      if (!data || !Array.isArray(data.checks)) {
        setHealth(null);
        setState("error");
        return;
      }
      setHealth(data);
      setState("done");
    } catch {
      setHealth(null);
      setState("error");
    }
  }

  const dot =
    state === "busy" ? "busy" : state === "done" ? (health?.ok ? "ok" : "bad") : state === "error" ? "bad" : "";

  const label =
    state === "busy"
      ? "Checking data sources…"
      : state === "done"
        ? health?.ok
          ? "All data sources responding"
          : `${health?.checks.filter((c) => !c.ok).length ?? 0} source(s) failing`
        : state === "error"
          ? "Could not run the check"
          : "Check data sources";

  return (
    <div>
      <button type="button" className="status-chip" onClick={run}>
        <span className={`status-dot ${dot}`} />
        <span>{label}</span>
      </button>

      {open && health?.checks?.length ? (
        <div className="status-detail">
          {health.checks.map((c) => (
            <div className="status-row" key={c.name}>
              <span className={`status-dot ${c.ok ? "ok" : "bad"}`} style={{ marginTop: 5 }} />
              <span>
                <span className="status-name">{c.name}</span>
                <span className="status-affects">
                  {" "}
                  — {c.ok ? c.detail : c.affects}
                </span>
                {c.ok ? null : <div className="status-why">{c.detail}</div>}
              </span>
              <span className="status-ms">{c.ms}ms</span>
            </div>
          ))}
          <p className="caption" style={{ marginTop: 8 }}>
            Region {health.region}. When a provider fails here but works in your browser, it is refusing this
            deployment&apos;s address range rather than being down.
          </p>
        </div>
      ) : null}

      {state === "error" ? (
        <p className="caption">
          The check itself could not run. Open <code>/api/health</code> directly for the raw result.
        </p>
      ) : null}
    </div>
  );
}
