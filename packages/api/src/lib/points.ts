// ──────────────────────────────────────────────
// LOADED PROTOCOL — Points (pre-token flywheel)
//
// Points come from REAL position volume only: 100 points per 1 ETH of
// notional position size, awarded when a position successfully opens
// (the swap landed — no points for failed/refunded opens). Referrers
// earn a 20% override on everything their referrals generate, forever.
// Never points for posting/social — that pattern gets projects banned.
// ──────────────────────────────────────────────

import { prisma } from '@loaded/database';
import crypto from 'node:crypto';

export const POINTS_PER_SOL = 100n;
export const REFERRAL_BONUS_BPS = 2_000n; // 20%
const WEI_PER_ETH = 1_000_000_000n;

/** Points for a position's notional size (floor). */
export function pointsForVolume(positionSizeWei: bigint): bigint {
  return (positionSizeWei * POINTS_PER_SOL) / WEI_PER_ETH;
}

/**
 * Award trade-volume points (+ referral override) for a successfully
 * opened position. Never throws — points must not break trading.
 */
export async function awardPositionPoints(
  userWallet: string,
  positionId: number,
  positionSizeWei: bigint,
): Promise<void> {
  try {
    const points = pointsForVolume(positionSizeWei);
    if (points <= 0n) return;

    const writes = [
      prisma.pointsLedger.create({
        data: { userWallet, type: 'trade_volume', points, positionId },
      }),
    ];

    const user = await prisma.user.findUnique({
      where: { walletAddress: userWallet },
      select: { referredBy: { select: { walletAddress: true } } },
    });
    const referrerWallet = user?.referredBy?.walletAddress;
    if (referrerWallet && referrerWallet !== userWallet) {
      const bonus = (points * REFERRAL_BONUS_BPS) / 10_000n;
      if (bonus > 0n) {
        writes.push(
          prisma.pointsLedger.create({
            data: {
              userWallet: referrerWallet,
              type: 'referral_bonus',
              points: bonus,
              positionId,
              refereeWallet: userWallet,
            },
          }),
        );
      }
    }
    await prisma.$transaction(writes);
  } catch (err) {
    console.error('[points] award failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no lookalikes

/** Get (or lazily mint) a user's referral code. */
export async function ensureReferralCode(userId: number): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (existing?.referralCode) return existing.referralCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = crypto.randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    try {
      await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
      return code;
    } catch {
      // unique collision — retry with fresh bytes
    }
  }
  throw new Error('could not mint referral code');
}
