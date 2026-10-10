#!/usr/bin/env bash
# Builds and starts the settlement API on the VPS from a checkout of this repository.
# Usage, from the repository root on the VPS: server/scripts/deploy.sh
# Secrets: /etc/loka-pay/api.env (mode 600, never committed). Keys: /etc/loka-pay/keys (docs/RUNBOOK-KEYS.md).
set -euo pipefail
cd "$(dirname "$0")/../.."
env_file=/etc/loka-pay/api.env
test -f "$env_file" || { echo "Missing $env_file (see server/.env.example)." >&2; exit 1; }
test -z "$(git status --porcelain)" || { echo 'Checkout has local changes; deploy a clean commit.' >&2; exit 1; }
export COMMIT_SHA="$(git rev-parse HEAD)"
install -d -m 700 /var/lib/loka-pay/postgres
compose=(docker compose --env-file "$env_file" -f server/compose.yaml)
# A container started outside compose under the same name would block the new one.
if docker container inspect loka-pay-api >/dev/null 2>&1 \
  && [ -z "$(docker container inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' loka-pay-api)" ]; then
  docker stop --time 30 loka-pay-api >/dev/null
  docker rm loka-pay-api >/dev/null
fi
"${compose[@]}" up -d --build
for _ in $(seq 1 45); do
  if curl --fail --silent http://127.0.0.1:3001/api/health >/dev/null; then
    echo "Sandbox API healthy on loopback at commit $COMMIT_SHA."
    exit 0
  fi
  sleep 2
done
echo 'Sandbox API did not become healthy. Logs: docker logs loka-pay-api' >&2
exit 1
