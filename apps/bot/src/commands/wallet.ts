// ──────────────────────────────────────────────
// LOADED PROTOCOL — /wallet, /deposit, /withdraw, /balance
// ──────────────────────────────────────────────

import type { CommandContext, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { isEvmAddress, parseEthToWei } from '@loaded/core';
import * as api from '../lib/api.js';
import { bold, code, escapeMarkdown, formatAddress, formatEth, formatUsd } from '../lib/format.js';

/**
 * /wallet — show wallet address and ETH balance
 */
export async function handleWallet(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const wallet = await api.getOrCreateWallet(telegramId);
    const balance = await api.getBalance(telegramId);

    const addr = escapeMarkdown(wallet.walletAddress);
    const eth = escapeMarkdown(formatEth(BigInt(balance.ethWei)));
    const ape = escapeMarkdown(balance.apeBalance.toLocaleString('en-US'));

    const msg = [
      `💰 ${bold('Your Wallet')}`,
      ``,
      `${bold('Address:')} ${code(addr)}`,
      `${bold('ETH Balance:')} ${eth}`,
      `${bold('\\$LOADED Balance:')} ${escapeMarkdown(ape)} \\$LOADED`,
      ``,
      `Use /deposit to fund your wallet`,
      `Use /withdraw to send ETH out`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/wallet] error:', err);
    await ctx.reply('⚠️ Could not fetch wallet info\\. Try again later\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /deposit — show deposit address in copy-friendly format
 */
export async function handleDeposit(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const wallet = await api.getOrCreateWallet(telegramId);
    const addr = escapeMarkdown(wallet.walletAddress);

    const msg = [
      `📥 ${bold('Deposit ETH')}`,
      ``,
      `Send ETH to the address below:`,
      ``,
      code(addr),
      ``,
      `⚡ Deposits are detected automatically`,
      `⏱ Confirmation takes ~30 seconds`,
      `💡 Min deposit: 0\\.001 ETH`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/deposit] error:', err);
    await ctx.reply('⚠️ Could not fetch your deposit address\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /withdraw <amount> <address> — confirm and execute withdrawal
 */
export async function handleWithdraw(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const text = ctx.message?.text ?? '';
  const parts = text.split(/\s+/).slice(1); // strip /withdraw

  if (parts.length < 2) {
    await ctx.reply(
      [
        `⚠️ ${bold('Usage:')} /withdraw \\<amount\\> \\<address\\>`,
        ``,
        `Example: ${code('/withdraw 0.5 7xKs3fDabcdef...')}`,
        `Amount is in ETH\\.`,
      ].join('\n'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  const amountStr = parts[0];
  const toAddress = parts[1];
  const amountEth = parseFloat(amountStr);

  if (isNaN(amountEth) || amountEth <= 0) {
    await ctx.reply('⚠️ Invalid amount\\. Please enter a positive ETH value\\.', {
      parse_mode: 'MarkdownV2',
    });
    return;
  }

  if (!isEvmAddress(toAddress)) {
    await ctx.reply('⚠️ Invalid Robinhood Chain address\\. Expected `0x` followed by 40 hex characters\\.', {
      parse_mode: 'MarkdownV2',
    });
    return;
  }

  // 1e18, not 1e9 — wei, not lamports. Parsed from the string because
  // amountEth * 1e18 exceeds Number's safe integer range and loses precision.
  const amountWeiBig = parseEthToWei(amountStr);
  if (amountWeiBig === null || amountWeiBig <= 0n) {
    await ctx.reply('⚠️ Invalid amount\\. Use a plain decimal with at most 18 decimal places\\.', {
      parse_mode: 'MarkdownV2',
    });
    return;
  }
  const amountWei = amountWeiBig.toString();
  const escapedAmt = escapeMarkdown(amountEth.toString());
  const escapedAddr = escapeMarkdown(formatAddress(toAddress));

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm', `confirm_withdraw:${amountWei}:${toAddress}`)
    .text('❌ Cancel', 'cancel_withdraw');

  const msg = [
    `📤 ${bold('Confirm Withdrawal')}`,
    ``,
    `${bold('Amount:')} ${escapedAmt} ETH`,
    `${bold('To:')} ${code(escapeMarkdown(toAddress))}`,
    ``,
    `⚠️ This action is irreversible\\.`,
  ].join('\n');

  await ctx.reply(msg, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
}

/**
 * /balance — show ETH + $LOADED balance
 */
export async function handleBalance(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const balance = await api.getBalance(telegramId);
    const eth = escapeMarkdown(formatEth(BigInt(balance.ethWei)));
    const ape = escapeMarkdown(balance.apeBalance.toLocaleString('en-US'));

    const msg = [
      `💎 ${bold('Balances')}`,
      ``,
      `${bold('ETH:')} ${eth}`,
      `${bold('\\$LOADED:')} ${ape}`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/balance] error:', err);
    await ctx.reply('⚠️ Could not fetch balances\\. Try again later\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}
