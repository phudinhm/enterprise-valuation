import { loadCompany } from "@/lib/data/company";
import { json, fail, cleanSymbol } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const ticker = cleanSymbol(new URL(request.url).searchParams.get("ticker"));
  if (!ticker) return fail("A ticker symbol is required.");
  const { company, reason } = await loadCompany(ticker);
  if (!company) return fail(reason ?? "No usable data for that symbol.", 404);
  return json(company, 300);
}
