import { Notes } from "@/lib/data/http";
import { loadHistory } from "@/lib/data/company";
import { json, fail, cleanSymbol } from "@/lib/api";
import { INTERVALS } from "@/lib/constants";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ticker = cleanSymbol(params.get("ticker"));
  if (!ticker) return fail("A ticker symbol is required.");
  const period = params.get("period") || "1y";
  const interval = params.get("interval") || INTERVALS[period] || "1d";
  const notes = new Notes();
  const { bars, source } = await loadHistory(ticker, period, interval, notes);
  return json({ bars, source, errors: notes.list() }, 300);
}
