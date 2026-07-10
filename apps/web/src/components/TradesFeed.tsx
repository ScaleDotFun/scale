import { type FC, useState, useEffect, useRef } from 'react';
import { fetchRecentTrades, type TradeItem } from '../lib/marketdata';

interface TradesFeedProps {
  tokenAddress?: string;
}

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncateWallet(w: string): string {
  if (!w || w.length < 8) return w;
  return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

/**
 * Trades feed for a token — real Uniswap V3 swaps from GeckoTerminal
 * via our API. Auto-refreshes every 6s (server-side 5s cache).
 */
export const TradesFeed: FC<TradesFeedProps> = ({ tokenAddress }) => {
  const [trades, setTrades] = useState<TradeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!tokenAddress) return;

    const load = async () => {
      setLoading(true);
      const data = await fetchRecentTrades(tokenAddress, 30);
      setTrades(data);
      setLoading(false);
    };

    load();

    // Auto-refresh every 6 seconds (server caches 5s; CoinGecko Pro has headroom)
    intervalRef.current = setInterval(load, 6000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tokenAddress]);

  if (!tokenAddress) {
    return <div className="bento-table-empty">Select a token to see trades</div>;
  }

  if (loading && trades.length === 0) {
    return <div className="bento-table-empty">Loading trades...</div>;
  }

  if (trades.length === 0) {
    return <div className="bento-table-empty">No recent trades</div>;
  }

  return (
    <table className="terminal-table trades-feed-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Side</th>
          <th>Price</th>
          <th>Amount</th>
          <th>Wallet</th>
          <th>Tx</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((trade, i) => (
          <tr key={`${trade.txHash}-${i}`} className={trade.side === 'buy' ? 'trade-row-buy' : 'trade-row-sell'}>
            <td className="mono text-dim">{formatTime(trade.blockUnixTime)}</td>
            <td>
              <span className={`trade-side-badge ${trade.side === 'buy' ? 'trade-side-buy' : 'trade-side-sell'}`}>
                {trade.side.toUpperCase()}
              </span>
            </td>
            <td className="mono">${trade.priceUsd > 0.01 ? trade.priceUsd.toFixed(4) : trade.priceUsd.toPrecision(4)}</td>
            <td className="mono">${trade.volumeUsd > 1000 ? `${(trade.volumeUsd / 1000).toFixed(1)}K` : trade.volumeUsd.toFixed(2)}</td>
            <td className="mono text-dim">{truncateWallet(trade.owner)}</td>
            <td>
              {trade.txHash && (
                <a
                  href={`https://robinhoodchain.blockscout.com/tx/${trade.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link-dim"
                >
                  ↗
                </a>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
