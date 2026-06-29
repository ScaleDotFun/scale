// ──────────────────────────────────────────────
// FRONT PROTOCOL — /creator, /earnings, /claim
// ──────────────────────────────────────────────

import type { CommandContext, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import * as api from '../lib/api.js';
import {
  bold,
  escapeMarkdown,
  formatSol,
  formatUsd,
  formatTimestamp,
  tierBadge,
} from '../lib/format.js';

/**
 * /creator — full creator dashboard
 */
export async function handleCreator(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const dash = await api.getCreatorDashboard(telegramId);

    const sym = escapeMarkdown(dash.tokenSymbol);
    const tier = escapeMarkdown(tierBadge(dash.tier));
    const listedAt = escapeMarkdown(formatTimestamp(new Date(dash.listedAt)));

    const totalVol = escapeMarkdown(formatSol(BigInt(dash.totalTradingVolume)));
    const totalFees = escapeMarkdown(formatSol(BigInt(dash.totalFeesGenerated)));
    const totalEarnings = escapeMarkdown(formatSol(BigInt(dash.totalEarnings)));

    const todayVol = escapeMarkdown(formatSol(BigInt(dash.todayTradingVolume)));
    const todayFees = escapeMarkdown(formatSol(BigInt(dash.todayFeesGenerated)));
    const todayEarnings = escapeMarkdown(formatSol(BigInt(dash.todayEarnings)));

    const unclaimed = escapeMarkdown(formatSol(BigInt(dash.unclaimedEarnings)));
    const redirected = escapeMarkdown(formatSol(BigInt(dash.feesRedirected)));

    const msg = [
      `🎨 ${bold('Creator Dashboard')}`,
      ``,
      `${bold('Token:')} ${sym} \\[${tier}\\]`,
      `${bold('Listed:')} ${listedAt}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `${bold('📊 Today')}`,
      ``,
      `${bold('Volume:')} ${todayVol}`,
      `${bold('Fees Generated:')} ${todayFees}`,
      `${bold('Your Earnings:')} ${todayEarnings}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `${bold('📈 All Time')}`,
      ``,
      `${bold('Total Volume:')} ${totalVol}`,
      `${bold('Total Fees:')} ${totalFees}`,
      `${bold('Total Earnings:')} ${totalEarnings}`,
      `${bold('Fees Redirected:')} ${redirected}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `💰 ${bold('Unclaimed:')} ${unclaimed}`,
      ``,
      `Use /claim to claim your earnings\\!`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    if (err instanceof api.ApiError && err.status === 404) {
      await ctx.reply(
        [
          `🎨 ${bold('Creator Dashboard')}`,
          ``,
          `You don't have a listed token yet\\.`,
          `List your Pump\\.fun token to start earning 30% of trading fees\\!`,
        ].join('\n'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }
    console.error('[/creator] error:', err);
    await ctx.reply('⚠️ Failed to load creator dashboard\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /earnings — detailed earnings breakdown
 */
export async function handleEarnings(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const earnings = await api.getCreatorEarnings(telegramId);

    const total = escapeMarkdown(formatSol(BigInt(earnings.totalEarnings)));
    const unclaimed = escapeMarkdown(formatSol(BigInt(earnings.unclaimedEarnings)));
    const claimed = escapeMarkdown(formatSol(BigInt(earnings.claimedEarnings)));

    const lines: string[] = [
      `💰 ${bold('Earnings Breakdown')}`,
      ``,
      `${bold('Total Earned:')} ${total}`,
      `${bold('Claimed:')} ${claimed}`,
      `${bold('Unclaimed:')} ${unclaimed}`,
      ``,
    ];

    if (earnings.payouts.length > 0) {
      lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
      lines.push(`${bold('Recent Payouts')}`);
      lines.push(``);

      for (const payout of earnings.payouts.slice(0, 15)) {
        const amt = escapeMarkdown(formatSol(BigInt(payout.amountLamports)));
        const status = payout.status === 'claimed' ? '✅' : payout.status === 'claimable' ? '💰' : '⏳';
        const date = escapeMarkdown(formatTimestamp(new Date(payout.createdAt)));
        lines.push(`${status} ${amt} — ${date}`);
      }
    }

    lines.push(``);
    lines.push(`Use /claim to claim pending earnings`);

    await ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    if (err instanceof api.ApiError && err.status === 404) {
      await ctx.reply(
        '❌ No earnings found\\. You need a listed token to earn creator fees\\.',
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }
    console.error('[/earnings] error:', err);
    await ctx.reply('⚠️ Failed to load earnings\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /claim — claim earnings with confirmation
 */
export async function handleClaim(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const earnings = await api.getCreatorEarnings(telegramId);
    const unclaimedLamports = BigInt(earnings.unclaimedEarnings);

    if (unclaimedLamports === 0n) {
      await ctx.reply('📭 No unclaimed earnings\\. Check back after more trades\\!', {
        parse_mode: 'MarkdownV2',
      });
      return;
    }

    const unclaimed = escapeMarkdown(formatSol(unclaimedLamports));

    const keyboard = new InlineKeyboard()
      .text('✅ Claim', 'confirm_claim')
      .text('❌ Cancel', 'cancel_claim');

    const msg = [
      `💰 ${bold('Claim Creator Earnings')}`,
      ``,
      `${bold('Amount:')} ${unclaimed}`,
      ``,
      `This will transfer your unclaimed earnings to your wallet\\.`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  } catch (err) {
    if (err instanceof api.ApiError && err.status === 404) {
      await ctx.reply(
        '❌ No creator account found\\. List a token first\\!',
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }
    console.error('[/claim] error:', err);
    await ctx.reply('⚠️ Failed to process claim\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}
