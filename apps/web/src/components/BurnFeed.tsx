import { type FC } from 'react';
import type { BurnEntry } from '../lib/api';
import { formatEth, formatAddress, formatTimeAgo, explorerTxUrl } from '../lib/format';

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
          <span className="feed-amount">{formatEth(burn.ethAmount || '0', 4)}</span>
          <a
            href={explorerTxUrl(burn.txHash)}
            target="_blank"
            rel="noreferrer"
            className="feed-tx"
          >
            {formatAddress(burn.txHash, 6)}
          </a>
          <span className="feed-time">{formatTimeAgo(burn.burnedAt)}</span>
        </div>
      ))}
    </div>
  );
};
