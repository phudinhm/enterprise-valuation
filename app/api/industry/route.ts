import { loadIndustryCommonSize } from "@/lib/data/peers";
import { json, cleanSymbolList } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const tickers = cleanSymbolList(new URL(request.url).searchParams.get("tickers"), 10);
  if (!tickers.length) return json({ income: {}, balance: {}, n: 0, peers: [] }, 1800);
  const benchmark = await loadIndustryCommonSize(tickers);
  return json(benchmark, 1800);
}
