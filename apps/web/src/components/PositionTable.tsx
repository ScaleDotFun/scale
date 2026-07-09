import { type FC } from 'react';
import type { PositionInfo } from '../lib/api';
import { formatSol, formatSolPrice, formatCountdown } from '../lib/format';
import { TierBadge } from './TierBadge';
import { LiquidationBar } from './LiquidationBar';

interface PositionTableProps {
  positions: PositionInfo[];
  loading: boolean;
  isClosing: string | null;
  onClose: (positionId: string) => void;
}

export const PositionTable: FC<PositionTableProps> = ({
  positions,
  loading,
  isClosing,
  onClose,
}) => {
  if (loading) {
    return (
      <div className="empty-state">
        <span className="spinner" />
      </div>
    );
  }

  if (positions.length === 0) {
    return <div className="empty-state">No open positions</div>;
  }

  return (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Tier</th>
            <th>Lev</th>
            <th>Capital</th>
            <th>Entry</th>
            <th style={{ minWidth: 150 }}>Liq. Proximity</th>
            <th>Time Left</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => {
            const thresholdPct = Number(pos.exitThreshold || -15);
            return (
              <tr key={pos.id}>
                <td className="cell-name">{pos.token?.symbol ?? '???'}</td>
                <td><TierBadge tier={pos.tier} /></td>
                <td className="mono">{pos.leverage}x</td>
                <td className="mono">{formatSol(pos.userCapital, 2)}</td>
                <td className="mono">{pos.entryPriceUsd ? `$${formatSolPrice(pos.entryPriceUsd)}` : '—'}</td>
                <td>
                  <LiquidationBar
                    livePnlPercent={pos.livePnLPercent ?? null}
                    exitThresholdPct={thresholdPct}
                    status={pos.status}
                  />
                </td>
                <td>{pos.timeRemainingMs != null ? formatCountdown(pos.timeRemainingMs) : '—'}</td>
                <td>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => onClose(String(pos.id))}
                    disabled={isClosing === String(pos.id)}
                    type="button"
                  >
                    {isClosing === String(pos.id) ? '...' : 'Close'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
