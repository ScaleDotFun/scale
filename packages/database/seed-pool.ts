import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const current = await prisma.poolLedger.aggregate({ _sum: { amount: true } });
  console.log('Current pool:', current._sum.amount?.toString() ?? '0', 'lamports');
  
  if ((current._sum.amount ?? 0n) === 0n) {
    await prisma.poolLedger.create({
      data: {
        type: 'initial_deposit',
        amount: 500000000n,
        txSignature: 'manual-seed-deposit',
      }
    });
    console.log('Added 0.5 SOL deposit');
  } else {
    console.log('Pool already has funds, skipping');
  }
  
  const after = await prisma.poolLedger.aggregate({ _sum: { amount: true } });
  console.log('Pool balance:', Number(after._sum.amount ?? 0) / 1e9, 'SOL');
  await prisma.$disconnect();
}
main();
