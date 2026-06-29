import { type FC } from 'react';
import type { BurnEntry } from '../lib/api';
import { formatSol, formatAddress, formatTimeAgo, solscanTxUrl } from '../lib/format';

interface BurnFeedProps {
  burns: BurnEntry[];
  loading: boolean;
}

export const BurnFeed: FC<BurnFeedProps> = ({ burns, loading }) => {
  if (loading) {
    return (
      <div className="empty-state">
        <span className="spinner" />
      </div>
    );
  }

  if (burns.length === 0) {
    return <div className="empty-state">No burns recorded</div>;
  }

  return (
    <div>
      {burns.map((burn) => (
        <div key={burn.id} className="feed-item">
          <span className="feed-amount">{formatSol(burn.solAmount || '0', 4)}</span>
          <a
            href={solscanTxUrl(burn.txSignature)}
            target="_blank"
            rel="noreferrer"
            className="feed-tx"
          >
            {formatAddress(burn.txSignature, 6)}
          </a>
          <span className="feed-time">{formatTimeAgo(burn.burnedAt)}</span>
        </div>
      ))}
    </div>
  );
};
