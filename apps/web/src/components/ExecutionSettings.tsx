import { type FC } from 'react';

/**
 * Execution facts — every line here describes what the protocol
 * ACTUALLY does on-chain. No decorative toggles: swaps execute via
 * Jupiter (Solana) with bounded slippage, and TP/SL
 * levels are enforced server-side by the price monitor.
 */
const FACTS: Array<{ label: string; value: string }> = [
  { label: 'Route', value: 'Jupiter aggregator' },
  { label: 'Fees', value: 'AUTO (Solana, ~$0.001)' },
  { label: 'Slippage', value: '1.5% max' },
  { label: 'Price impact guard', value: 'rejects >5%' },
  { label: 'TP / SL', value: 'enforced by price monitor' },
];

export const ExecutionSettings: FC = () => (
  <div className="exec-settings">
    {FACTS.map((f) => (
      <div className="exec-settings-row" key={f.label}>
        <span className="exec-settings-label" style={{ fontSize: 11, color: 'var(--text-2)' }}>
          {f.label}
        </span>
        <span className="exec-settings-sub" style={{ marginTop: 0 }}>{f.value}</span>
      </div>
    ))}
  </div>
);
