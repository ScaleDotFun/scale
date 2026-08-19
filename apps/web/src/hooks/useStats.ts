import { useApi } from './useApi';
import * as api from '../lib/api';

/** Hook for protocol-wide stats: pool size, total burned, etc. */
export function useStats() {
  const result = useApi<api.ProtocolStatsResponse>(
    () => api.getProtocolStats(),
    [],
  );

  const stats = result.data;

  const poolSizeSol = stats ? Number(stats.poolSizeLamports) / 1e9 : 0;
  const totalBurnedSol = stats ? Number(stats.totalBurnedLamports) / 1e9 : 0;
  const totalLockedSol = stats ? Number(stats.totalLockedLamports) / 1e9 : 0;
  const totalCreatorPayoutsSol = stats
    ? Number(stats.totalCreatorPayoutsLamports) / 1e9
    : 0;

  return {
    stats,
    poolSizeSol,
    totalBurnedSol,
    totalLockedSol,
    totalCreatorPayoutsSol,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
  };
}
