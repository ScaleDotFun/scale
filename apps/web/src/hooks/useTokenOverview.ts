import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchTokenOverview, type TokenOverview } from '../lib/marketdata';

/**
 * Shared hook for token overview data (GeckoTerminal via our API).
 * Prevents duplicate API calls when multiple components need the same token data.
 * Polls every 15 seconds for fresh price data.
 */
export function useTokenOverview(tokenAddress: string | undefined) {
  const [overview, setOverview] = useState<TokenOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const lastAddr = useRef('');
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async (addr: string) => {
    if (!addr) return;
    try {
      const data = await fetchTokenOverview(addr);
      // Keep the last good overview on transient failures — a null
      // here would blank the metrics bar and zero out PnL fallbacks
      if (data) setOverview(data);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (!tokenAddress) {
      setOverview(null);
      return;
    }

    if (tokenAddress !== lastAddr.current) {
      lastAddr.current = tokenAddress;
      setLoading(true);
      load(tokenAddress).finally(() => setLoading(false));
    }

    // Poll every 15s for fresh data
    intervalRef.current = setInterval(() => load(tokenAddress), 15000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tokenAddress, load]);

  return { overview, loading };
}
