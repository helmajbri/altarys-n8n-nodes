#!/usr/bin/env bash
# Runs the contract suite on a Docker host against a throwaway stack: a real n8n (official image,
# unmodified) with both packages loaded from a custom-extensions folder, and the fake LetzBill and
# LetzCloud servers. Every container, volume and network is named with one per-run prefix and all
# of them are removed on exit, failure and interruption included.
#
# Usage: N8N_IMAGE=<ref@digest> NODE_IMAGE=<ref@digest> contract/run-docker.sh [mutation]
#   mutation: none (default) | no-signature-check | no-delete | no-activation-dedupe
#   PACKAGE_SOURCE=tree (default: build this checkout) | npm (install NPM_SPECS from npm)
set -euo pipefail

: "${N8N_IMAGE:?not configured: set N8N_IMAGE to the pinned n8n image reference}"
: "${NODE_IMAGE:?not configured: set NODE_IMAGE to the pinned Node.js image reference}"
MUTATION="${1:-none}"
PACKAGE_SOURCE="${PACKAGE_SOURCE:-tree}"
if [ "$PACKAGE_SOURCE" = npm ]; then
  : "${NPM_SPECS:?not configured: set NPM_SPECS, e.g. '<package>@<version> <package>@<version>'}"
  [ "$MUTATION" = none ] || { echo "a mutation needs PACKAGE_SOURCE=tree"; exit 2; }
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P="${CONTRACT_PREFIX:-aut-t11-$(date +%s)-}"
NET="${P}net"
LOG_DIR="${LOG_DIR:-$ROOT/contract-logs}"
mkdir -p "$LOG_DIR"

listing() {
  echo "--- resources with prefix $P ($1)"
  docker ps -a --format '{{.Names}}' | grep "^$P" | sed 's/^/container /' || true
  docker volume ls --format '{{.Name}}' | grep "^$P" | sed 's/^/volume /' || true
  docker network ls --format '{{.Name}}' | grep "^$P" | sed 's/^/network /' || true
  echo "--- count: $( { docker ps -a --format '{{.Names}}'; docker volume ls --format '{{.Name}}'; docker network ls --format '{{.Name}}'; } | grep -c "^$P" || true)"
}

cleanup() {
  status=$?
  set +e
  docker logs "${P}n8n" > "$LOG_DIR/n8n.log" 2>&1
  docker logs "${P}fake" > "$LOG_DIR/fake.log" 2>&1
  listing "before teardown"
  # Only names that start with this run's prefix are removed.
  docker ps -a --format '{{.Names}}' | grep "^$P" | xargs -r docker rm -f -v > /dev/null
  docker volume ls --format '{{.Name}}' | grep "^$P" | xargs -r docker volume rm > /dev/null
  docker network ls --format '{{.Name}}' | grep "^$P" | xargs -r docker network rm > /dev/null
  listing "after teardown"
  exit "$status"
}
trap cleanup EXIT INT TERM HUP

rnd() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
LETZBILL_KEY="fb_$(rnd)"
PROVIDER_KEY="lc_provider_$(rnd)"
CUSTOMER_KEY="lc_customer_$(rnd)"
OWNER_PASSWORD="Contract1$(rnd)"
ENCRYPTION_KEY="$(rnd)"
VECTORS_SHA256=1910a28ed1ea338402bec8ca8bb977e906cf871946d8607f0b956e19defb48ac

docker network create "$NET" > /dev/null
for v in work ext tls ca n8n-data state; do docker volume create "${P}$v" > /dev/null; done
listing "during the run"

echo "=== build ($PACKAGE_SOURCE, mutation $MUTATION)"
docker run --rm --name "${P}build" -v "$ROOT:/src:ro" -v "${P}work:/work" -v "${P}ext:/ext" -v "${P}tls:/tls" \
  -v "${P}ca:/ca" -v "${P}n8n-data:/n8n-data" -v "${P}state:/state" \
  -e MUTATION="$MUTATION" -e PACKAGE_SOURCE="$PACKAGE_SOURCE" -e NPM_SPECS="${NPM_SPECS:-}" -e P="$P" \
  --entrypoint bash "$NODE_IMAGE" -c '
