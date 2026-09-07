export const ETH_DECIMALS = 18;
export const WEI_PER_ETH = 10 ** ETH_DECIMALS;

/**
 * Convert a wei amount to a floating-point ETH value.
 * Values above 2^53 wei lose precision, which is well below display resolution.
 */
export function weiToEth(wei: bigint | string | number | null | undefined): number {
  if (wei == null || wei === '') return 0;
  const num = Number(wei);
  if (isNaN(num)) return 0;
  return num / WEI_PER_ETH;
}

/**
 * Convert an ETH amount to a wei string for the API.
 * Goes through a fixed-point string so float drift never reaches the chain.
 */
export function ethToWei(eth: number | string): string {
  const num = typeof eth === 'string' ? parseFloat(eth) : eth;
  if (!isFinite(num) || num <= 0) return '0';
  const [whole, frac = ''] = num.toFixed(ETH_DECIMALS).split('.');
  return BigInt(whole + frac.padEnd(ETH_DECIMALS, '0').slice(0, ETH_DECIMALS)).toString();
}

/**
 * Format wei as ETH.
 * @example formatEth(1_500_000_000_000_000_000n) => "1.5000"
 */
export function formatEth(
  wei: bigint | string | number,
  decimals = 4,
): string {
  try {
    // Handle null/undefined/empty
    if (wei == null || wei === '') return '0.0000';
    const num = typeof wei === 'string' ? Number(wei) : Number(wei);
    if (isNaN(num)) return '0.0000';
    return (num / WEI_PER_ETH).toFixed(decimals);
  } catch {
    return '0.0000';
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
 * Truncate an address for display.
 * @example formatAddress("0x3711cea4feade896c913c68f01eda97cb06d1a42") => "0x37...1a42"
 */
export function formatAddress(addr: string, chars = 4): string {
  if (!addr) return '';
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
 * Format a ETH-denominated price (no trailing unit).
 * @example formatEthPrice(0.0000234) => "0.0000234"
 */
export function formatEthPrice(eth: number | undefined | null): string {
  if (eth == null || isNaN(eth)) return '0.0000';
  if (eth >= 1) return eth.toFixed(4);
  if (eth >= 0.001) return eth.toFixed(6);
  return eth.toFixed(9);
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

const EXPLORER = 'https://explorer.chain.robinhood.com';

/** Matches a checksummed-or-not EVM address. */
export const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** True when `addr` is a well-formed Robinhood Chain address. */
export function isValidAddress(addr: string | undefined | null): boolean {
  return !!addr && EVM_ADDRESS_RE.test(addr.trim());
}

/**
 * Block-explorer link for a transaction.
 */
export function explorerTxUrl(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

/**
 * Block-explorer link for an address.
 */
export function explorerAddressUrl(addr: string): string {
  return `${EXPLORER}/address/${addr}`;
}

/**
 * Block-explorer link for a token contract.
 */
export function explorerTokenUrl(addr: string): string {
  return `${EXPLORER}/token/${addr}`;
}
