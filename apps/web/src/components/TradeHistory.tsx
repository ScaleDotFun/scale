import { type FC } from 'react';
import type { PositionInfo } from '../lib/api';
import { formatSol, formatTimeAgo } from '../lib/format';
import { PnlCardGen } from './PnlCardGen';

interface TradeHistoryProps {
  trades: PositionInfo[];
  loading: boolean;
}

function statusLabel(status: string): { text: string; color: string } {
  switch (status) {
    case 'closed_profit':
      return { text: 'Won', color: 'text-green' };
    case 'closed_loss':
      return { text: 'Lost', color: 'text-red' };
    case 'liquidated':
      return { text: 'Liquidated', color: 'text-red' };
    case 'expired':
      return { text: 'Expired', color: 'text-yellow' };
    default:
      return { text: status, color: 'text-secondary' };
  }
}

export const TradeHistory: FC<TradeHistoryProps> = ({ trades, loading }) => {
  if (loading) {
    return (
      <div className="empty-state">
        <span className="spinner" />
      </div>
    );
  }

  if (trades.length === 0) {
    return <div className="empty-state">No trade history</div>;
  }

  return (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Lev</th>
            <th>Size</th>
            <th>P&L</th>
            <th>Status</th>
            <th>Date</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => {
            const st = statusLabel(trade.status);
            const pnlSol = trade.pnlSol ? Number(trade.pnlSol) / 1e9 : null;
            const pnlColor = pnlSol != null && pnlSol > 0 ? 'text-green' : pnlSol != null && pnlSol < 0 ? 'text-red' : 'text-secondary';
            return (
              <tr key={trade.id}>
                <td className="cell-name">{trade.token?.symbol ?? '???'}</td>
                <td className="mono">{trade.leverage}x</td>
                <td className="mono">{formatSol(trade.userCapital, 2)}</td>
                <td className={pnlColor} style={{ fontWeight: 600 }}>
                  {pnlSol != null ? `${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL` : '—'}
                </td>
                <td>
                  <span className={st.color} style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                    {st.text}
                  </span>
                </td>
                <td>{trade.closedAt ? formatTimeAgo(trade.closedAt) : formatTimeAgo(trade.openedAt)}</td>
                <td>
                  <PnlCardGen trade={trade} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
