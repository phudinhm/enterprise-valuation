import { searchYahoo, probeAsSymbol } from "@/lib/data/yahoo";
import { MARKET_SUFFIXES } from "@/lib/constants";
import { json } from "@/lib/api";

export const runtime = "nodejs";

/** Resolves a company name, or a partial symbol, to tradable symbols.
 *
 *  Always live: nothing about the company universe is bundled with this app,
 *  because listings, renames and delistings change constantly. When the search
 *  route comes back empty — routine when it is rate-limited — the query is
 *  probed as a symbol across every market suffix in parallel, so one throttled
 *  endpoint cannot make a real company look nonexistent. */
export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 64);
  if (query.length < 2) return json({ results: [] }, 60);

  const hits = await searchYahoo(query, 12);
  if (hits.length) return json({ results: hits, route: "search" }, 900);

  const probed = await probeAsSymbol(query, MARKET_SUFFIXES);
  return json({ results: probed, route: probed.length ? "symbol probe" : "none" }, 900);
}
