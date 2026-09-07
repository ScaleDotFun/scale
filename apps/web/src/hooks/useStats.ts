import { useApi } from './useApi';
import * as api from '../lib/api';
import { weiToEth } from '../lib/format';

/** Hook for protocol-wide stats: pool size, total burned, etc. */
export function useStats() {
  const result = useApi<api.ProtocolStatsResponse>(
    () => api.getProtocolStats(),
    [],
  );

  const stats = result.data;

  const poolSizeEth = weiToEth(stats?.poolSizeWei);
  const totalBurnedEth = weiToEth(stats?.totalBurnedWei);
  const totalLockedEth = weiToEth(stats?.totalLockedWei);
  const totalCreatorPayoutsEth = weiToEth(stats?.totalCreatorPayoutsWei);

  return {
    stats,
    poolSizeEth,
    totalBurnedEth,
    totalLockedEth,
    totalCreatorPayoutsEth,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
  };
}
