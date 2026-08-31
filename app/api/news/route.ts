import { fetchNews } from "@/lib/data/yahoo";
import { SECTOR_ETF_MAP } from "@/lib/constants";
import { json, fail, cleanSymbol } from "@/lib/api";

export const runtime = "nodejs";

/** Company headlines plus headlines for a representative sector ETF, fetched
 *  in parallel. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ticker = cleanSymbol(params.get("ticker"));
  if (!ticker) return fail("A ticker symbol is required.");
  const sector = params.get("sector") || "";
  const etf = SECTOR_ETF_MAP[sector];

  const [company, sectorNews] = await Promise.all([
    fetchNews(ticker, 6),
    etf ? fetchNews(etf, 6) : Promise.resolve([]),
  ]);
  return json({ company, sector: sectorNews, etf: etf ?? null }, 600);
}
