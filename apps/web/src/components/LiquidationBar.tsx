import { type FC, useMemo } from 'react';

interface LiquidationBarProps {
  /** Current live PnL percentage (leveraged). Negative = losing. */
  livePnlPercent: number | null | undefined;
  /** The exit threshold percentage (e.g., -15 for bonded tier). */
  exitThresholdPct: number;
  /** Position status */
  status: string;
}

/**
 * Liquidation proximity progress bar.
 * Dynamically fills red as the price drops toward the exitThreshold.
 * Shows green when profitable.
 */
export const LiquidationBar: FC<LiquidationBarProps> = ({
  livePnlPercent,
  exitThresholdPct,
  status,
}) => {
  const { fillPercent, color, label, isProfit } = useMemo(() => {
    if (status !== 'open' || livePnlPercent == null) {
      return { fillPercent: 0, color: '#37421c', label: '--', isProfit: false };
    }

    const threshold = Math.abs(exitThresholdPct); // e.g., 15

    if (livePnlPercent >= 0) {
      // Profitable — show green bar
      const capped = Math.min(livePnlPercent, threshold * 2); // cap at 2x threshold for bar
      const pct = (capped / (threshold * 2)) * 100;
      return {
        fillPercent: pct,
        color: '#c8ff00',
        label: `+${livePnlPercent.toFixed(1)}%`,
        isProfit: true,
      };
    }

    // Losing — fill red proportionally to how close to threshold
    const distanceToLiq = threshold - Math.abs(livePnlPercent);
    const proximity = Math.max(0, Math.min(1, Math.abs(livePnlPercent) / threshold));
    const pct = proximity * 100;

    let barColor = '#ff4d4d'; // red
    if (proximity < 0.5) barColor = 'var(--primary-hover)'; // yellow when far from liq
    if (proximity > 0.8) barColor = '#cc3d3d'; // deep red when close

    return {
      fillPercent: pct,
      color: barColor,
      label: `${livePnlPercent.toFixed(1)}%`,
      isProfit: false,
    };
  }, [livePnlPercent, exitThresholdPct, status]);

  return (
    <div className="liq-bar-wrapper">
      <div className="liq-bar-track">
        <div
          className="liq-bar-fill"
          style={{
            width: `${fillPercent}%`,
            background: isProfit
              ? `linear-gradient(90deg, ${color}44, ${color})`
              : `linear-gradient(90deg, ${color}44, ${color})`,
            boxShadow: fillPercent > 60 && !isProfit ? `0 0 8px ${color}88` : 'none',
          }}
        />
        {!isProfit && fillPercent > 0 && (
          <div
            className="liq-bar-marker"
            style={{ left: '100%' }}
            title="Liquidation"
          >
            LIQ
          </div>
        )}
      </div>
      <span
        className="liq-bar-label mono"
        style={{ color: isProfit ? '#c8ff00' : color }}
      >
        {label}
      </span>
    </div>
  );
};
