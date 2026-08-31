// Shared route-handler conventions: JSON in, JSON out, with the browser told to
// keep a short copy so flipping between modules is instant.


export function json(data: unknown, seconds = 300): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}`,
    },
  });
}

export function fail(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Symbols arrive from the URL, so they are normalised and length-capped before
 *  they are ever interpolated into an upstream request. */
export function cleanSymbol(raw: string | null): string {
  return (raw || "").toUpperCase().trim().replace(/[^A-Z0-9.\-^=]/g, "").slice(0, 20);
}

export function cleanSymbolList(raw: string | null, max = 25): string[] {
  return [
    ...new Set(
      (raw || "")
        .split(",")
        .map((s) => cleanSymbol(s))
        .filter(Boolean),
    ),
  ].slice(0, max);
}
