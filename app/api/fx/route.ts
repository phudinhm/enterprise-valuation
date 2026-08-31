import { fetchFxRate } from "@/lib/data/yahoo";
import { json } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = (params.get("from") || "USD").slice(0, 6);
  const to = (params.get("to") || "USD").slice(0, 6);
  const rate = await fetchFxRate(from, to);
  // A null rate is a real answer: the caller falls back to the native currency
  // and says so, rather than silently applying a wrong 1:1 rate.
  return json({ from, to, rate }, 1800);
}