set -euo pipefail
cp -a /src/. /work/
cd /work
if [ "$PACKAGE_SOURCE" = tree ]; then
  [ "$MUTATION" = none ] || node contract/mutate.mjs "$MUTATION" /work
  mkdir -p /tmp/packs
  for pkg in letzbill letzcloud; do
    (cd "packages/$pkg" && { npm ci --no-audit --no-fund && npm run build && npm pack --pack-destination /tmp/packs; } > /tmp/build-$pkg.log 2>&1) || { tail -40 /tmp/build-$pkg.log; echo "BUILD FAILED: $pkg"; exit 1; }
  done
  specs=$(ls /tmp/packs/*.tgz)
else
  specs="$NPM_SPECS"
fi
# Same layout the lab install uses: no peer resolution, no install scripts.
npm install --prefix /ext --legacy-peer-deps --ignore-scripts --no-audit --no-fund --package-lock=false $specs > /dev/null
ls /ext/node_modules/@altarys
cd /tls
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 2 -subj "/CN=contract-suite-ca" 2> /dev/null
openssl req -newkey rsa:2048 -nodes -keyout tls.key -out tls.csr -subj "/CN=${P}n8n" 2> /dev/null
printf "subjectAltName=DNS:${P}n8n,DNS:${P}fake\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n" > ext.cnf
openssl x509 -req -in tls.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out tls.crt -days 2 -extfile ext.cnf 2> /dev/null
rm ca.key tls.csr && chmod 644 tls.key
cp ca.crt /ca/contract-ca.crt
chown -R 1000:1000 /ca /n8n-data
'

echo "=== fake servers"
docker run -d --name "${P}fake" --network "$NET" -v "${P}work:/work:ro" -v "${P}tls:/tls:ro" \
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
  docker run -d --name "${P}n8n" --network "$NET" --memory 2g \
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

node_in_net() { # name, then node arguments
  local name="$1"; shift
  docker run --rm --name "${P}$name" --network "$NET" -v "${P}work:/work:ro" -v "${P}tls:/tls:ro" -v "${P}state:/state" \
    -w /work -e NODE_EXTRA_CA_CERTS=/tls/ca.crt "${SUITE_ENV[@]}" --entrypoint node "$NODE_IMAGE" "$@"
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

echo "=== bootstrap n8n owner and API key"
node_in_net boot contract/bootstrap-n8n.mjs

set +e
echo "=== phase 1: default settings"
node_in_net suite1 --test --test-concurrency=1 --test-reporter=tap contract/test/01-default-activation.test.mjs | tee "$LOG_DIR/phase1.tap"
# Same data, n8n stopped and started with the workflow publication service off: that start path
# activates every published workflow and asks each trigger whether its subscription exists.
echo "=== restart n8n with N8N_USE_WORKFLOW_PUBLICATION_SERVICE=false"
docker stop "${P}n8n" > /dev/null
docker logs "${P}n8n" > "$LOG_DIR/n8n-phase1.log" 2>&1
docker rm -v "${P}n8n" > /dev/null
start_n8n -e N8N_USE_WORKFLOW_PUBLICATION_SERVICE=false
node_in_net wait contract/bootstrap-n8n.mjs --wait-only
echo "=== phase 2: activation at start"
node_in_net suite2 --test --test-concurrency=1 --test-reporter=tap contract/test/02-start-activation.test.mjs | tee "$LOG_DIR/phase2.tap"
set -e

echo "=== summary (mutation $MUTATION, source $PACKAGE_SOURCE)"
cat "$LOG_DIR"/phase1.tap "$LOG_DIR"/phase2.tap > "$LOG_DIR/all.tap"
failed_total=0
for t in letzbill letzcloud-provider letzcloud-customer; do
  pass=$(grep -cE "^ *ok [0-9]+ - $t:" "$LOG_DIR/all.tap" || true)
  fail=$(grep -cE "^ *not ok [0-9]+ - $t:" "$LOG_DIR/all.tap" || true)
  echo "$t: $pass passed, $fail failed"
  failed_total=$((failed_total + fail))
done
other_fail=$(grep -E "^ *not ok [0-9]+ - " "$LOG_DIR/all.tap" | grep -cvE " - (letzbill|letzcloud-provider|letzcloud-customer):" || true)
failed_total=$((failed_total + other_fail))
grep -E "^ *not ok [0-9]+ - " "$LOG_DIR/all.tap" | sed 's/^ */FAILED: /' || true
total=$(grep -cE "^ *(not )?ok [0-9]+ - " "$LOG_DIR/all.tap" || true)
echo "tests reported: $total, failed: $failed_total"
[ "$total" -gt 0 ] || { echo "SUITE RESULT: NO TESTS RAN"; exit 1; }
if [ "$failed_total" -eq 0 ]; then echo "SUITE RESULT: PASS"; else echo "SUITE RESULT: FAIL"; exit 1; fi
