#!/usr/bin/env bash
set -euo pipefail
feature=srremy31J5Y25FrAApwVb9kZcfXbusYMMsvTK9aWv5q
rpc=http://127.0.0.1:18899
scratch=$(mktemp -d)
validator_pid=
cleanup() {
  if [[ -n "$validator_pid" ]]; then
    kill "$validator_pid" 2>/dev/null || true
    wait "$validator_pid" 2>/dev/null || true
  fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT
solana-test-validator --ledger "$scratch/ledger" --bind-address 127.0.0.1 \
  --rpc-port 18899 --faucet-port 18901 --gossip-port 18902 \
  --dynamic-port-range 19000-19100 --quiet > "$scratch/validator.log" 2>&1 &
validator_pid=$!
ready=false
for attempt in {1..40}; do
  if ! kill -0 "$validator_pid" 2>/dev/null; then
    cat "$scratch/validator.log"
    exit 1
  fi
  if solana --url "$rpc" slot > /dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  cat "$scratch/validator.log"
  exit 1
fi
solana --url "$rpc" feature status "$feature" > "$scratch/feature.txt"
cat "$scratch/feature.txt"
grep -Eq "^${feature}[[:space:]]*\|[[:space:]]*active since epoch [0-9]+[[:space:]]*\|" "$scratch/feature.txt"
