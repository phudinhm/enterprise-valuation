import { suggestPeers, tickerNames } from "@/lib/data/peers";
import { json, fail, cleanSymbol } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ticker = cleanSymbol(params.get("ticker"));
  if (!ticker) return fail("A ticker symbol is required.");
  const sector = params.get("sector");
  const industry = params.get("industry");
  const maxN = Math.min(Number(params.get("max") || 8) || 8, 12);

  const peers = await suggestPeers(ticker, sector, industry, maxN);
  const names = await tickerNames([...peers, "SPY", "QQQ"]);
  return json({ peers, names }, 1800);
}
