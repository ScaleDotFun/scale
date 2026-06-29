// ──────────────────────────────────────────────
// FRONT PROTOCOL — /burns, /stats, /pool Commands
// ──────────────────────────────────────────────

import type { CommandContext, Context } from 'grammy';
import * as api from '../lib/api.js';
import {
  bold,
  escapeMarkdown,
  formatSol,
  formatTimestamp,
  formatAddress,
  code,
} from '../lib/format.js';

/**
 * /burns — recent burns + total burned counter
 */
export async function handleBurns(ctx: CommandContext<Context>): Promise<void> {
  try {
    const [burns, stats] = await Promise.all([
      api.getBurns(),
      api.getBurnStats(),
    ]);

    const totalSol = escapeMarkdown(formatSol(BigInt(stats.totalBurnedLamports)));
    const totalTokens = escapeMarkdown(BigInt(stats.totalBurnedTokens).toLocaleString());
    const count = escapeMarkdown(stats.burnCount.toString());

    const lines: string[] = [
      `🔥 ${bold('\\$APE Burns')}`,
      ``,
      `${bold('Total Burned:')} ${totalSol}`,
      `${bold('Tokens Burned:')} ${totalTokens} \\$APE`,
      `${bold('Burn Count:')} ${count}`,
      ``,
    ];

    if (burns.length > 0) {
      lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
      lines.push(`${bold('Recent Burns')}`);
      lines.push(``);

      for (const burn of burns.slice(0, 10)) {
        const amt = escapeMarkdown(formatSol(BigInt(burn.amountLamports)));
        const tokens = escapeMarkdown(BigInt(burn.apeTokensBurned).toLocaleString());
        const when = escapeMarkdown(formatTimestamp(new Date(burn.burnedAt)));
        const tx = escapeMarkdown(formatAddress(burn.txSignature));

        lines.push(`🔥 ${amt} \\(${tokens} \\$APE\\) — ${when}`);
        lines.push(`   tx: ${code(tx)}`);
      }
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/burns] error:', err);
    await ctx.reply('⚠️ Failed to load burn data\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /stats — protocol statistics
 */
export async function handleStats(ctx: CommandContext<Context>): Promise<void> {
  try {
    const stats = await api.getProtocolStats();

    const pool = escapeMarkdown(formatSol(BigInt(stats.poolSizeLamports)));
    const burned = escapeMarkdown(formatSol(BigInt(stats.totalBurnedLamports)));
    const locked = escapeMarkdown(formatSol(BigInt(stats.totalLockedLamports)));
    const creatorPay = escapeMarkdown(formatSol(BigInt(stats.totalCreatorPayoutsLamports)));
    const trades = escapeMarkdown(stats.totalTradesExecuted.toLocaleString());
    const listed = escapeMarkdown(stats.totalListedTokens.toString());
    const active = escapeMarkdown(stats.activePositions.toString());

    const msg = [
      `📊 ${bold('Protocol Statistics')}`,
      ``,
      `${bold('🏦 Capital Pool:')} ${pool}`,
      `${bold('📈 Total Trades:')} ${trades}`,
      `${bold('📋 Listed Tokens:')} ${listed}`,
      `${bold('⚡ Active Positions:')} ${active}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `${bold('🔥 Total Burned:')} ${burned}`,
      `${bold('🔒 Total Locked:')} ${locked}`,
      `${bold('🎨 Creator Payouts:')} ${creatorPay}`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/stats] error:', err);
    await ctx.reply('⚠️ Failed to load protocol stats\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /pool — capital pool details
 */
export async function handlePool(ctx: CommandContext<Context>): Promise<void> {
  try {
    const pool = await api.getPoolInfo();

    const size = escapeMarkdown(formatSol(BigInt(pool.sizeLamports)));
    const avail = escapeMarkdown(formatSol(BigInt(pool.availableLamports)));
    const util = escapeMarkdown(pool.utilizationPct.toFixed(1));

    // Simple utilization bar
    const filledBlocks = Math.round(pool.utilizationPct / 5);
    const emptyBlocks = 20 - filledBlocks;
    const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

    const msg = [
      `🏦 ${bold('Capital Pool')}`,
      ``,
      `${bold('Total Size:')} ${size}`,
      `${bold('Available:')} ${avail}`,
      `${bold('Utilization:')} ${util}%`,
      ``,
      `${code(escapeMarkdown(bar))} ${util}%`,
      ``,
      `The capital pool funds the protocol side of leveraged positions\\.`,
      `It grows from trading fees and profit share\\.`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/pool] error:', err);
    await ctx.reply('⚠️ Failed to load pool info\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}
