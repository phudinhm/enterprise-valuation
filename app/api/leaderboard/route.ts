import { loadLeaderboard } from "@/lib/data/peers";
import { json, fail, cleanSymbolList } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tickers = cleanSymbolList(params.get("tickers"), 60);
  if (!tickers.length) return fail("At least one ticker is required.");
  const currency = (params.get("currency") || "USD").slice(0, 6);
  const asOf = (params.get("asOf") || new Date().toISOString()).slice(0, 10);
  const rows = await loadLeaderboard(tickers, currency, asOf);
  return json({ rows }, 300);
}
