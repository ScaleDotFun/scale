#!/usr/bin/env bash
# ──────────────────────────────────────────────
# LOADED PROTOCOL — pool wallet key installer (Robinhood Chain / EVM)
#
# Installs PROTOCOL_WALLET_PRIVATE_KEY into Railway without the key ever
# appearing on screen, in your shell history, or in a file.
#
#   bash scripts/install-pool-key.sh
# ──────────────────────────────────────────────
set -euo pipefail

command -v railway >/dev/null || { echo "railway CLI not found" >&2; exit 1; }

printf "Paste the EVM private key (0x + 64 hex chars — input is hidden): "
stty -echo; read -r KEY; stty echo; printf "\n"

KEY="${KEY#"${KEY%%[![:space:]]*}"}"; KEY="${KEY%"${KEY##*[![:space:]]}"}"
[ -n "$KEY" ] || { echo "No key entered." >&2; exit 1; }
case "$KEY" in
  \[*) echo "That looks like a JSON-array secret key. LOADED runs on Robinhood Chain — paste an EVM hex key (0x…)." >&2; exit 1 ;;
esac
[ "${KEY#0x}" != "$KEY" ] || KEY="0x$KEY"
printf '%s' "$KEY" | grep -Eq '^0x[0-9a-fA-F]{64}$' \
  || { echo "Not a 32-byte hex key (expected 0x + 64 hex chars)." >&2; exit 1; }

# Derive the address locally so we can show WHICH wallet was installed
# without ever printing the key itself.
ADDR=$(printf '%s' "$KEY" | (cd packages/evm && node -e '
  const { privateKeyToAccount } = require("viem/accounts");
  let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => {
    process.stdout.write(privateKeyToAccount(d.trim()).address);
  });
')) || { echo "Invalid EVM private key" >&2; exit 1; }

for SVC in api workers; do
  printf '%s' "$KEY" | railway variable set PROTOCOL_WALLET_PRIVATE_KEY --stdin --service "$SVC" --skip-deploys >/dev/null
  railway variable set "PROTOCOL_WALLET=$ADDR" --service "$SVC" --skip-deploys >/dev/null
  echo "installed on $SVC"
done
unset KEY
echo "Pool wallet → $ADDR"
echo "Redeploy both services for the change to take effect."
