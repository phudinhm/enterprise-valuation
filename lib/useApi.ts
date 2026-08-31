"use client";

// One data-fetching hook for the whole client. Requests are keyed on the URL,
// in-flight duplicates are shared, and results are held in a session-scoped
// cache — so moving a slider or switching tabs never refetches a statement,
// which is the same guarantee the Streamlit original made with its cache
// decorators.

import { useCallback, useEffect, useRef, useState } from "react";

const cache = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();

export function clearApiCache() {
  cache.clear();
  inFlight.clear();
}

export async function apiGet<T>(url: string | null): Promise<T | null> {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url) as T;
  const existing = inFlight.get(url);
  if (existing) return (await existing) as T;

  const promise = (async () => {
    const res = await fetch(url);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (body && typeof body === "object" && "error" in body)
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
      throw new Error(message);
    }
    cache.set(url, body);
    return body;
  })().finally(() => inFlight.delete(url));

  inFlight.set(url, promise);
  return (await promise) as T;
}

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useApi<T>(url: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(() => (url && cache.has(url) ? (cache.get(url) as T) : null));
  const [loading, setLoading] = useState(Boolean(url) && !(url && cache.has(url)));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const token = ++latest.current;
    if (cache.has(url)) {
      setData(cache.get(url) as T);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    apiGet<T>(url)
      .then((result) => {
        if (token !== latest.current) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (token !== latest.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setData(null);
        setLoading(false);
      });
  }, [url, nonce]);

  const reload = useCallback(() => {
    if (url) cache.delete(url);
    setNonce((n) => n + 1);
  }, [url]);

  return { data, loading, error, reload };
}
