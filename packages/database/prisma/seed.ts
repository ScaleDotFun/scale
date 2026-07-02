import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding database (production-ready)...');

  // No fake tokens -- tokens are listed through the /api/tokens/list endpoint
  // when creators redirect their pump.fun fees to the protocol wallet.

  const tokenCount = await prisma.token.count();
  const userCount = await prisma.user.count();
  const poolBalance = await prisma.poolLedger.aggregate({ _sum: { amount: true } });
  const insuranceFundBalance = await prisma.insuranceFund.aggregate({ _sum: { amount: true } });

  console.log(`  ${tokenCount} tokens listed`);
  console.log(`  ${userCount} users registered`);
  console.log(`  Pool balance: ${poolBalance._sum.amount ?? 0n} lamports`);
  console.log(`  Insurance fund balance: ${insuranceFundBalance._sum.amount ?? 0n} lamports`);
  console.log('Done.');
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
