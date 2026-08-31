import { loadBatchCloses } from "@/lib/data/peers";
import { json, fail, cleanSymbolList } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tickers = cleanSymbolList(params.get("tickers"), 40);
  if (!tickers.length) return fail("At least one ticker is required.");
  const range = params.get("range") || "1y";
  const interval = params.get("interval") || "1d";
  const data = await loadBatchCloses(tickers, range, interval);
  return json(data, 900);
}
