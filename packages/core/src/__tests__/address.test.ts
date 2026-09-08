import { describe, it, expect } from 'vitest';
import { isEvmAddress, parseEthToWei, WEI_PER_ETH } from '../types.js';

describe('isEvmAddress', () => {
  it('accepts a well-formed address', () => {
    expect(isEvmAddress('0x' + 'a'.repeat(40))).toBe(true);
    expect(isEvmAddress('0x' + 'F'.repeat(40))).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    expect(isEvmAddress('  0x' + '1'.repeat(40) + '  ')).toBe(true);
  });

  it('rejects the base58 shapes the old length check let through', () => {
    // Every one of these sits inside the pre-fix 32–44 window.
    expect(isEvmAddress('A'.repeat(44))).toBe(false);
    expect(isEvmAddress('A'.repeat(32))).toBe(false);
    expect(isEvmAddress('not an address at all, but long')).toBe(false);
  });

  it('rejects near-misses', () => {
    expect(isEvmAddress('0x' + 'a'.repeat(39))).toBe(false);  // one short
    expect(isEvmAddress('0x' + 'a'.repeat(41))).toBe(false);  // one long
    expect(isEvmAddress('0x' + 'a'.repeat(39) + 'z')).toBe(false); // non-hex
    expect(isEvmAddress('a'.repeat(40))).toBe(false);          // no 0x
    expect(isEvmAddress('')).toBe(false);
  });
});

describe('parseEthToWei', () => {
  it('converts whole ETH', () => {
    expect(parseEthToWei('1')).toBe(WEI_PER_ETH);
    expect(parseEthToWei('0')).toBe(0n);
  });

  it('converts fractional ETH exactly', () => {
    expect(parseEthToWei('0.5')).toBe(WEI_PER_ETH / 2n);
    expect(parseEthToWei('1.5')).toBe(WEI_PER_ETH + WEI_PER_ETH / 2n);
    expect(parseEthToWei('0.000000000000000001')).toBe(1n);
  });

  it('keeps precision a float multiply would destroy', () => {
    // 0.1 * 1e18 in floating point is 100000000000000000.0 with error;
    // string parsing gives the exact value.
    expect(parseEthToWei('0.1')).toBe(100000000000000000n);
    expect(parseEthToWei('123.456789012345678')).toBe(123456789012345678000n);
  });

  it('is not the lamports conversion the bot used to do', () => {
    // The old code did Math.round(amountEth * 1e9), so 1 ETH became 1e9 wei.
    expect(parseEthToWei('1')).not.toBe(1000000000n);
  });

  it('rejects malformed input', () => {
    expect(parseEthToWei('')).toBeNull();
    expect(parseEthToWei('.')).toBeNull();
    expect(parseEthToWei('abc')).toBeNull();
    expect(parseEthToWei('-1')).toBeNull();
    expect(parseEthToWei('1e18')).toBeNull();
    expect(parseEthToWei('1.2.3')).toBeNull();
  });

  it('rejects more precision than wei can represent', () => {
    expect(parseEthToWei('0.' + '0'.repeat(18) + '1')).toBeNull();
  });
});
