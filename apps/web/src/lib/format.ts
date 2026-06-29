const SOL_DECIMALS = 9;

/**
 * Format lamports as SOL.
 * @example formatSol(1_500_000_000n) => "1.500"
 */
export function formatSol(
  lamports: bigint | string | number,
  decimals = 3,
): string {
  try {
    // Handle null/undefined/empty
    if (lamports == null || lamports === '') return '0.000';
    // If already a normal number (not lamports), just format
    const num = typeof lamports === 'string' ? Number(lamports) : Number(lamports);
    if (isNaN(num)) return '0.000';
    const value = num / 10 ** SOL_DECIMALS;
    return value.toFixed(decimals);
  } catch {
    return '0.000';
  }
}

/**
 * Smart price formatter that handles all price ranges.
 * - $1234.56 → "1,234.56"
 * - $1.2345 → "1.2345"
 * - $0.1821 → "0.1821"
 * - $0.00002 → "0.00002000"
 * - $0.000000123 → "0.000000123"
 */
export function formatPrice(price: number | undefined | null): string {
  if (price == null || isNaN(price) || price === 0) return '0.00';
  if (price >= 1000) return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  // Very small prices — show significant digits
  return price.toPrecision(4);
}

/**
 * Format a number as USD currency.
 * @example formatUsd(1234.56) => "$1,234.56"
 */
export function formatUsd(amount: number | undefined | null): string {
  if (amount == null || isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a percentage with sign.
 * @example formatPercent(12.5) => "+12.50%"
 * @example formatPercent(-3.2) => "-3.20%"
 */
export function formatPercent(pct: number | undefined | null): string {
  if (pct == null || isNaN(pct)) return '--';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * Format a percentage with sign, returning both text and CSS class.
 */
export function formatPercentText(pct: number): { text: string; className: string } {
  return {
    text: formatPercent(pct),
    className: pnlColor(pct),
  };
}

/**
 * Truncate a Solana address for display.
 * @example formatAddress("7xKs...3fD") => "7xKs...3fD"
 */
export function formatAddress(addr: string, chars = 4): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

/**
 * Format a large number compactly.
 * @example formatNumber(12400) => "12.4K"
 * @example formatNumber(2_300_000) => "2.3M"
 */
export function formatNumber(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return '0';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 1) return `${sign}${abs.toFixed(1)}`;
  if (abs >= 0.001) return `${sign}${abs.toFixed(4)}`;
  if (abs > 0) return `${sign}${abs.toFixed(6)}`;
  return '0';
}

/**
 * Format a number with comma separators.
 * @example formatWithCommas(1234567) => "1,234,567"
 */
export function formatWithCommas(n: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/**
 * Format a date as a relative time string.
 * @example formatTimeAgo(new Date(Date.now() - 7200000)) => "2h ago"
 */
export function formatTimeAgo(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/**
 * Format milliseconds as a countdown string.
 * @example formatCountdown(66180000) => "18h 23m"
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Expired';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Format SOL price (no trailing "SOL")
 * @example formatSolPrice(0.0000234) => "0.0000234"
 */
export function formatSolPrice(sol: number | undefined | null): string {
  if (sol == null || isNaN(sol)) return '0.0000';
  if (sol >= 1) return sol.toFixed(4);
  if (sol >= 0.001) return sol.toFixed(6);
  return sol.toFixed(9);
}

/**
 * Get the color class for a P&L value.
 */
export function pnlColor(value: number | undefined | null): string {
  if (value == null) return 'text-secondary';
  if (value > 0) return 'text-green';
  if (value < 0) return 'text-red';
  return 'text-secondary';
}

/**
 * Get solscan link for a transaction.
 */
export function solscanTxUrl(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}

/**
 * Get solscan link for an address.
 */
export function solscanAddressUrl(addr: string): string {
  return `https://solscan.io/account/${addr}`;
}
