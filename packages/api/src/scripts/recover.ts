/**
 * LOADED — fund recovery tool.
 *
 * Every protocol fund lives in ONE place: the pool wallet. The insurance fund,
 * unclaimed creator payouts and profit locks are database LEDGERS against that
 * single wallet, not separate accounts — so recovering the pool recovers all of
 * them. User deposits are the exception: each user has their own custodial
 * wallet whose key is encrypted in the database.
 *
 * That means exactly two secrets stand between you and every penny:
 *   PROTOCOL_WALLET_PRIVATE_KEY  — the pool (protocol funds)
 *   ENCRYPTION_KEY + the database — every user's wallet
 * Lose either and the corresponding funds are gone permanently. This tool
 * exists so you can verify that at any time, and move the money if you need to.
 *
 * Usage (from packages/api, with DATABASE_URL / PROTOCOL_WALLET_PRIVATE_KEY /
 * ENCRYPTION_KEY set):
 *   node dist/scripts/recover.js report
 *   node dist/scripts/recover.js sweep-pool 0xYourWallet          [--execute]
 *   node dist/scripts/recover.js sweep-users 0xYourWallet         [--execute]
 *   node dist/scripts/recover.js export-keys ./keys.json
 *
 * Nothing moves without --execute. Every command is safe to run as a dry run.
 */
import { prisma } from '@loaded/database';
import {
  getProtocolAccount,
  hasProtocolKey,
  protocolPublicKey,
  loadCustodialWallet,
  getNativeBalance,
  transferNative,
  erc20Balance,
  erc20Transfer,
  isValidAddress,
  explorerAddressUrl,
} from '@loaded/evm';

const fmt = (wei: bigint) => `${(Number(wei) / 1e18).toFixed(6)} ETH`;

/** Gas the sweep itself needs; sending the entire balance would strand the tx. */
const GAS_RESERVE = 200_000_000_000_000n; // 0.0002 ETH

async function report(): Promise<void> {
  console.log('\n════ WHERE THE MONEY IS ════\n');

  const pool = protocolPublicKey();
  if (!pool) {
    console.log('POOL WALLET: NOT CONFIGURED — PROTOCOL_WALLET_PRIVATE_KEY is missing.');
    console.log('  Protocol funds cannot be moved without it.\n');
  } else {
    const bal = await getNativeBalance(pool).catch(() => 0n);
    console.log(`POOL WALLET  ${pool}`);
    console.log(`  on-chain ETH : ${fmt(bal)}`);
    console.log(`  key present  : ${hasProtocolKey() ? 'YES — funds are movable' : 'NO — FUNDS ARE STRANDED'}`);
    console.log(`  explorer     : ${explorerAddressUrl(pool)}`);

    // These are claims against the pool wallet, not separate accounts.
    const [ins, ledger, payouts, locks] = await Promise.all([
      prisma.insuranceFund.aggregate({ _sum: { amount: true } }),
      prisma.poolLedger.aggregate({ _sum: { amount: true } }),
      prisma.creatorPayout.aggregate({ _sum: { amount: true }, where: { status: 'claimable' } }),
      // isUnlocked, not isClaimed: the release path sets isUnlocked when the
      // tokens actually leave the wallet, and nothing anywhere writes
      // isClaimed — so filtering on it counted every lock ever created as
      // still owed, including ones already paid out.
      prisma.profitLock.aggregate({ _sum: { tokenAmount: true }, where: { isUnlocked: false } }),
    ]);
    console.log('\n  Claims recorded against that same wallet:');
    console.log(`    pool ledger        : ${fmt(ledger._sum.amount ?? 0n)}`);
    console.log(`    insurance fund     : ${fmt(ins._sum.amount ?? 0n)}`);
    console.log(`    unclaimed creators : ${fmt(payouts._sum.amount ?? 0n)}`);
    console.log(`    unclaimed $LOADED  : ${(locks._sum?.tokenAmount ?? 0n).toString()} raw token units`);
    console.log('    (ledgers are accounting only — the ETH itself is the balance above)');
  }

  // Every ERC-20 the pool could be holding — not just the ones attached to
  // an open position. Locked $LOADED, tokens from a burn whose burn leg
  // failed, and residue left on closed or failed rows all sit in this same
  // wallet, and a report that cannot see them hides real money.
  if (pool) {
    const universe = await poolTokenUniverse();
    const held: Array<{ address: string; symbol: string | null; bal: bigint }> = [];
    for (const t of universe) {
      const bal = await erc20Balance(t.address, pool).catch(() => 0n);
      if (bal > 0n) held.push({ ...t, bal });
    }
    console.log(`\n  ERC-20 held by the pool (${held.length} of ${universe.length} known tokens):`);
    if (held.length === 0) console.log('    none');
    for (const h of held) console.log(`    ${h.symbol ?? h.address}: ${h.bal} raw  (${h.address})`);
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true, walletAddress: true, encryptedKey: true },
  });
  console.log(`\nUSER CUSTODIAL WALLETS  (${users.length})`);
  if (users.length === 0) {
    console.log('  none');
  } else {
    let total = 0n;
    let funded = 0;
    for (const u of users) {
      const bal = await getNativeBalance(u.walletAddress).catch(() => 0n);
      total += bal;
      if (bal > 0n) {
        funded++;
        console.log(`  ${u.walletAddress}  ${fmt(bal)}  ${u.email}`);
      }
    }
    console.log(`  funded: ${funded}/${users.length}   total: ${fmt(total)}`);
    console.log(`  recoverable only with ENCRYPTION_KEY + this database.`);
  }

  const tg = await prisma.telegramUser.findMany({
    select: { telegramId: true, walletAddress: true, encryptedKey: true },
  });
  console.log(`\nTELEGRAM BOT WALLETS  (${tg.length})`);
  if (tg.length === 0) {
    console.log('  none');
  } else {
    let total = 0n;
    for (const t of tg) {
      const bal = await getNativeBalance(t.walletAddress).catch(() => 0n);
      total += bal;
      if (bal > 0n) console.log(`  ${t.walletAddress}  ${fmt(bal)}  tg:${t.telegramId}`);
    }
    console.log(`  total: ${fmt(total)}   (same ENCRYPTION_KEY, swept by sweep-users)`);
  }

  console.log('\n════ THE TWO SECRETS THAT MATTER ════');
  console.log(`  PROTOCOL_WALLET_PRIVATE_KEY : ${hasProtocolKey() ? 'loaded' : 'MISSING'}  → protocol funds`);
  console.log(`  ENCRYPTION_KEY              : ${process.env.ENCRYPTION_KEY ? 'loaded' : 'MISSING'}  → every user wallet`);
  console.log('  Back BOTH up outside Railway. Without them the funds above cannot be moved by anyone.\n');
}

