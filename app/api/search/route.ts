import { searchYahoo, probeAsSymbol } from "@/lib/data/yahoo";
import { MARKET_SUFFIXES } from "@/lib/constants";
import { json } from "@/lib/api";

export const runtime = "nodejs";

/** Resolves a company name, or a partial symbol, to tradable symbols.
 *
 *  Always live: nothing about the company universe is bundled with this app,
 *  because listings, renames and delistings change constantly. Every route is
 *  tried before the query is declared unresolvable, and what each one did comes
 *  back with the answer — so an empty result can say why rather than leaving
 *  the reader to conclude the company does not exist. */
export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 64);
  if (query.length < 2) return json({ results: [], route: "none", attempts: [] }, 60);

  const outcome = await searchYahoo(query, 12);
  if (outcome.hits.length) {
    return json({ results: outcome.hits, route: outcome.route, attempts: outcome.attempts }, 900);
  }

  const probed = await probeAsSymbol(query, MARKET_SUFFIXES);
  return json(
    {
      results: probed,
      route: probed.length ? "symbol probe" : "none",
      attempts: [
        ...outcome.attempts,
        { route: "symbol probe", ok: probed.length > 0, detail: `${probed.length} hits` },
      ],
    },
    900,
  );
}
