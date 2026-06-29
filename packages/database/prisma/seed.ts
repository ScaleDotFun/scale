import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 Seeding database...');

  // Create sample tokens
  const popcat = await prisma.token.upsert({
    where: { address: 'PopcatXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1' },
    update: {},
    create: {
      address: 'PopcatXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',
      name: 'Popcat',
      symbol: 'POPCAT',
      creatorWallet: '7xKsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',
      tier: 'bonded',
      feeWalletPda: 'FeeVaultxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',
      totalFeesClaimed: BigInt(892_000_000_000),    // 892 SOL
      totalTradingVolume: BigInt(45230_000_000_000), // 45,230 SOL
      totalCreatorPayouts: BigInt(406_800_000_000),  // 406.8 SOL
    },
  });

  const wif = await prisma.token.upsert({
    where: { address: 'WifXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx2' },
    update: {},
    create: {
      address: 'WifXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx2',
      name: 'dogwifhat',
      symbol: 'WIF',
      creatorWallet: '9pQrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx2',
      tier: 'bonded',
      feeWalletPda: 'FeeVaultxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx2',
      totalFeesClaimed: BigInt(450_000_000_000),
      totalTradingVolume: BigInt(22000_000_000_000),
      totalCreatorPayouts: BigInt(198_000_000_000),
    },
  });

  const bonk = await prisma.token.upsert({
    where: { address: 'BonkXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx3' },
    update: {},
    create: {
      address: 'BonkXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx3',
      name: 'Bonk',
      symbol: 'BONK',
      creatorWallet: '4vBnxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx3',
      tier: 'rising',
      feeWalletPda: 'FeeVaultxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx3',
      totalFeesClaimed: BigInt(120_000_000_000),
      totalTradingVolume: BigInt(8500_000_000_000),
      totalCreatorPayouts: BigInt(76_500_000_000),
    },
  });

  // Create sample closed positions
  await prisma.position.create({
    data: {
      userWallet: 'DegenWalletxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',
      tokenId: popcat.id,
      status: 'closed_profit',
      userCapital: BigInt(300_000_000),      // 0.3 SOL
      protocolCapital: BigInt(1_800_000_000), // 1.8 SOL
      leverage: 7.0,
      flatFee: BigInt(42_000_000),           // 0.042 SOL
      tier: 'bonded',
      entryPrice: 0.42,
      exitPrice: 1.26,
      tokensBought: BigInt(5_000_000_000),
      exitThreshold: -15.0,
      pnlSol: BigInt(4_200_000_000),         // 4.2 SOL profit
      degenProfit: BigInt(2_940_000_000),     // 70%
      protocolRevenue: BigInt(1_302_000_000), // 30% + fee
      creatorPayout: BigInt(390_600_000),     // 30% of revenue
      burnAmount: BigInt(260_400_000),        // 20% of revenue
      poolReturn: BigInt(651_000_000),        // 50% of revenue
      lockAmount: BigInt(294_000_000),        // 10% of degen profit
      openTx: '5xKsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',
      closeTx: '5xKsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx2',
      closedAt: new Date(),
    },
  });

  await prisma.position.create({
    data: {
      userWallet: 'DegenWalletxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',
      tokenId: wif.id,
      status: 'closed_loss',
      userCapital: BigInt(500_000_000),
      protocolCapital: BigInt(2_000_000_000),
      leverage: 5.0,
      flatFee: BigInt(50_000_000),
      tier: 'bonded',
      entryPrice: 1.20,
      exitPrice: 1.02,
      tokensBought: BigInt(2_083_333_333),
      exitThreshold: -15.0,
      pnlSol: BigInt(-375_000_000),
      degenProfit: BigInt(0),
      protocolRevenue: BigInt(50_000_000),
      creatorPayout: BigInt(15_000_000),
      burnAmount: BigInt(10_000_000),
      poolReturn: BigInt(25_000_000),
      lockAmount: BigInt(0),
      openTx: '5xKsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx3',
      closeTx: '5xKsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx4',
      closedAt: new Date(),
    },
  });

  // Create sample burns
  await prisma.burn.create({
    data: {
      solAmount: BigInt(260_400_000),
      tokenAmount: BigInt(52_000_000_000),
      txSignature: 'BurnTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',
      positionId: 1,
    },
  });

  // Create sample profit locks
  await prisma.profitLock.create({
    data: {
      userWallet: 'DegenWalletxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',
      solAmount: BigInt(294_000_000),
      tokenAmount: BigInt(58_800_000_000),
      positionId: 1,
      buyTx: 'LockBuyTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxX1',
      lockedAt: new Date(),
      unlocksAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // Create sample pool ledger entries
  await prisma.poolLedger.createMany({
    data: [
      { type: 'fee_claim', amount: BigInt(892_000_000_000), txSignature: 'PoolTx1xxxxxxxx' },
      { type: 'position_open', amount: BigInt(-1_800_000_000), referenceId: 1 },
      { type: 'position_close', amount: BigInt(1_800_000_000), referenceId: 1 },
      { type: 'profit_recycle', amount: BigInt(651_000_000), referenceId: 1 },
    ],
  });

  console.log('✅ Database seeded successfully');
  console.log(`   Tokens: ${popcat.symbol}, ${wif.symbol}, ${bonk.symbol}`);
  console.log('   Positions: 2 (1 profit, 1 loss)');
  console.log('   Burns: 1');
  console.log('   Profit locks: 1');
}

seed()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