/**
 * Every ERC-20 the pool could plausibly hold. Enumerating only tokens attached
 * to an open position misses locked $LOADED, tokens bought for a burn that
 * never burned, and residue on closed rows — all of it real money in the same
 * wallet.
 */
async function poolTokenUniverse(): Promise<Array<{ address: string; symbol: string | null }>> {
  const rows = await prisma.token.findMany({ select: { address: true, symbol: true } });
  const byAddr = new Map(rows.map((t) => [t.address.toLowerCase(), t]));
  const loaded = (process.env.LOADED_TOKEN_MINT || '').trim();
  if (loaded && isValidAddress(loaded) && !byAddr.has(loaded.toLowerCase())) {
    byAddr.set(loaded.toLowerCase(), { address: loaded, symbol: 'LOADED' });
  }
  return [...byAddr.values()];
}

async function sweepPool(dest: string, execute: boolean): Promise<void> {
  if (!isValidAddress(dest)) throw new Error(`destination is not a valid address: ${dest}`);
  if (!hasProtocolKey()) throw new Error('PROTOCOL_WALLET_PRIVATE_KEY is not set — nothing can be moved');
  const account = getProtocolAccount();

  // ERC-20 first: sending ETH away first would leave no gas to move tokens.
  //
  // Every transfer is isolated. A launchpad coin that pauses or blacklists
  // transfers is routine, and an unguarded throw here used to abort the whole
  // script before the ETH sweep below ever ran — so one honeypot could strand
  // the insurance fund, every unclaimed creator payout and all collateral in
  // flight, deterministically, on every retry.
  const failed: string[] = [];
  for (const t of await poolTokenUniverse()) {
    try {
      const bal = await erc20Balance(t.address, account.address).catch(() => 0n);
      if (bal <= 0n) continue;
      console.log(`  ${execute ? 'sending' : 'would send'} ${bal} raw ${t.symbol ?? t.address} → ${dest}`);
      if (execute) console.log(`    tx ${await erc20Transfer(account, t.address, dest, bal)}`);
    } catch (e) {
      failed.push(`${t.symbol ?? t.address}: ${(e as Error).message}`);
      console.error(`  FAILED ${t.symbol ?? t.address} — continuing: ${(e as Error).message}`);
    }
  }

  const bal = await getNativeBalance(account.address);
  const amount = bal > GAS_RESERVE ? bal - GAS_RESERVE : 0n;
  if (amount <= 0n) {
    console.log(`  pool holds ${fmt(bal)} — nothing above the gas reserve to sweep`);
  } else {
    console.log(`  ${execute ? 'sending' : 'would send'} ${fmt(amount)} → ${dest} (leaving ${fmt(GAS_RESERVE)} for gas)`);
    if (execute) console.log(`    tx ${await transferNative(account, dest, amount)}`);
  }

  if (failed.length) {
    console.error(`\n  ${failed.length} token transfer(s) failed — the ETH above still moved:`);
    for (const f of failed) console.error(`    ${f}`);
    process.exitCode = 1;
  }
}

