import { type FC, useRef, useState, useCallback } from 'react';
import type { PositionInfo } from '../lib/api';

interface PnlCardGenProps {
  trade: PositionInfo;
}

/**
 * Generates a downloadable branded PnL card image for Twitter sharing.
 * Uses Canvas API to render a styled card with ROI, token, and protocol branding.
 */
export const PnlCardGen: FC<PnlCardGenProps> = ({ trade }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const pnlSol = trade.pnlSol ? Number(trade.pnlSol) / 1e9 : 0;
  const isProfit = pnlSol >= 0;
  const entryPrice = trade.entryPrice ? Number(trade.entryPrice) : 0;
  const exitPrice = trade.exitPrice ? Number(trade.exitPrice) : 0;
  const roi = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 * trade.leverage : 0;
  const capitalSol = Number(trade.userCapital || 0) / 1e9;

  const generateCard = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setGenerating(true);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 600;
    const H = 340;
    canvas.width = W;
    canvas.height = H;

    // Background
    const grad = ctx.createLinearGradient(0, 0, W, H);
    if (isProfit) {
      grad.addColorStop(0, '#0a0f0a');
      grad.addColorStop(1, '#0a1a0f');
    } else {
      grad.addColorStop(0, '#0f0a0a');
      grad.addColorStop(1, '#1a0a0f');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Border glow
    ctx.strokeStyle = isProfit ? 'rgba(52, 211, 153, 0.3)' : 'rgba(239, 68, 68, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    // Inner frame lines
    ctx.strokeStyle = isProfit ? 'rgba(52, 211, 153, 0.08)' : 'rgba(239, 68, 68, 0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(12, 12, W - 24, H - 24);

    // Protocol branding — top left
    ctx.font = 'bold 16px "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#e8f0fa';
    ctx.fillText('SCALE', 28, 42);
    ctx.font = '12px "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#5d7590';
    ctx.fillText('PROTOCOL', 82, 42);

    // Domain — top right
    ctx.font = '11px "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#3a4d63';
    ctx.textAlign = 'right';
    ctx.fillText('scale.fun', W - 28, 42);
    ctx.textAlign = 'left';

    // Divider line
    ctx.beginPath();
    ctx.moveTo(28, 58);
    ctx.lineTo(W - 28, 58);
    ctx.strokeStyle = isProfit ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Token + Leverage
    ctx.font = 'bold 22px "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#e8f0fa';
    ctx.fillText(`${trade.token?.symbol ?? '???'}`, 28, 92);
    ctx.font = '16px "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#8aa3bf';
    ctx.fillText(`${trade.leverage}x`, 28 + ctx.measureText(`${trade.token?.symbol ?? '???'}`).width + 12, 92);

    // Status badge
    ctx.font = 'bold 12px "Inter", system-ui, sans-serif';
    const statusText = trade.status === 'closed_profit' ? 'PROFIT' : trade.status === 'liquidated' ? 'LIQUIDATED' : 'LOSS';
    ctx.fillStyle = isProfit ? '#8fd0ff' : '#4a6f99';
    ctx.textAlign = 'right';
    ctx.fillText(statusText, W - 28, 92);
    ctx.textAlign = 'left';

    // Big ROI number
    const roiStr = `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`;
    ctx.font = `bold 56px "Inter", system-ui, sans-serif`;
    ctx.fillStyle = isProfit ? '#8fd0ff' : '#4a6f99';
    ctx.fillText(roiStr, 28, 168);

    // PnL in SOL
    ctx.font = '18px "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#8aa3bf';
    ctx.fillText(
      `${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL`,
      28,
      198,
    );

    // Bottom stats
    const statY = 240;
    ctx.font = '11px "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#52667d';
    ctx.fillText('CAPITAL', 28, statY);
    ctx.fillText('ENTRY', 160, statY);
    ctx.fillText('EXIT', 292, statY);
    ctx.fillText('TIER', 424, statY);

    ctx.font = '14px "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#a9c0d8';
    ctx.fillText(`${capitalSol.toFixed(3)} SOL`, 28, statY + 20);
    ctx.fillText(`${entryPrice.toFixed(8)}`, 160, statY + 20);
    ctx.fillText(`${exitPrice.toFixed(8)}`, 292, statY + 20);
    ctx.fillText((trade.tier || 'degen').toUpperCase(), 424, statY + 20);

    // Bottom divider
    ctx.beginPath();
    ctx.moveTo(28, 282);
    ctx.lineTo(W - 28, 282);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Footer
    ctx.font = '10px "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#2a3d55';
    ctx.fillText('Leveraged memecoin trading on Solana', 28, 308);
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toISOString().split('T')[0], W - 28, 308);
    ctx.textAlign = 'left';

    // Generate preview
    const url = canvas.toDataURL('image/png');
    setPreviewUrl(url);
    setGenerating(false);
  }, [trade, isProfit, pnlSol, roi, capitalSol, entryPrice, exitPrice]);

  const downloadCard = useCallback(() => {
    if (!previewUrl) return;
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = `front-pnl-${trade.token?.symbol ?? 'trade'}-${Date.now()}.png`;
    a.click();
  }, [previewUrl, trade]);

  return (
    <div className="pnl-card-gen">
      <canvas
        ref={canvasRef}
        style={{ display: previewUrl ? 'none' : 'none' }}
      />

      {!previewUrl ? (
        <button
          className="btn btn-outline btn-sm pnl-share-btn"
          onClick={generateCard}
          disabled={generating}
          type="button"
        >
          {generating ? 'Generating...' : 'Share PnL'}
        </button>
      ) : (
        <div className="pnl-card-preview">
          <img
            src={previewUrl}
            alt="PnL Card"
            className="pnl-card-img"
          />
          <div className="pnl-card-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={downloadCard}
              type="button"
            >
              Download
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPreviewUrl(null)}
              type="button"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
