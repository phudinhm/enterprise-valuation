import { loadComparables } from "@/lib/data/peers";
import { json, fail, cleanSymbolList } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tickers = cleanSymbolList(params.get("tickers"), 15);
  if (!tickers.length) return fail("At least one ticker is required.");
  const currency = (params.get("currency") || "USD").slice(0, 6);
  const rows = await loadComparables(tickers, currency);
  return json({ rows }, 300);
}
