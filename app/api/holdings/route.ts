import { fetchTopHoldings } from "@/lib/data/yahoo";
import { json, fail, cleanSymbol } from "@/lib/api";

export const runtime = "nodejs";

/** Live top holdings of a sector ETF — the sector's current leaders, which
 *  rotate on their own as the market does. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const etf = cleanSymbol(params.get("etf"));
  if (!etf) return fail("An ETF symbol is required.");
  const maxN = Math.min(Number(params.get("max") || 15) || 15, 40);
  return json({ holdings: await fetchTopHoldings(etf, maxN) }, 3600);
}