async function sweepUsers(dest: string, execute: boolean): Promise<void> {
  if (!isValidAddress(dest)) throw new Error(`destination is not a valid address: ${dest}`);
  // Telegram bot wallets are custodial wallets too — same generator, same
  // ENCRYPTION_KEY, real deposits — and were previously invisible here.
  const [webUsers, tgUsers] = await Promise.all([
    prisma.user.findMany({ select: { email: true, walletAddress: true, encryptedKey: true } }),
    prisma.telegramUser.findMany({ select: { telegramId: true, walletAddress: true, encryptedKey: true } }),
  ]);
  const users = [
    ...webUsers,
    ...tgUsers.map((t) => ({ email: `telegram:${t.telegramId}`, walletAddress: t.walletAddress, encryptedKey: t.encryptedKey })),
  ];
  let moved = 0n;
  // Isolated per user: one row with a corrupt or undecryptable key used to
  // abort the process and strand every user after it in the list.
  const failed: string[] = [];
  for (const u of users) {
    try {
      const bal = await getNativeBalance(u.walletAddress).catch(() => 0n);
      const amount = bal > GAS_RESERVE ? bal - GAS_RESERVE : 0n;
      if (amount <= 0n) continue;
      console.log(`  ${execute ? 'sweeping' : 'would sweep'} ${fmt(amount)} from ${u.walletAddress} (${u.email})`);
      if (execute) {
        const acct = loadCustodialWallet(u.encryptedKey);
        console.log(`    tx ${await transferNative(acct, dest, amount)}`);
      }
      // Counted only once the transfer has actually landed, so the total is
      // what moved rather than what was attempted.
      moved += amount;
    } catch (e) {
      failed.push(`${u.walletAddress} (${u.email}): ${(e as Error).message}`);
      console.error(`  FAILED ${u.walletAddress} — continuing: ${(e as Error).message}`);
    }
  }
  console.log(`  total ${execute ? 'swept' : 'recoverable'}: ${fmt(moved)}`);
  if (failed.length) {
    console.error(`  ${failed.length} wallet(s) could not be swept:`);
    for (const f of failed) console.error(`    ${f}`);
    process.exitCode = 1;
  }
}

async function exportKeys(path: string): Promise<void> {
  const fs = await import('node:fs');
  const [webUsers, tgUsers] = await Promise.all([
    prisma.user.findMany({ select: { email: true, walletAddress: true, encryptedKey: true } }),
    prisma.telegramUser.findMany({ select: { telegramId: true, walletAddress: true, encryptedKey: true } }),
  ]);
  const users = [
    ...webUsers,
    ...tgUsers.map((t) => ({ email: `telegram:${t.telegramId}`, walletAddress: t.walletAddress, encryptedKey: t.encryptedKey })),
  ];
  // Decrypt separately so a failure on one row does not abort the export.
  const rows = users.map((u) => {
    try {
      const acct = loadCustodialWallet(u.encryptedKey);
      return { email: u.email, address: acct.address, ok: true };
    } catch (e) {
      return { email: u.email, address: u.walletAddress, ok: false, error: (e as Error).message };
    }
  });
  fs.writeFileSync(path, JSON.stringify({ exportedAt: new Date().toISOString(), wallets: rows }, null, 2));
  console.log(`  wrote ${rows.length} wallet records to ${path}`);
  console.log(`  decryptable: ${rows.filter((r) => r.ok).length}/${rows.length}`);
  console.log('  NOTE: this file proves the keys are decryptable. Treat it as sensitive.');
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  const execute = process.argv.includes('--execute');
  if (!execute && (cmd === 'sweep-pool' || cmd === 'sweep-users')) {
    console.log('\n*** DRY RUN — pass --execute to actually move funds ***');
  }
  switch (cmd) {
    case 'report': await report(); break;
    case 'sweep-pool': await sweepPool(arg!, execute); break;
    case 'sweep-users': await sweepUsers(arg!, execute); break;
    case 'export-keys': await exportKeys(arg ?? './wallet-export.json'); break;
    default:
      console.log('commands: report | sweep-pool <dest> | sweep-users <dest> | export-keys [path]');
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('recover failed:', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
