#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p target
umask 077
if [[ ! -e target/local-test-keypair.json ]]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile target/local-test-keypair.json
fi
echo 'Local test wallet ready. Anchor supplies local genesis tokens; no faucet is called.'
