#!/usr/bin/env bash
# ──────────────────────────────────────────────
# SCALE PROTOCOL — pool wallet key installer (Solana)
#
# Installs PROTOCOL_WALLET_PRIVATE_KEY on the Railway `api` and
# `workers` services WITHOUT the key ever appearing on screen, in
# shell history, or in any chat/log. Run from the repo root:
#
#   bash scripts/install-solana-key.sh
#
# It will prompt for the key (typing is hidden), validate it, show
# you ONLY the derived public address to confirm, then set it.
# ──────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."

command -v railway >/dev/null || { echo "railway CLI not found — brew install railway"; exit 1; }

# 1. Read key with echo off — nothing is displayed
printf "Paste the Solana secret key (base58, e.g. Phantom export, or solana-keygen JSON array — input is hidden): "
read -rs KEY
printf "\n"

KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"

if [[ "$KEY" == 0x* ]]; then
  echo "That looks like an EVM hex key — SCALE runs on Solana now. Export the base58 secret key instead." >&2
  exit 1
fi

# 2. Derive the public address locally (never prints the secret).
#    Run from packages/solana so deps resolve in the pnpm workspace.
ADDR=$(printf '%s' "$KEY" | (cd packages/solana && node -e '
  const { Keypair } = require("@solana/web3.js");
  const bs58 = require("bs58").default ?? require("bs58");
  let raw = require("fs").readFileSync(0, "utf8").trim();
  const secret = raw.startsWith("[")
    ? Uint8Array.from(JSON.parse(raw))
    : bs58.decode(raw);
  process.stdout.write(Keypair.fromSecretKey(secret).publicKey.toBase58());
')) || { echo "Invalid Solana secret key" >&2; exit 1; }

echo "Derived pool wallet address: $ADDR"
read -rp "Install this key on Railway api + workers? [y/N] " OK
[[ "$OK" == "y" || "$OK" == "Y" ]] || { echo "Aborted."; exit 1; }

# 3. Set on both services + the public address for read-only paths
railway variables --service api     --set "PROTOCOL_WALLET_PRIVATE_KEY=$KEY" --set "PROTOCOL_WALLET=$ADDR" --skip-deploys
railway variables --service workers --set "PROTOCOL_WALLET_PRIVATE_KEY=$KEY" --set "PROTOCOL_WALLET=$ADDR" --skip-deploys

echo "Done. Redeploy api + workers for the key to take effect."
