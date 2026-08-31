// All network access is funnelled through here so caching, timeouts and
// failure notes behave identically wherever a fetch happens.

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface FetchNote {
  scope: string;
  message: string;
}

/** Collects data-loading problems so the provenance panel can name them,
 *  rather than the bare `except: pass` the original grew out of. */
export class Notes {
  errors: FetchNote[] = [];
  sources: Record<string, string> = {};

  error(scope: string, err: unknown) {
    const message = `${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`.slice(0, 220);
    if (!this.errors.some((e) => e.scope === scope && e.message === message)) {
      this.errors.push({ scope, message });
    }
  }

  /** Records which provider actually served a piece of data. */
  source(what: string, provider: string) {
    this.sources[what] = provider;
  }

  list(): string[] {
    return this.errors.map((e) => `${e.scope}: ${e.message}`);
  }
}

export interface GetOptions {
  headers?: Record<string, string>;
  /** Seconds the Next.js data cache should hold this response. */
  revalidate?: number;
  timeoutMs?: number;
}

async function request(url: string, opts: GetOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12000);
  try {
    return await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*", ...opts.headers },
      signal: controller.signal,
      // Vercel's data cache keyed on the URL: a slider move never refetches a
      // financial statement, and concurrent renders share one upstream call.
      next: opts.revalidate === undefined ? undefined : { revalidate: opts.revalidate },
      cache: opts.revalidate === undefined ? "no-store" : undefined,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson<T = unknown>(url: string, opts: GetOptions = {}): Promise<T> {
  const res = await request(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
  return (await res.json()) as T;
}

export async function getText(url: string, opts: GetOptions = {}): Promise<string> {
  const res = await request(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
  return await res.text();
}

/** Retry a transient failure once. Anything that fails twice is reported. */
export async function retry<T>(fn: () => Promise<T>, attempts = 2, pauseMs = 400): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i + 1 < attempts) await new Promise((r) => setTimeout(r, pauseMs * (i + 1)));
    }
  }
  throw lastError;
}

/** Bounded-concurrency fan-out. Peer tables and leaderboards would otherwise be
 *  N sequential round trips; this makes them roughly N / limit. */
export async function parallelMap<T, R>(
  items: T[], fn: (item: T, index: number) => Promise<R>, limit = 8,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Never let one failed leg of a fan-out take the whole page down. */
export async function settle<T>(promise: Promise<T>, fallback: T, notes?: Notes, scope?: string): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (notes && scope) notes.error(scope, err);
    return fallback;
  }
}
