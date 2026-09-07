import { type FC } from 'react';
import type { TokenInfo } from '../lib/api';
import { type TokenOverview } from '../lib/marketdata';

interface TokenMetricsProps {
  token: TokenInfo;
  overview?: TokenOverview | null;
}

function formatCompact(n: number, prefix = ''): string {
  if (n >= 1_000_000_000) return `${prefix}${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${prefix}${(n / 1_000).toFixed(1)}K`;
  return `${prefix}${n.toFixed(0)}`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

/**
 * Token metrics bar powered by GeckoTerminal data (via our API).
 * Shows MCAP, LIQ, VOL 24H, tier badge and 24h change. Holder and
 * trade-count stats will come from the aggregator when wired — dropped
 * rather than faked until then.
 */
export const TokenMetrics: FC<TokenMetricsProps> = ({ token, overview }) => {
  const tierConfig = {
    bonded: { label: 'BONDED', color: '#c8ff00', bg: 'rgba(200, 255, 0, 0.08)' },
    rising: { label: 'RISING', color: 'var(--primary-hover)', bg: 'rgba(251, 191, 36, 0.08)' },
    degen: { label: 'DEGEN', color: '#ff4d4d', bg: 'rgba(239, 68, 68, 0.08)' },
  }[token.tier] ?? { label: token.tier.toUpperCase(), color: '#a3ad8d', bg: 'rgba(128,128,128,0.08)' };

  // Use live market data if available, otherwise fallback to token data
  const mcap = overview?.marketCap ?? token.marketCapUsd ?? 0;
  const liq = overview?.liquidity ?? token.liquidityUsd ?? 0;
  const vol24h = overview?.volume24h ?? 0;
  const trade24h = overview?.trade24h ?? 0;
  const holders = overview?.holder ?? 0;
  const buy24h = overview?.buy24h ?? 0;
  const sell24h = overview?.sell24h ?? 0;
  const buyRatio = buy24h + sell24h > 0 ? (buy24h / (buy24h + sell24h)) * 100 : 50;
  const uniqueWallets = overview?.uniqueWallet24h ?? 0;
  const priceChange = overview?.priceChange24h ?? token.priceChange24hPct ?? 0;

  return (
    <div className="token-metrics">
      {/* MCAP */}
      <div className="token-metrics-item">
        <span className="token-metrics-label">MCAP</span>
        <span className="token-metrics-value">{formatCompact(mcap)}</span>
      </div>
      <div className="token-metrics-sep" />

      {/* LIQ */}
      <div className="token-metrics-item">
        <span className="token-metrics-label">LIQ</span>
        <span className="token-metrics-value">{formatCompact(liq, '$')}</span>
      </div>
      <div className="token-metrics-sep" />

      {/* VOL 24H */}
      {vol24h > 0 && (
        <>
          <div className="token-metrics-item">
            <span className="token-metrics-label">VOL 24H</span>
            <span className="token-metrics-value">{formatCompact(vol24h, '$')}</span>
          </div>
          <div className="token-metrics-sep" />
        </>
      )}

      {/* TRADES 24H */}
      {trade24h > 0 && (
        <>
          <div className="token-metrics-item">
            <span className="token-metrics-label">TXNS</span>
            <span className="token-metrics-value">{formatNum(trade24h)}</span>
          </div>
          <div className="token-metrics-sep" />
        </>
      )}

      {/* HOLDERS */}
      {holders > 0 && (
        <>
          <div className="token-metrics-item">
            <span className="token-metrics-label">HOLDERS</span>
            <span className="token-metrics-value">{formatNum(holders)}</span>
          </div>
          <div className="token-metrics-sep" />
        </>
      )}

      {/* BUY/SELL RATIO */}
      {(buy24h + sell24h) > 0 && (
        <>
          <div className="token-metrics-item">
            <span className="token-metrics-label">B/S</span>
            <span className="token-metrics-value">
              <span style={{ color: '#c8ff00' }}>{buyRatio.toFixed(0)}%</span>
              <span style={{ color: '#37421c', margin: '0 2px' }}>/</span>
              <span style={{ color: '#ff4d4d' }}>{(100 - buyRatio).toFixed(0)}%</span>
            </span>
          </div>
          <div className="token-metrics-sep" />
        </>
      )}

      {/* WALLETS */}
      {uniqueWallets > 0 && (
        <>
          <div className="token-metrics-item">
            <span className="token-metrics-label">WALLETS</span>
            <span className="token-metrics-value">{formatNum(uniqueWallets)}</span>
          </div>
          <div className="token-metrics-sep" />
        </>
      )}

      {/* TIER */}
      <div className="token-metrics-item">
        <span className="token-metrics-label">TIER</span>
        <span
          className="token-metrics-tier"
          style={{ color: tierConfig.color, background: tierConfig.bg }}
        >
          {tierConfig.label}
        </span>
      </div>
      <div className="token-metrics-sep" />

      {/* 24H CHANGE */}
      <div className="token-metrics-item">
        <span className="token-metrics-label">24H</span>
        <span
          className="token-metrics-value"
          style={{ color: priceChange >= 0 ? '#c8ff00' : '#ff4d4d' }}
        >
          {priceChange >= 0 ? '+' : ''}
          {priceChange.toFixed(2)}%
        </span>
      </div>
    </div>
  );
};
