import { useApi } from './useApi';
import * as api from '../lib/api';

/** Hook for burn data, including recent burns, global lock stats, and computed stats. */
export function useBurns() {
  const burnsResult = useApi<api.BurnEntry[]>(
    () => api.getRecentBurns(50),
    [],
  );

  // Use public global lock stats instead of auth-only user locks
  const lockStatsResult = useApi<api.GlobalLockStats>(
    () => api.getGlobalLockStats(),
    [],
  );

  const burns = burnsResult.data ?? [];
  const lockStats = lockStatsResult.data;

  const totalBurned = burns.reduce(
    (sum, b) => sum + Number(b.solAmount || 0),
    0,
  );

  const totalLocked = Number(lockStats?.totalLocked?.solAmount || 0);

  return {
    burns,
    lockStats,
    totalBurned,
    totalLocked,
    loading: burnsResult.loading || lockStatsResult.loading,
    error: burnsResult.error || lockStatsResult.error,
    refetch: () => {
      burnsResult.refetch();
      lockStatsResult.refetch();
    },
  };
}
