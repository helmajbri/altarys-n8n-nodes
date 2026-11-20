#!/usr/bin/env bash
# Runs inside the throwaway build container of run-docker.sh: copies the checkout, applies a red
# control if asked, builds and installs both packages into the custom-extensions folder, and
# makes the CA and the TLS certificate for the run. Inputs: MUTATION, PACKAGE_SOURCE, NPM_SPECS, P.
set -euo pipefail
cp -a /src/. /work/
cd /work
if [ "$PACKAGE_SOURCE" = tree ]; then
  [ "$MUTATION" = none ] || node contract/mutate.mjs "$MUTATION" /work
  mkdir -p /tmp/packs
  for pkg in letzbill letzcloud; do
    if ! (cd "packages/$pkg" && { npm ci --no-audit --no-fund && npm run build && npm pack --pack-destination /tmp/packs; } > "/tmp/build-$pkg.log" 2>&1); then
      tail -40 "/tmp/build-$pkg.log"
      echo "BUILD FAILED: $pkg"
      exit 1
    fi
  done
  specs=$(ls /tmp/packs/*.tgz)
else
  specs="$NPM_SPECS"
fi
# Same layout the lab install uses: no peer resolution, no install scripts.
# shellcheck disable=SC2086
npm install --prefix /ext --legacy-peer-deps --ignore-scripts --no-audit --no-fund --package-lock=false $specs > /dev/null
ls /ext/node_modules/@altarys
cd /tls
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 2 -subj "/CN=contract-suite-ca" 2> /dev/null
openssl req -newkey rsa:2048 -nodes -keyout tls.key -out tls.csr -subj "/CN=${P}n8n" 2> /dev/null
printf 'subjectAltName=DNS:%sn8n,DNS:%sfake\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' "$P" "$P" > ext.cnf
openssl x509 -req -in tls.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out tls.crt -days 2 -extfile ext.cnf 2> /dev/null
rm ca.key tls.csr
chmod 644 tls.key
cp ca.crt /ca/contract-ca.crt
chown -R 1000:1000 /ca /n8n-data
