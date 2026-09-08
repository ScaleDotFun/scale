// ──────────────────────────────────────────────
// LOADED PROTOCOL — Pool spend guard
// ──────────────────────────────────────────────
//
// Every open position is an obligation the pool has to pay for later: a sell,
// a payout, and the jobs that follow, all signed by this one wallet and all
// paid in its ETH. The open route already refuses to take a user's collateral
// unless the wallet clears that reserve — but the open route is not the only
// thing that spends.
//
// The burn engine and the lock engine both move real pool ETH out on a
// schedule of their own, with no idea how many positions are waiting to be
// unwound. A thin pool plus a burn at the wrong moment leaves positions that
// can be opened and not closed, which strands a user's collateral in tokens the
// pool cannot sell. Neither of those spends is urgent; an unwind always is.
//
// So both defer instead, and both can: the burn accumulates its pending amount
// in Redis until a later job clears it, and the lock records the debt it owes
// the user and buys on the next sweep. Deferring costs a few minutes. Getting
// this wrong costs somebody their position.

import { prisma } from '@loaded/database';
import { getNativeBalance, getProtocolAccount, poolReserveFor } from '@loaded/evm';

const fmt = (wei: bigint) => `${(Number(wei) / 1e18).toFixed(6)} ETH`;

export interface SpendCheck {
  ok: boolean;
  /** Populated when ok is false — safe to log or record verbatim. */
  reason?: string;
}

/**
 * Can the pool spend `amountWei` right now without eating into the reserve the
 * open positions need to be closed?
 *
 * Errs toward refusing: if the balance cannot be read, the answer is no. A
 * deferred burn is recoverable; a position that cannot be unwound is not.
 */
export async function canSpendFromPool(amountWei: bigint): Promise<SpendCheck> {
  let balance: bigint;
  try {
    balance = await getNativeBalance(getProtocolAccount().address);
  } catch (err) {
    return {
      ok: false,
      reason: `pool balance unreadable (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  const openCount = await prisma.position
    .count({ where: { status: { in: ['open', 'opening', 'closing'] } } })
    .catch(() => null);
  if (openCount === null) {
    return { ok: false, reason: 'open-position count unreadable' };
  }

  const reserve = poolReserveFor(openCount);
  if (balance < amountWei + reserve) {
    return {
      ok: false,
      reason:
        `pool holds ${fmt(balance)}; spending ${fmt(amountWei)} would leave less than the ` +
        `${fmt(reserve)} reserve that ${openCount} open position(s) need to be closed`,
    };
  }
  return { ok: true };
}
