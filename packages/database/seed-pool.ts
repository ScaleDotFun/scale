import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const current = await prisma.poolLedger.aggregate({ _sum: { amount: true } });
  console.log('Current pool:', current._sum.amount?.toString() ?? '0', 'wei');
  
  if ((current._sum.amount ?? 0n) === 0n) {
    await prisma.poolLedger.create({
      data: {
        type: 'initial_deposit',
        amount: 500000000000000000n, // 0.5 ETH in wei
        txHash: 'manual-seed-deposit',
      }
    });
    console.log('Added 0.5 ETH deposit');
  } else {
    console.log('Pool already has funds, skipping');
  }
  
  const after = await prisma.poolLedger.aggregate({ _sum: { amount: true } });
  console.log('Pool balance:', Number(after._sum.amount ?? 0) / 1e18, 'ETH');
  await prisma.$disconnect();
}
main();
