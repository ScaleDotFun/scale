/**
 * Totals the $LOADED debt accrued while LOADED_TOKEN_MINT was unset.
 *
 * Every winning close withholds 30% of profit from the trader's payout. When
 * the token isn't configured, lock-engine writes the lock with buyTx='deferred'
 * — the ETH is already withheld, so the obligation is on the books with no
 * tokens behind it yet. This is the buy you commit to on launch day, priced at
 * launch, not at the price when each trade closed.
 *
 *   npx tsx packages/api/src/scripts/deferred-locks.ts
 */
import { prisma } from '@loaded/database';

const WEI = 10n ** 18n;
const eth = (w: bigint) => (Number(w) / Number(WEI)).toFixed(6);

async function main() {
  const deferred = await prisma.profitLock.findMany({
    where: { buyTx: 'deferred' },
    orderBy: { lockedAt: 'asc' },
  });

  if (deferred.length === 0) {
    console.log('No deferred locks. Nothing owed — you can launch clean.');
    return;
  }

  const total = deferred.reduce((a, l) => a + l.ethAmount, 0n);
  const wallets = new Set(deferred.map((l) => l.userWallet));
  const unclaimed = deferred.filter((l) => !l.isClaimed);
  const unclaimedTotal = unclaimed.reduce((a, l) => a + l.ethAmount, 0n);

  console.log('─'.repeat(58));
  console.log('DEFERRED $LOADED LOCKS — debt owed to traders');
  console.log('─'.repeat(58));
  console.log(`locks                ${deferred.length}`);
  console.log(`distinct traders     ${wallets.size}`);
  console.log(`oldest               ${deferred[0].lockedAt.toISOString()}`);
  console.log(`newest               ${deferred[deferred.length - 1].lockedAt.toISOString()}`);
  console.log('');
  console.log(`TOTAL WITHHELD       ${eth(total)} ETH`);
  console.log(`  still unclaimed    ${eth(unclaimedTotal)} ETH  (${unclaimed.length} locks)`);
  console.log('');
  console.log('That ETH is already off the traders\' payouts. On launch day it has');
  console.log('to become $LOADED at whatever the curve charges then.');
  console.log('─'.repeat(58));

  const top = [...deferred].sort((a, b) => (b.ethAmount > a.ethAmount ? 1 : -1)).slice(0, 5);
  console.log('largest single locks:');
  for (const l of top) {
    console.log(`  ${eth(l.ethAmount).padStart(12)} ETH  ${l.userWallet}  ${l.lockedAt.toISOString().slice(0, 10)}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
