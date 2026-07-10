// ──────────────────────────────────────────────
// FRONT PROTOCOL — Telegram Message Formatting
// ──────────────────────────────────────────────

import { WEI_PER_ETH } from '@scale/core';

/**
 * Characters that must be escaped for Telegram MarkdownV2.
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */
const MD2_SPECIAL = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

/**
 * Escape a string for safe embedding in MarkdownV2 messages.
 * Every special character is prefixed with a backslash.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(MD2_SPECIAL, '\\$1');
}

/** Wrap text in bold (MarkdownV2) */
export function bold(text: string): string {
  return `*${text}*`;
}

/** Wrap text in monospace / code (MarkdownV2) */
export function code(text: string): string {
  return `\`${text}\``;
}

/** Wrap text in a monospace block — alias kept for clarity */
export function mono(text: string): string {
  return `\`${text}\``;
}

/**
 * Format lamports (bigint or number) into a human-readable ETH string.
 * Example: `1_500_000_000n` → `"1.500 ETH"`
 */
export function formatSol(lamports: bigint | number): string {
  const lamps = typeof lamports === 'number' ? BigInt(Math.round(lamports)) : lamports;
  const whole = lamps / WEI_PER_ETH;
  const frac = lamps % WEI_PER_ETH;
  // Pad fraction to 9 digits then take the first 3 for display
  const fracStr = frac.toString().padStart(9, '0').slice(0, 3);
  return `${whole}.${fracStr} ETH`;
}

/**
 * Format a USD amount.
 * Example: `1234.5` → `"$1,234.50"`
 */
export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format a percentage with sign and colored emoji.
 * Example: `12.5` → `"🟢 +12.50%"`, `-3.2` → `"🔴 -3.20%"`
 */
export function formatPercent(pct: number): string {
  const emoji = pct >= 0 ? '🟢' : '🔴';
  const sign = pct >= 0 ? '+' : '';
  return `${emoji} ${sign}${pct.toFixed(2)}%`;
}

/**
 * Truncate a Solana address for display.
 * Example: `"7xKs3fDab..."` → `"7xKs...3fDa"`
 */
export function formatAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

/**
 * Format a Date as a relative-time string or an absolute short format.
 */
export function formatTimestamp(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) {
    // Future date — show countdown
    return formatCountdown(Math.abs(diffMs));
  }

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  // Fall back to absolute
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a millisecond countdown into `Xh Ym` or `Ym Zs`.
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Format a tier name with its emoji badge.
 */
export function tierBadge(tier: string): string {
  const badges: Record<string, string> = {
    bonded: '🟢 BONDED',
    rising: '🟡 RISING',
    degen: '🔴 DEGEN',
  };
  return badges[tier] ?? tier.toUpperCase();
}
