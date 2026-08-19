import { useState, useEffect, useCallback, useRef } from 'react';

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

interface UseApiReturn<T> extends UseApiState<T> {
  refetch: () => void;
}

// ── Simple in-memory cache ────────────────────────────────────────
// Keyed by a stable string derived from the fetcher + deps.
// Entries expire after `ttlMs` (default 30s) but are returned stale
// while a fresh fetch happens in the background (stale-while-revalidate).

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 30_000; // 30 seconds

/** Clear cache entries matching a prefix (e.g. "positions", "locks"). */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Generic data-fetching hook with loading, error, refetch, and caching.
 *
 * @param fetcher - Async function that returns data
 * @param deps - Dependency array (re-fetches when changed)
 * @param options.cacheKey - Stable string key for caching. If omitted, no caching.
 * @param options.ttlMs - Cache TTL in ms (default 30s). Stale data is shown immediately
 *                        while fresh data loads in the background.
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  options?: { cacheKey?: string; ttlMs?: number },
): UseApiReturn<T> {
  const cacheKey = options?.cacheKey;
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;

  // Initialize with cached data if available
  const cached = cacheKey ? cache.get(cacheKey) : undefined;
  const [state, setState] = useState<UseApiState<T>>({
    data: (cached?.data as T) ?? null,
    loading: !cached,
    error: null,
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    // If we have fresh cached data, skip fetch
    if (cacheKey) {
      const entry = cache.get(cacheKey);
      if (entry && Date.now() - entry.timestamp < ttlMs) {
        if (mountedRef.current) {
          setState({ data: entry.data as T, loading: false, error: null });
        }
        return;
      }
      // If stale cached data exists, show it while fetching
      if (entry) {
        setState((prev) => ({ ...prev, loading: true }));
      } else {
        setState((prev) => ({ ...prev, loading: true, error: null }));
      }
    } else {
      setState((prev) => ({ ...prev, loading: true, error: null }));
    }

    try {
      const data = await fetcherRef.current();
      if (mountedRef.current) {
        setState({ data, loading: false, error: null });
      }
      // Update cache
      if (cacheKey) {
        cache.set(cacheKey, { data, timestamp: Date.now() });
      }
    } catch (err) {
      if (mountedRef.current) {
        setState((prev) => ({
          data: prev.data, // Keep stale data on error
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return {
    ...state,
    refetch: load,
  };
}

/**
 * Hook for polling data at a regular interval.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
  options?: { cacheKey?: string; ttlMs?: number },
): UseApiReturn<T> {
  const result = useApi(fetcher, deps, options);

  useEffect(() => {
    const timer = setInterval(() => {
      result.refetch();
    }, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  return result;
}

