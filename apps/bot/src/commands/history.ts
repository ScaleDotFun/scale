// ──────────────────────────────────────────────
// FRONT PROTOCOL — /history, /pnl Commands
// ──────────────────────────────────────────────

import type { CommandContext, Context } from 'grammy';
import * as api from '../lib/api.js';
import {
  bold,
  escapeMarkdown,
  formatSol,
  formatPercent,
  formatTimestamp,
} from '../lib/format.js';

/**
 * /history — show last 20 trades with P&L, status, lock info
 */
export async function handleHistory(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const trades = await api.getTradeHistory(telegramId);

    if (trades.length === 0) {
      await ctx.reply(
        [
          `📭 ${bold('No Trade History')}`,
          ``,
          `Your completed trades will appear here\\.`,
          `Use /ape to start trading\\!`,
        ].join('\n'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    const lines: string[] = [
      `📜 ${bold(`Trade History \\(last ${escapeMarkdown(Math.min(trades.length, 20).toString())}\\)`)}`,
      ``,
    ];

    const recent = trades.slice(0, 20);

    for (const trade of recent) {
      const sym = escapeMarkdown(trade.tokenSymbol);
      const pnl = escapeMarkdown(formatPercent(trade.pnlPercent));
      const pnlSol = escapeMarkdown(formatSol(BigInt(trade.pnlLamports)));
      const lev = escapeMarkdown(`${trade.leverage}x`);
      const closedAt = trade.closedAt
        ? escapeMarkdown(formatTimestamp(new Date(trade.closedAt)))
        : 'N/A';

      // Status badge
      let statusBadge: string;
      const pnlNum = parseFloat(trade.pnlLamports);
      switch (trade.status) {
        case 'closed_profit':
          statusBadge = '🟢 WON';
          break;
        case 'closed_loss':
          statusBadge = '🔴 LOST';
          break;
        case 'liquidated':
          statusBadge = '💀 LIQ';
          break;
        case 'timed_out':
          statusBadge = pnlNum >= 0 ? '⏰ WON' : '⏰ LOST';
          break;
        default:
          statusBadge = '⚪ ???';
      }

      const lockLine = trade.profitLocked && trade.lockAmount
        ? ` 🔒 ${escapeMarkdown(formatSol(BigInt(trade.lockAmount)))}`
        : '';

      lines.push(
        `${escapeMarkdown(statusBadge)} ${bold(sym)} ${lev} → ${pnl} \\(${pnlSol}\\)${lockLine}`,
      );
      lines.push(`   ${closedAt}`);
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/history] error:', err);
    await ctx.reply('⚠️ Failed to load trade history\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /pnl — show overall profit/loss, win rate, total $APE accumulated
 */
export async function handlePnL(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const pnl = await api.getPnL(telegramId);

    const netLamports = BigInt(pnl.netPnlLamports);
    const isProfit = netLamports >= 0n;
    const emoji = isProfit ? '🟢' : '🔴';
    const sign = isProfit ? '\\+' : '';

    const totalProfit = escapeMarkdown(formatSol(BigInt(pnl.totalProfitLamports)));
    const totalLoss = escapeMarkdown(formatSol(BigInt(pnl.totalLossLamports)));
    const net = escapeMarkdown(formatSol(netLamports < 0n ? -netLamports : netLamports));
    const winRate = escapeMarkdown(pnl.winRate.toFixed(1));
    const ape = escapeMarkdown(parseFloat(pnl.totalApeAccumulated).toLocaleString('en-US'));

    const msg = [
      `📊 ${bold('P\\&L Summary')}`,
      ``,
      `${emoji} ${bold('Net P\\&L:')} ${sign}${net}`,
      ``,
      `${bold('Total Profit:')} 🟢 ${totalProfit}`,
      `${bold('Total Loss:')} 🔴 ${totalLoss}`,
      ``,
      `${bold('Wins:')} ${escapeMarkdown(pnl.winCount.toString())}`,
      `${bold('Losses:')} ${escapeMarkdown(pnl.lossCount.toString())}`,
      `${bold('Win Rate:')} ${winRate}%`,
      ``,
      `🔒 ${bold('Total \\$APE Accumulated:')} ${ape}`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/pnl] error:', err);
    await ctx.reply('⚠️ Failed to load P\\&L\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}
