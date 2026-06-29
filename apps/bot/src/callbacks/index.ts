// ──────────────────────────────────────────────
// FRONT PROTOCOL — Callback Query Router
// ──────────────────────────────────────────────

import type { Context } from 'grammy';
import * as api from '../lib/api.js';
import {
  bold,
  code,
  escapeMarkdown,
  formatSol,
  formatPercent,
  formatAddress,
} from '../lib/format.js';
import { showListedPage } from '../commands/discovery.js';

/**
 * Route all inline keyboard callback queries.
 * Callback data format: `action:payload`
 */
export async function handleCallbackQuery(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    await ctx.answerCallbackQuery({ text: 'Unknown action' });
    return;
  }

  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) {
    await ctx.answerCallbackQuery({ text: 'Could not identify user' });
    return;
  }

  try {
    // ── Confirm open position ──
    if (data.startsWith('confirm_ape:')) {
      await handleConfirmApe(ctx, telegramId, data.slice('confirm_ape:'.length));
      return;
    }

    // ── Cancel open position ──
    if (data === 'cancel_ape') {
      await ctx.answerCallbackQuery({ text: 'Position cancelled' });
      await ctx.editMessageText('❌ Position cancelled\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    // ── Confirm close single position ──
    if (data.startsWith('confirm_close:')) {
      await handleConfirmClose(ctx, telegramId, data.slice('confirm_close:'.length));
      return;
    }

    // ── Confirm close all positions ──
    if (data === 'confirm_closeall') {
      await handleConfirmCloseAll(ctx, telegramId);
      return;
    }

    // ── Cancel close ──
    if (data === 'cancel_close') {
      await ctx.answerCallbackQuery({ text: 'Keeping positions open' });
      await ctx.editMessageText('✅ Positions kept open\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    // ── Confirm withdrawal ──
    if (data.startsWith('confirm_withdraw:')) {
      await handleConfirmWithdraw(ctx, telegramId, data.slice('confirm_withdraw:'.length));
      return;
    }

    // ── Cancel withdrawal ──
    if (data === 'cancel_withdraw') {
      await ctx.answerCallbackQuery({ text: 'Withdrawal cancelled' });
      await ctx.editMessageText('❌ Withdrawal cancelled\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    // ── Confirm creator earnings claim ──
    if (data === 'confirm_claim') {
      await handleConfirmClaim(ctx, telegramId);
      return;
    }

    // ── Cancel claim ──
    if (data === 'cancel_claim') {
      await ctx.answerCallbackQuery({ text: 'Claim cancelled' });
      await ctx.editMessageText('❌ Claim cancelled\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    // ── Pagination ──
    if (data.startsWith('page:')) {
      await handlePagination(ctx, data);
      return;
    }

    // Unknown callback
    await ctx.answerCallbackQuery({ text: 'Unknown action' });
  } catch (err) {
    console.error('[callback] error:', err);
    await ctx.answerCallbackQuery({ text: '⚠️ Something went wrong' });
    try {
      await ctx.reply('⚠️ An error occurred processing your action\\. Please try again\\.', {
        parse_mode: 'MarkdownV2',
      });
    } catch {
      // Best effort
    }
  }
}

// ──────────────────────────────────────────────
// Confirm APE IN
// ──────────────────────────────────────────────

async function handleConfirmApe(ctx: Context, telegramId: string, payload: string): Promise<void> {
  const parts = payload.split('|');
  if (parts.length < 3) {
    await ctx.answerCallbackQuery({ text: 'Invalid position data' });
    return;
  }

  const [tokenAddress, amountStr, leverageStr] = parts;
  const amountSol = parseFloat(amountStr);
  const leverage = parseInt(leverageStr, 10);

  await ctx.answerCallbackQuery({ text: '🦍 Opening position...' });
  await ctx.editMessageText('⏳ Opening position\\.\\.\\. 🦍', { parse_mode: 'MarkdownV2' });

  try {
    const result = await api.openPosition(telegramId, tokenAddress, amountSol, leverage);

    const pos = result.position;
    const sym = escapeMarkdown(pos.tokenSymbol);
    const lev = escapeMarkdown(`${pos.leverage}x`);
    const size = escapeMarkdown(formatSol(BigInt(pos.positionSizeLamports)));
    const entry = escapeMarkdown(pos.entryPriceSol.toFixed(8));
    const txShort = escapeMarkdown(formatAddress(result.txSignature));

    const msg = [
      `🦍 ${bold('Position Opened\\!')}`,
      ``,
      `${bold('Token:')} ${sym}`,
      `${bold('Leverage:')} ${lev}`,
      `${bold('Position Size:')} ${size}`,
      `${bold('Entry Price:')} ${entry} SOL`,
      ``,
      `${bold('ID:')} ${code(escapeMarkdown(result.positionId))}`,
      `${bold('tx:')} ${code(txShort)}`,
      ``,
      `⏱ Position expires in 24h`,
      `Use /positions to monitor or /close to exit`,
    ].join('\n');

    await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    const errMsg = err instanceof api.ApiError ? err.body : 'Unknown error';
    await ctx.editMessageText(
      `❌ Failed to open position: ${escapeMarkdown(errMsg)}`,
      { parse_mode: 'MarkdownV2' },
    );
  }
}

// ──────────────────────────────────────────────
// Confirm close single position
// ──────────────────────────────────────────────

async function handleConfirmClose(
  ctx: Context,
  telegramId: string,
  positionId: string,
): Promise<void> {
  await ctx.answerCallbackQuery({ text: 'Closing position...' });
  await ctx.editMessageText('⏳ Closing position\\.\\.\\. 📦', { parse_mode: 'MarkdownV2' });

  try {
    const result = await api.closePosition(telegramId, positionId);

    const pnlLamports = BigInt(result.pnlLamports);
    const emoji = result.isProfitable ? '🟢' : '🔴';
    const sign = result.isProfitable ? '\\+' : '';
    const pnl = escapeMarkdown(formatSol(pnlLamports < 0n ? -pnlLamports : pnlLamports));
    const cashout = escapeMarkdown(formatSol(BigInt(result.cashoutLamports)));
    const txShort = escapeMarkdown(formatAddress(result.txSignature));

    const lines = [
      `📦 ${bold('Position Closed')}`,
      ``,
      `${emoji} ${bold('P\\&L:')} ${sign}${pnl}`,
      `${bold('Cashout:')} ${cashout}`,
    ];

    if (result.lockLamports) {
      const lockAmt = escapeMarkdown(formatSol(BigInt(result.lockLamports)));
      lines.push(`${bold('🔒 Locked:')} ${lockAmt} → \\$APE \\(7d\\)`);
    }

    lines.push(``);
    lines.push(`tx: ${code(txShort)}`);

    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    const errMsg = err instanceof api.ApiError ? err.body : 'Unknown error';
    await ctx.editMessageText(
      `❌ Failed to close position: ${escapeMarkdown(errMsg)}`,
      { parse_mode: 'MarkdownV2' },
    );
  }
}

// ──────────────────────────────────────────────
// Confirm close ALL positions
// ──────────────────────────────────────────────

async function handleConfirmCloseAll(ctx: Context, telegramId: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: 'Closing all positions...' });
  await ctx.editMessageText('⏳ Closing all positions\\.\\.\\. 🔴', { parse_mode: 'MarkdownV2' });

  try {
    const positions = await api.getActivePositions(telegramId);

    if (positions.length === 0) {
      await ctx.editMessageText('📭 No positions to close\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const results: string[] = [];
    let totalPnl = 0n;

    for (const pos of positions) {
      try {
        const result = await api.closePosition(telegramId, pos.id);
        const pnlLamports = BigInt(result.pnlLamports);
        totalPnl += pnlLamports;
        const emoji = result.isProfitable ? '🟢' : '🔴';
        const pnl = escapeMarkdown(formatSol(pnlLamports < 0n ? -pnlLamports : pnlLamports));
        const sign = result.isProfitable ? '\\+' : '\\-';
        results.push(`${emoji} ${escapeMarkdown(pos.tokenSymbol)} → ${sign}${pnl}`);
      } catch {
        results.push(`⚠️ ${escapeMarkdown(pos.tokenSymbol)} → failed to close`);
      }
    }

    const netEmoji = totalPnl >= 0n ? '🟢' : '🔴';
    const netSign = totalPnl >= 0n ? '\\+' : '\\-';
    const netPnl = escapeMarkdown(formatSol(totalPnl < 0n ? -totalPnl : totalPnl));

    const lines = [
      `📦 ${bold('All Positions Closed')}`,
      ``,
      ...results,
      ``,
      `${netEmoji} ${bold('Net P\\&L:')} ${netSign}${netPnl}`,
    ];

    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    const errMsg = err instanceof api.ApiError ? err.body : 'Unknown error';
    await ctx.editMessageText(
      `❌ Failed to close all positions: ${escapeMarkdown(errMsg)}`,
      { parse_mode: 'MarkdownV2' },
    );
  }
}

// ──────────────────────────────────────────────
// Confirm withdrawal
// ──────────────────────────────────────────────

async function handleConfirmWithdraw(
  ctx: Context,
  telegramId: string,
  payload: string,
): Promise<void> {
  // payload = amountLamports:toAddress
  const colonIdx = payload.indexOf(':');
  if (colonIdx < 0) {
    await ctx.answerCallbackQuery({ text: 'Invalid withdrawal data' });
    return;
  }
  const amountLamports = payload.slice(0, colonIdx);
  const toAddress = payload.slice(colonIdx + 1);

  await ctx.answerCallbackQuery({ text: 'Processing withdrawal...' });
  await ctx.editMessageText('⏳ Processing withdrawal\\.\\.\\. 📤', { parse_mode: 'MarkdownV2' });

  try {
    const result = await api.withdrawSol(telegramId, amountLamports, toAddress);

    const amt = escapeMarkdown(formatSol(BigInt(result.amountLamports)));
    const addr = escapeMarkdown(formatAddress(result.toAddress));
    const txShort = escapeMarkdown(formatAddress(result.txSignature));

    const msg = [
      `✅ ${bold('Withdrawal Complete')}`,
      ``,
      `${bold('Amount:')} ${amt}`,
      `${bold('To:')} ${code(addr)}`,
      `${bold('tx:')} ${code(txShort)}`,
    ].join('\n');

    await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    const errMsg = err instanceof api.ApiError ? err.body : 'Unknown error';
    await ctx.editMessageText(
      `❌ Withdrawal failed: ${escapeMarkdown(errMsg)}`,
      { parse_mode: 'MarkdownV2' },
    );
  }
}

// ──────────────────────────────────────────────
// Confirm creator earnings claim
// ──────────────────────────────────────────────

async function handleConfirmClaim(ctx: Context, telegramId: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: 'Claiming earnings...' });
  await ctx.editMessageText('⏳ Claiming earnings\\.\\.\\. 💰', { parse_mode: 'MarkdownV2' });

  try {
    const result = await api.claimCreatorEarnings(telegramId);

    const amt = escapeMarkdown(formatSol(BigInt(result.amountLamports)));
    const txShort = escapeMarkdown(formatAddress(result.txSignature));
    const count = escapeMarkdown(result.payoutIds.length.toString());

    const msg = [
      `✅ ${bold('Earnings Claimed\\!')}`,
      ``,
      `${bold('Amount:')} ${amt}`,
      `${bold('Payouts:')} ${count}`,
      `${bold('tx:')} ${code(txShort)}`,
    ].join('\n');

    await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    const errMsg = err instanceof api.ApiError ? err.body : 'Unknown error';
    await ctx.editMessageText(
      `❌ Claim failed: ${escapeMarkdown(errMsg)}`,
      { parse_mode: 'MarkdownV2' },
    );
  }
}

// ──────────────────────────────────────────────
// Pagination
// ──────────────────────────────────────────────

async function handlePagination(ctx: Context, data: string): Promise<void> {
  // data = page:command:pageNum
  const parts = data.split(':');
  if (parts.length < 3) {
    await ctx.answerCallbackQuery({ text: 'Invalid pagination' });
    return;
  }

  const command = parts[1];
  const page = parseInt(parts[2], 10);

  if (isNaN(page) || page < 1) {
    await ctx.answerCallbackQuery({ text: 'Invalid page number' });
    return;
  }

  await ctx.answerCallbackQuery();

  // Delete the old message and send a new one for clean pagination
  try {
    await ctx.deleteMessage();
  } catch {
    // Ignore if can't delete (e.g., message too old)
  }

  switch (command) {
    case 'listed':
      await showListedPage(ctx, page);
      break;
    default:
      await ctx.reply(`⚠️ Unknown page command: ${escapeMarkdown(command)}`, {
        parse_mode: 'MarkdownV2',
      });
  }
}
