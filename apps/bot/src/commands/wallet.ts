// ──────────────────────────────────────────────
// FRONT PROTOCOL — /wallet, /deposit, /withdraw, /balance
// ──────────────────────────────────────────────

import type { CommandContext, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import * as api from '../lib/api.js';
import { bold, code, escapeMarkdown, formatAddress, formatSol, formatUsd } from '../lib/format.js';

/**
 * /wallet — show wallet address and SOL balance
 */
export async function handleWallet(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const wallet = await api.getOrCreateWallet(telegramId);
    const balance = await api.getBalance(telegramId);

    const addr = escapeMarkdown(wallet.walletAddress);
    const sol = escapeMarkdown(formatSol(BigInt(balance.solLamports)));
    const ape = escapeMarkdown(balance.apeBalance.toLocaleString('en-US'));

    const msg = [
      `💰 ${bold('Your Wallet')}`,
      ``,
      `${bold('Address:')} ${code(addr)}`,
      `${bold('SOL Balance:')} ${sol}`,
      `${bold('\\$APE Balance:')} ${escapeMarkdown(ape)} \\$APE`,
      ``,
      `Use /deposit to fund your wallet`,
      `Use /withdraw to send SOL out`,
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
      `📥 ${bold('Deposit SOL')}`,
      ``,
      `Send SOL to the address below:`,
      ``,
      code(addr),
      ``,
      `⚡ Deposits are detected automatically`,
      `⏱ Confirmation takes ~30 seconds`,
      `💡 Min deposit: 0\\.001 SOL`,
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
        `Amount is in SOL\\.`,
      ].join('\n'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  const amountStr = parts[0];
  const toAddress = parts[1];
  const amountSol = parseFloat(amountStr);

  if (isNaN(amountSol) || amountSol <= 0) {
    await ctx.reply('⚠️ Invalid amount\\. Please enter a positive SOL value\\.', {
      parse_mode: 'MarkdownV2',
    });
    return;
  }

  if (toAddress.length < 32 || toAddress.length > 44) {
    await ctx.reply('⚠️ Invalid Solana address\\.', { parse_mode: 'MarkdownV2' });
    return;
  }

  const amountLamports = Math.round(amountSol * 1e9).toString();
  const escapedAmt = escapeMarkdown(amountSol.toString());
  const escapedAddr = escapeMarkdown(formatAddress(toAddress));

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm', `confirm_withdraw:${amountLamports}:${toAddress}`)
    .text('❌ Cancel', 'cancel_withdraw');

  const msg = [
    `📤 ${bold('Confirm Withdrawal')}`,
    ``,
    `${bold('Amount:')} ${escapedAmt} SOL`,
    `${bold('To:')} ${code(escapeMarkdown(toAddress))}`,
    ``,
    `⚠️ This action is irreversible\\.`,
  ].join('\n');

  await ctx.reply(msg, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
}

/**
 * /balance — show SOL + $APE balance
 */
export async function handleBalance(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const balance = await api.getBalance(telegramId);
    const sol = escapeMarkdown(formatSol(BigInt(balance.solLamports)));
    const ape = escapeMarkdown(balance.apeBalance.toLocaleString('en-US'));

    const msg = [
      `💎 ${bold('Balances')}`,
      ``,
      `${bold('SOL:')} ${sol}`,
      `${bold('\\$APE:')} ${ape}`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/balance] error:', err);
    await ctx.reply('⚠️ Could not fetch balances\\. Try again later\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}
