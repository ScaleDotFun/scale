import { useState, useCallback, useMemo } from 'react';
import { useApi } from './useApi';
import * as api from '../lib/api';

/** Hook for managing positions: active positions, trade history, open/close. */
export function usePositions() {
  const [isOpening, setIsOpening] = useState(false);
  const [isClosing, setIsClosing] = useState<string | null>(null);

  const activeResult = useApi<api.PositionInfo[]>(
    () => api.getActivePositions(),
    [],
  );

  const historyResult = useApi<api.PositionInfo[]>(
    () => api.getTradeHistory(),
    [],
  );

  const activePositions = activeResult.data ?? [];
  const tradeHistory = historyResult.data ?? [];

  const openPosition = useCallback(
    async (tokenAddress: string, capitalLamports: string, leverage: number) => {
      setIsOpening(true);
      try {
        const position = await api.openPosition(tokenAddress, capitalLamports, leverage);
        activeResult.refetch();
        return position;
      } finally {
        setIsOpening(false);
      }
    },
    [activeResult],
  );

  const closePosition = useCallback(
    async (positionId: string) => {
      setIsClosing(positionId);
      try {
        const position = await api.closePosition(positionId);
        activeResult.refetch();
        historyResult.refetch();
        return position;
      } finally {
        setIsClosing(null);
      }
    },
    [activeResult, historyResult],
  );

  const stats = useMemo(() => {
    const all = tradeHistory;
    const wins = all.filter((p) => p.status === 'closed_profit').length;
    const total = all.length;
    const totalPnl = all.reduce((sum, p) => sum + Number(p.pnlSol || 0), 0);
    const totalProfit = all
      .filter((p) => Number(p.pnlSol || 0) > 0)
      .reduce((sum, p) => sum + Number(p.pnlSol || 0), 0);
    const totalLoss = all
      .filter((p) => Number(p.pnlSol || 0) < 0)
      .reduce((sum, p) => sum + Number(p.pnlSol || 0), 0);
    return {
      totalTrades: total,
      wins,
      losses: total - wins,
      winRate: total > 0 ? (wins / total) * 100 : 0,
      totalPnl,
      totalProfit,
      totalLoss,
    };
  }, [tradeHistory]);

  return {
    activePositions,
    tradeHistory,
    stats,
    loading: activeResult.loading || historyResult.loading,
    error: activeResult.error || historyResult.error,
    isOpening,
    isClosing,
    openPosition,
    closePosition,
    refetch: () => {
      activeResult.refetch();
      historyResult.refetch();
    },
  };
}
