import { type FC, useEffect, useState, useRef } from 'react';
import type { TokenInfo } from '../lib/api';

interface PulseFeedProps {
  tokens: TokenInfo[];
  onSelect: (token: TokenInfo) => void;
  selectedAddress?: string;
}

interface PulseItem extends TokenInfo {
  _pulseKey: string;
  _isNew: boolean;
}

// Build WebSocket URL: use VITE_WS_URL if set, otherwise derive from API URL
const WS_BASE = import.meta.env.VITE_WS_URL
  ?? (import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/\/+$/, '').replace(/\/api$/, '').replace(/^http/, 'ws')
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`);

/**
 * Real-time "Pulse" feed sidebar showing streaming trending token updates.
 * Uses WebSocket with SSE fallback for real-time data.
 */
export const PulseFeed: FC<PulseFeedProps> = ({ tokens: initialTokens, onSelect, selectedAddress }) => {
  const [items, setItems] = useState<PulseItem[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  // Initialize with existing trending tokens
  useEffect(() => {
    setItems(
      initialTokens.map((t) => ({
        ...t,
        _pulseKey: t.address,
        _isNew: false,
      })),
    );
  }, [initialTokens]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    const wsUrl = WS_BASE + '/ws/pulse';

    function connect() {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          console.log('[pulse] WebSocket connected');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as TokenInfo;
            setItems((prev) => {
              const existing = prev.findIndex((t) => t.address === data.address);
              const newItem: PulseItem = {
                ...data,
                _pulseKey: `${data.address}-${Date.now()}`,
                _isNew: true,
              };

              if (existing >= 0) {
                // Update existing — move to top
                const updated = [...prev];
                updated.splice(existing, 1);
                return [newItem, ...updated].slice(0, 50);
              }
              return [newItem, ...prev].slice(0, 50);
            });

            // Clear "new" animation after 2s
            setTimeout(() => {
              setItems((prev) =>
                prev.map((t) =>
                  t.address === data.address ? { ...t, _isNew: false } : t,
                ),
              );
            }, 2000);
          } catch {
            // Invalid message
          }
        };

        ws.onclose = () => {
          setConnected(false);
          // Reconnect after 5s
          reconnectTimer.current = setTimeout(connect, 5000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        // WebSocket not available — use polling fallback
        setConnected(false);
      }
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  const formatCompact = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  };

  return (
    <div className="pulse-feed">
      <div className="pulse-feed-header">
        <div className="pulse-feed-title">
          <span className={`pulse-dot ${connected ? 'pulse-dot-live' : ''}`} />
          Pulse
        </div>
        <span className="pulse-feed-count">{items.length} tokens</span>
      </div>

      <div className="pulse-feed-list">
        {items.length === 0 ? (
          <div className="pulse-feed-empty">Waiting for tokens...</div>
        ) : (
          items.map((token) => (
            <button
              key={token._pulseKey}
              className={`pulse-item ${token._isNew ? 'pulse-item-new' : ''} ${
                selectedAddress === token.address ? 'pulse-item-selected' : ''
              }`}
              onClick={() => onSelect(token)}
              type="button"
            >
              <div className="pulse-item-left">
                <span className="pulse-item-symbol">{token.symbol}</span>
                <span className={`pulse-item-tier pulse-tier-${token.tier}`}>
                  {token.tier === 'bonded' ? '◆' : token.tier === 'rising' ? '▲' : '●'}
                </span>
              </div>
              <div className="pulse-item-right">
                <span className="pulse-item-mcap">
                  {formatCompact(token.marketCapUsd ?? 0)}
                </span>
                <span
                  className="pulse-item-change"
                  style={{ color: (token.priceChange24hPct ?? 0) >= 0 ? '#8fd0ff' : '#4a6f99' }}
                >
                  {(token.priceChange24hPct ?? 0) >= 0 ? '+' : ''}
                  {(token.priceChange24hPct ?? 0).toFixed(1)}%
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
