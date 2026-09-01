import { UA } from "@/lib/data/http";
import { sessionDiagnostics, fetchChart, fetchInfo, fetchStatements, searchYahoo } from "@/lib/data/yahoo";
import { stooqHistory } from "@/lib/data/stooq";
import { secCik } from "@/lib/data/sec";
import { isEmpty } from "@/lib/data/frame";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface HealthCheck {
  name: string;
  /** What breaks for the reader when this one fails. */
  affects: string;
  ok: boolean;
  ms: number;
  detail: string;
}

async function timed(
  name: string, affects: string, run: () => Promise<string>,
): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const detail = await run();
    return { name, affects, ok: true, ms: Date.now() - started, detail };
  } catch (err) {
    return {
      name,
      affects,
      ok: false,
      ms: Date.now() - started,
      detail: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    };
  }
}

/** Probes every upstream the app depends on and reports which ones answer.
 *
 *  This exists because the failure that matters — an upstream refusing this
 *  deployment's address range — cannot be reproduced anywhere except from the
 *  deployment itself. Open /api/health on the deployed URL and the answer is
 *  in front of you, rather than inferred from an empty page. */
export async function GET() {
  const checks = await Promise.all([
    timed("Yahoo chart", "prices, the 52-week range, and every chart", async () => {
      const { bars } = await fetchChart("AAPL", "5d", "1d", 0);
      if (!bars.length) throw new Error("answered, but returned no bars");
      return `${bars.length} bars, last close ${bars[bars.length - 1].close?.toFixed(2)}`;
    }),

    timed("Yahoo crumb", "everything below that needs authentication", async () => {
      // Force a negotiation by asking for something that requires one.
      await fetchInfo("AAPL", 0).catch(() => undefined);
      const s = sessionDiagnostics();
      if (!s.hasSession) throw new Error(s.lastError || "no session obtained");
      return `crumb obtained (${s.crumbLength} chars)`;
    }),

    timed("Yahoo quote summary", "headline metrics, sector, analyst targets", async () => {
      const info = await fetchInfo("AAPL", 0);
      const n = Object.keys(info).length;
      if (!n) throw new Error("answered, but returned no fields");
      return `${n} fields`;
    }),

    timed("Yahoo fundamentals", "the financial statements", async () => {
      const st = await fetchStatements("AAPL", false, 0);
      if (isEmpty(st.inc)) throw new Error("answered, but returned no income statement");
      return `${st.inc.periods.length} annual periods`;
    }),

    timed("Yahoo search", "resolving a company name to a symbol", async () => {
      const out = await searchYahoo("apple", 5);
      const tried = out.attempts.map((a) => `${a.route}: ${a.detail}`).join(" · ");
      if (!out.hits.length) throw new Error(tried || "no route returned hits");
      return `${out.hits.length} hits via ${out.route}`;
    }),

    timed("Stooq", "the price backup when Yahoo is throttled", async () => {
      const bars = await stooqHistory("AAPL");
      if (!bars.length) throw new Error("answered, but returned no rows");
      return `${bars.length} daily rows`;
    }),

    timed("SEC EDGAR", "the statement backup for US filers", async () => {
      const cik = await secCik("AAPL");
      if (!cik) throw new Error("ticker map answered, but the symbol did not resolve");
      return `resolved to ${cik}`;
    }),

    timed("Egress address", "which address upstreams see, if one is blocking", async () => {
      const res = await fetch("https://api.ipify.org?format=json", {
        headers: { "User-Agent": UA },
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      const body = (await res.json()) as { ip?: string };
      return body.ip ?? "unknown";
    }),
  ]);

  const failed = checks.filter((c) => !c.ok);
  return new Response(
    JSON.stringify(
      {
        ok: failed.length === 0,
        summary: failed.length
          ? `${failed.length} of ${checks.length} upstreams are failing: ${failed.map((c) => c.name).join(", ")}`
          : "every upstream answered",
        region: process.env.VERCEL_REGION ?? "local",
        checkedAt: new Date().toISOString(),
        checks,
      },
      null,
      2,
    ),
    {
      // Never cached: the point of this route is to report the state right now.
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    },
  );
}
