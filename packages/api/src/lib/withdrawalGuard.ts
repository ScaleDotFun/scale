// ──────────────────────────────────────────────
// LOADED PROTOCOL — Withdrawal guard
// ──────────────────────────────────────────────
//
// Shared by /auth/withdraw and /wallet/withdraw, which are two implementations
// of the same operation: a guard in one and not the other is defeated by
// changing the path.
//
// What is actually being protected, stated precisely, because the previous
// version protected the wrong thing:
//
// A position in 'open' or 'closing' holds NOTHING of the user's custodial
// balance. Their collateral left that wallet when the position opened and now
// sits in the pool as tokens; the payout comes back to this same address at
// close. Refusing a withdrawal in those states froze money that was never
// committed — and because a row can stick in a terminal-looking state after an
// infrastructure failure, a single stuck position locked the user out of their
// entire wallet indefinitely. That is the worst failure a custodial service
// has, and it defended nothing.
//
// The one genuinely unsafe window is 'opening': the open route has written its
// intent row and is about to pull the collateral out of this wallet. A
// withdrawal racing that pull makes the transfer fail and the position dies for
// no reason. That window is seconds long, and the reconcile sweep takes
// ownership of anything still sitting there after five minutes — so the guard
// covers the window and then gets out of the way.

import { prisma } from '@loaded/database';

/**
 * How long an 'opening' row is treated as genuinely in flight.
 *
 * Comfortably longer than the open path's own on-chain waits, and shorter than
 * nothing — past this the reconcile sweep owns the row and will either finish
 * it forward or refund it. Holding the user's whole balance hostage while that
 * happens helps no one.
 */
export const IN_FLIGHT_WINDOW_MS = 10 * 60_000;

/**
 * Returns a human-readable reason to refuse a withdrawal, or null to allow it.
 */
export async function withdrawalBlockReason(walletAddress: string): Promise<string | null> {
  const inFlight = await prisma.position.count({
    where: {
      userWallet: walletAddress,
      status: 'opening',
      statusChangedAt: { gte: new Date(Date.now() - IN_FLIGHT_WINDOW_MS) },
    },
  });
  if (inFlight === 0) return null;
  return (
    `You have ${inFlight} position(s) still opening — the collateral is being moved out of this wallet ` +
    `right now, and withdrawing mid-transfer would fail the trade. Try again in a minute.`
  );
}
