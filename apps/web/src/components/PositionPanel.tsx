import { type FC, useState } from 'react';
import { useAuth } from '../providers/AuthProvider';
import type { TokenInfo } from '../lib/api';
import { formatSolPrice, formatPercentText, formatNumber } from '../lib/format';

interface PositionPanelProps {
  token: TokenInfo | null;
  onOpen: (tokenAddress: string, capitalLamports: string, leverage: number) => Promise<unknown>;
  isOpening: boolean;
}

const LEVERAGE_OPTIONS = [3, 5, 7];

export const PositionPanel: FC<PositionPanelProps> = ({ token, onOpen, isOpening }) => {
  const { isAuthenticated } = useAuth();
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(5);

  if (!isAuthenticated) {
    return (
      <div className="position-panel">
        <div className="position-panel-title">Open Position</div>
        <div className="position-panel-empty">Sign in to trade</div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="position-panel">
        <div className="position-panel-title">Open Position</div>
        <div className="position-panel-empty">Select a token to trade</div>
      </div>
    );
  }

  const amountNum = parseFloat(amount) || 0;
  const positionSize = amountNum * leverage;
  const fee = positionSize * 0.01;
  const pctChange = formatPercentText(token.priceChange24hPct ?? 0);

  const handleSubmit = async () => {
    if (amountNum <= 0) return;
    const lamports = Math.floor(amountNum * 1e9).toString();
    await onOpen(token.address, lamports, leverage);
    setAmount('');
  };

  return (
    <div className="position-panel">
      {/* Token info */}
      <div>
        <div className="position-panel-title">{token.symbol}</div>
        <div className="flex items-center gap-sm" style={{ marginTop: 4 }}>
          <span className="font-mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
            {formatSolPrice(token.priceSol)}
          </span>
          <span className={`font-mono ${pctChange.className}`} style={{ fontSize: '0.82rem' }}>
            {pctChange.text}
          </span>
        </div>
      </div>

      {/* Amount input */}
      <div className="position-panel-field">
        <span className="position-panel-label">Amount</span>
        <div className="position-panel-input-wrap">
          <input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="0.01"
          />
          <button
            className="position-panel-input-max"
            type="button"
            onClick={() => setAmount('1')}
          >
            Max
          </button>
          <span className="position-panel-input-suffix">SOL</span>
        </div>
      </div>

      {/* Leverage selector */}
      <div className="position-panel-field">
        <span className="position-panel-label">Leverage</span>
        <div className="leverage-buttons">
          {LEVERAGE_OPTIONS.map((lev) => (
            <button
              key={lev}
              className={`leverage-btn ${leverage === lev ? 'active' : ''}`}
              onClick={() => setLeverage(lev)}
              type="button"
            >
              {lev}x
            </button>
          ))}
        </div>
      </div>

      {/* Position preview */}
      {amountNum > 0 && (
        <div className="position-preview">
          <div className="position-preview-row">
            <span className="position-preview-row-label">Position Size</span>
            <span className="position-preview-row-value">{positionSize.toFixed(3)} SOL</span>
          </div>
          <div className="position-preview-row">
            <span className="position-preview-row-label">Fee (1%)</span>
            <span className="position-preview-row-value">{fee.toFixed(4)} SOL</span>
          </div>
          <div className="position-preview-row">
            <span className="position-preview-row-label">Exit Threshold</span>
            <span className="position-preview-row-value">-{((1 / leverage) * 100).toFixed(0)}%</span>
          </div>
          <div className="position-preview-row">
            <span className="position-preview-row-label">Max Duration</span>
            <span className="position-preview-row-value">24h</span>
          </div>
        </div>
      )}

      {/* Submit button */}
      <button
        className="btn btn-primary btn-block"
        disabled={amountNum <= 0 || isOpening}
        onClick={handleSubmit}
        type="button"
      >
        {isOpening ? 'Opening...' : 'Open Position'}
      </button>
    </div>
  );
};
