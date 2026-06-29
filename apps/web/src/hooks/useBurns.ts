import { useApi } from './useApi';
import * as api from '../lib/api';

/** Hook for burn data, including recent burns, locks, and computed stats. */
export function useBurns() {
  const burnsResult = useApi<api.BurnEntry[]>(
    () => api.getRecentBurns(50),
    [],
  );

  const locksResult = useApi<api.LocksResponse>(
    () => api.getRecentLocks(50),
    [],
  );

  const burns = burnsResult.data ?? [];
  const locks = locksResult.data?.locks ?? [];

  const totalBurned = burns.reduce(
    (sum, b) => sum + Number(b.solAmount || 0),
    0,
  );

  const totalLocked = locks.reduce(
    (sum, l) => sum + Number(l.solAmount || 0),
    0,
  );

  return {
    burns,
    locks,
    totalBurned,
    totalLocked,
    loading: burnsResult.loading || locksResult.loading,
    error: burnsResult.error || locksResult.error,
    refetch: () => {
      burnsResult.refetch();
      locksResult.refetch();
    },
  };
}
