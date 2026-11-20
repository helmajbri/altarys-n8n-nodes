#!/usr/bin/env bash
# Runs the contract suite on a Docker host against a throwaway stack: a real n8n (official image,
# unmodified) with both packages loaded from a custom-extensions folder, and the fake LetzBill and
# LetzCloud servers. Every container, volume and network carries one per-run label and all of
# them are removed by that label on exit, failure and interruption included.
#
# Usage: N8N_IMAGE=<ref@digest> NODE_IMAGE=<ref@digest> EXPECT_N8N_VERSION=<x.y.z> \
#          contract/run-docker.sh [mutation]
#   mutation: none (default) | no-signature-check | no-delete | no-activation-dedupe
#   PACKAGE_SOURCE=tree (default: build this checkout) | npm (install NPM_SPECS from npm)
#   HARNESS_RED=skip-phase2: red control of this script's own tally (phase 2 never starts)
set -euo pipefail

: "${N8N_IMAGE:?not configured: set N8N_IMAGE to the pinned n8n image reference}"
: "${NODE_IMAGE:?not configured: set NODE_IMAGE to the pinned Node.js image reference}"
: "${EXPECT_N8N_VERSION:?not configured: set EXPECT_N8N_VERSION to the version the n8n image must report}"
MUTATION="${1:-none}"
PACKAGE_SOURCE="${PACKAGE_SOURCE:-tree}"
HARNESS_RED="${HARNESS_RED:-}"
if [ "$PACKAGE_SOURCE" = npm ]; then
  : "${NPM_SPECS:?not configured: set NPM_SPECS, e.g. '<package>@<version> <package>@<version>'}"
  [ "$MUTATION" = none ] || { echo "a mutation needs PACKAGE_SOURCE=tree"; exit 2; }
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rnd() { head -c "${1:-24}" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
# The label, not the name, decides what teardown removes: a random id per run, so two runs never
# select each other's resources whatever their names are. The name prefix is for reading only.
RUN_ID="$(rnd 16)"
LABEL="aut-t11.run=$RUN_ID"
P="${CONTRACT_PREFIX:-aut-t11-$(date +%s)-$(rnd 3)-}"
NET="${P}net"
LOG_DIR="${LOG_DIR:-$ROOT/contract-logs}"
mkdir -p "$LOG_DIR"
echo "=== run $P label $LABEL"

listing() {
  echo "--- resources with label $LABEL ($1)"
  docker ps -a --filter "label=$LABEL" --format 'container {{.Names}}'
  docker volume ls --filter "label=$LABEL" --format 'volume {{.Name}}'
  docker network ls --filter "label=$LABEL" --format 'network {{.Name}}'
  local n
  n=$( { docker ps -aq --filter "label=$LABEL"; docker volume ls -q --filter "label=$LABEL"; docker network ls -q --filter "label=$LABEL"; } | grep -c . || true)
  echo "--- count: $n"
}

cleanup() {
  status=$?
  set +e
  docker logs "${P}n8n" > "$LOG_DIR/n8n.log" 2>&1
  docker logs "${P}fake" > "$LOG_DIR/fake.log" 2>&1
  listing "before teardown"
  docker ps -aq --filter "label=$LABEL" | xargs -r docker rm -f -v > /dev/null
  docker volume ls -q --filter "label=$LABEL" | xargs -r docker volume rm > /dev/null
  docker network ls -q --filter "label=$LABEL" | xargs -r docker network rm > /dev/null
  listing "after teardown"
  exit "$status"
}
trap cleanup EXIT INT TERM HUP

LETZBILL_KEY="fb_$(rnd)"
PROVIDER_KEY="lc_provider_$(rnd)"
CUSTOMER_KEY="lc_customer_$(rnd)"
OWNER_PASSWORD="Contract1$(rnd)"
ENCRYPTION_KEY="$(rnd)"
VECTORS_SHA256=1910a28ed1ea338402bec8ca8bb977e906cf871946d8607f0b956e19defb48ac

docker network create --label "$LABEL" "$NET" > /dev/null
for v in work ext tls ca n8n-data state; do docker volume create --label "$LABEL" "${P}$v" > /dev/null; done

echo "=== n8n image reports its version"
got_version="$(docker run --rm --label "$LABEL" --entrypoint n8n "$N8N_IMAGE" --version | tr -d '\r' | tail -1)"
echo "n8n --version: $got_version (expected $EXPECT_N8N_VERSION)"
if [ "$got_version" != "$EXPECT_N8N_VERSION" ]; then echo "SUITE RESULT: FAIL (n8n version)"; exit 1; fi

echo "=== build ($PACKAGE_SOURCE, mutation $MUTATION)"
docker run --rm --label "$LABEL" --name "${P}build" -v "$ROOT:/src:ro" -v "${P}work:/work" -v "${P}ext:/ext" \
  -v "${P}tls:/tls" -v "${P}ca:/ca" -v "${P}n8n-data:/n8n-data" -v "${P}state:/state" \
  -e MUTATION="$MUTATION" -e PACKAGE_SOURCE="$PACKAGE_SOURCE" -e NPM_SPECS="${NPM_SPECS:-}" -e P="$P" \
  --entrypoint bash "$NODE_IMAGE" /src/contract/build-stack.sh

echo "=== fake servers"
docker run -d --label "$LABEL" --name "${P}fake" --network "$NET" -v "${P}work:/work:ro" -v "${P}tls:/tls:ro" \
  -e FAKE_TLS_KEY=/tls/tls.key -e FAKE_TLS_CERT=/tls/tls.crt -e FAKE_CA_FILE=/tls/ca.crt \
  -e FAKE_LETZBILL_PORT=8443 -e FAKE_LETZCLOUD_PORT=9443 -e FAKE_CONTROL_PORT=8080 \
  -e FAKE_LETZBILL_KEY="$LETZBILL_KEY" -e FAKE_LETZCLOUD_PROVIDER_KEY="$PROVIDER_KEY" \
  -e FAKE_LETZCLOUD_CUSTOMER_KEY="$CUSTOMER_KEY" \
  -e FAKE_LETZBILL_EVENT_TYPES=invoice.paid -e FAKE_LETZCLOUD_EVENT_TYPES=instance.created \
  -e FAKE_VECTORS_FILE=/work/packages/letzbill/test/fixtures/webhook_signature_v2_vectors.json \
  -e FAKE_VECTORS_SHA256="$VECTORS_SHA256" \
  --memory 256m --entrypoint node "$NODE_IMAGE" /work/contract/fake/server.mjs > /dev/null

# Start n8n; extra arguments are passed to docker run (e.g. -e settings).
start_n8n() {
  docker run -d --label "$LABEL" --name "${P}n8n" --network "$NET" --memory 2g \
    -v "${P}ext:/ext:ro" -v "${P}tls:/tls:ro" -v "${P}ca:/opt/custom-certificates" -v "${P}n8n-data:/home/node/.n8n" \
    -e N8N_PROTOCOL=https -e N8N_SSL_KEY=/tls/tls.key -e N8N_SSL_CERT=/tls/tls.crt \
    -e N8N_HOST="${P}n8n" -e N8N_PORT=5678 -e N8N_WEBHOOK_URL="https://${P}n8n:5678/" \
    -e N8N_CUSTOM_EXTENSIONS=/ext -e N8N_COMMUNITY_PACKAGES_ENABLED=false \
    -e N8N_DIAGNOSTICS_ENABLED=false -e N8N_DISABLED_MODULES=mcp -e N8N_ENCRYPTION_KEY="$ENCRYPTION_KEY" \
    -e N8N_WORKFLOW_PUBLICATION_OUTBOX_POLL_INTERVAL_MS=1000 \
    "$@" "$N8N_IMAGE" > /dev/null
}
echo "=== n8n ($N8N_IMAGE), default settings"
start_n8n
listing "during the run"

node_in_net() { # name, then node arguments
  local name="$1"; shift
  docker run --rm --label "$LABEL" --name "${P}$name" --network "$NET" -v "${P}work:/work:ro" -v "${P}tls:/tls:ro" \
    -v "${P}state:/state" -w /work -e NODE_EXTRA_CA_CERTS=/tls/ca.crt "${SUITE_ENV[@]}" --entrypoint node "$NODE_IMAGE" "$@"
}
SUITE_ENV=(
  -e BOOT_N8N_URL="https://${P}n8n:5678" -e BOOT_OWNER_EMAIL=contract@example.com
  -e BOOT_OWNER_PASSWORD="$OWNER_PASSWORD" -e BOOT_KEY_FILE=/state/n8n-api-key
  -e CONTRACT_RUN_ID="$P" -e CONTRACT_STATE_FILE=/state/state.json
  -e CONTRACT_SETTLE_MS="${CONTRACT_SETTLE_MS:-5000}" -e CONTRACT_TIMEOUT_MS="${CONTRACT_TIMEOUT_MS:-90000}"
  -e CONTRACT_DRIVER_URL="http://${P}fake:8080"
  -e CONTRACT_N8N_URL="https://${P}n8n:5678" -e CONTRACT_N8N_API_KEY_FILE=/state/n8n-api-key
  -e CONTRACT_TARGETS=letzbill,letzcloud-provider,letzcloud-customer
  -e CONTRACT_LETZBILL_URL="https://${P}fake:8443" -e CONTRACT_LETZBILL_KEY="$LETZBILL_KEY"
  -e CONTRACT_LETZBILL_EVENT_TYPE=invoice.paid -e CONTRACT_LETZBILL_TRIGGER_TYPE=CUSTOM.letzBillTrigger
  -e CONTRACT_LETZCLOUD_URL="https://${P}fake:9443" -e CONTRACT_LETZCLOUD_PROVIDER_KEY="$PROVIDER_KEY"
  -e CONTRACT_LETZCLOUD_CUSTOMER_KEY="$CUSTOMER_KEY"
  -e CONTRACT_LETZCLOUD_EVENT_TYPE=instance.created -e CONTRACT_LETZCLOUD_TRIGGER_TYPE=CUSTOM.letzCloudTrigger
)
TARGETS=(letzbill letzcloud-provider letzcloud-customer)

echo "=== bootstrap n8n owner and API key"
node_in_net boot contract/bootstrap-n8n.mjs

set +e
: > "$LOG_DIR/phase1.tap"
: > "$LOG_DIR/phase2.tap"
echo "=== phase 1: default settings"
node_in_net suite1 --test --test-concurrency=1 --test-reporter=tap contract/test/01-default-activation.test.mjs | tee "$LOG_DIR/phase1.tap"
if [ "$HARNESS_RED" = skip-phase2 ]; then
  echo "=== HARNESS_RED=skip-phase2: phase 2 is not started"
else
  # Same data, n8n stopped and started with the workflow publication service off: that start
  # path activates every published workflow and asks each trigger whether its subscription exists.
  echo "=== restart n8n with N8N_USE_WORKFLOW_PUBLICATION_SERVICE=false"
  docker stop "${P}n8n" > /dev/null
  docker logs "${P}n8n" > "$LOG_DIR/n8n-phase1.log" 2>&1
  docker rm -v "${P}n8n" > /dev/null
  start_n8n -e N8N_USE_WORKFLOW_PUBLICATION_SERVICE=false
  node_in_net wait contract/bootstrap-n8n.mjs --wait-only
  echo "=== phase 2: activation at start"
  node_in_net suite2 --test --test-concurrency=1 --test-reporter=tap contract/test/02-start-activation.test.mjs | tee "$LOG_DIR/phase2.tap"
fi
set -e

# The tally wants the exact number of tests per phase and per target: a phase that did not run,
# stopped early or lost a test fails the run, not only a test that reported "not ok".
PHASE1_PER_TARGET=12
PHASE2_PER_TARGET=2
PHASE1_EXPECTED=$(( PHASE1_PER_TARGET * ${#TARGETS[@]} + 1 ))
PHASE2_EXPECTED=$(( PHASE2_PER_TARGET * ${#TARGETS[@]} + 1 ))
PER_TARGET_EXPECTED=$(( PHASE1_PER_TARGET + PHASE2_PER_TARGET ))
TOTAL_EXPECTED=$(( PHASE1_EXPECTED + PHASE2_EXPECTED ))
top() { grep -E "^(not )?ok [0-9]+ - " "$1" || true; }

echo "=== summary (mutation $MUTATION, source $PACKAGE_SOURCE)"
problems=0
for phase in 1 2; do
  if [ "$phase" = 1 ]; then expected=$PHASE1_EXPECTED; else expected=$PHASE2_EXPECTED; fi
  got=$(top "$LOG_DIR/phase$phase.tap" | grep -c . || true)
  echo "phase $phase: $got tests reported, $expected expected"
  if [ "$got" -ne "$expected" ]; then echo "PROBLEM: phase $phase reported $got of $expected tests"; problems=$((problems + 1)); fi
done
cat "$LOG_DIR"/phase1.tap "$LOG_DIR"/phase2.tap > "$LOG_DIR/all.tap"
for t in "${TARGETS[@]}"; do
  pass=$(top "$LOG_DIR/all.tap" | grep -cE "^ok [0-9]+ - $t:" || true)
  fail=$(top "$LOG_DIR/all.tap" | grep -cE "^not ok [0-9]+ - $t:" || true)
  echo "$t: $pass passed, $fail failed, $PER_TARGET_EXPECTED expected"
  if [ "$pass" -ne "$PER_TARGET_EXPECTED" ] || [ "$fail" -ne 0 ]; then problems=$((problems + 1)); fi
done
failed=$(top "$LOG_DIR/all.tap" | grep -c "^not ok" || true)
top "$LOG_DIR/all.tap" | grep "^not ok" | sed 's/^/FAILED: /' || true
total=$(top "$LOG_DIR/all.tap" | grep -c . || true)
echo "tests reported: $total of $TOTAL_EXPECTED, failed: $failed"
if [ "$failed" -ne 0 ] || [ "$total" -ne "$TOTAL_EXPECTED" ]; then problems=$((problems + 1)); fi
if [ "$problems" -eq 0 ]; then echo "SUITE RESULT: PASS"; else echo "SUITE RESULT: FAIL"; exit 1; fi
