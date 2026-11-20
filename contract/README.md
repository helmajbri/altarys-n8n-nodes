# Contract suite

The unit tests in each package call the trigger code with stand-in n8n functions. This suite runs both triggers inside a real n8n instead, and checks what n8n and the servers actually do:

| Check | How |
|---|---|
| Activating twice leaves one subscription | Publish the workflow and publish it again; unpublish and publish; then restart n8n with `N8N_USE_WORKFLOW_PUBLICATION_SERVICE=false`. After each, the server lists exactly one webhook endpoint for the workflow's webhook URL. Only the restart asks the trigger whether its subscription exists (see below), so only phase 2 is evidence for the trigger's duplicate check. |
| Deactivating removes it | Unpublish the workflow, before and after the restart: the server lists none. |
| A valid delivery makes one workflow item | A delivery signed with signature v2 and the endpoint's secret: exactly one execution, whose trigger output is one item with that event ID. |
| A replayed delivery makes none | The same bytes and headers again: n8n answers, no new execution. |
| A tampered delivery makes none | One hex digit of the signature changed, or the body changed after signing, each with a fresh event ID: n8n answers 401, no new execution. |
| A delivery without signature v2 makes none | The v2 headers removed and a valid v1 signature kept, or a correct v2 signature on a timestamp an hour old, each with a fresh event ID: n8n answers 401, no new execution (signature guide steps 1 and 3). |
| Each call uses the key of its own side | The fake servers refuse a key from another side; the suite fails if any call was refused. |

It runs three targets: the LetzBill Trigger, and the LetzCloud Trigger subscribed as the provider and as a customer.

Why the restart uses that setting: with n8n's default (`true`), publishing an unchanged workflow again changes no trigger, and a start does not call webhook triggers at all, because their registrations are kept in n8n's database. Neither asks the trigger whether its subscription exists. With the setting `false`, a start activates every published workflow and asks each webhook trigger first, without a deactivation before it. That's the case where a trigger that skipped the check would subscribe a second time.

## Layout

- `fake/server.mjs`: fake LetzBill and fake LetzCloud. Only the routes the triggers call (`webhooks/event_types`, `webhooks/endpoints` list, create, delete, and the LetzCloud address check), in the products' response shapes, over HTTPS. A control listener signs and sends deliveries and reports the calls it received. Before it starts, its signer must reproduce the shared signature vectors.
- `lib/signer.mjs`: signature v1 and v2 as a sender computes them, written apart from the packages' verifiers.
- `test/01-default-activation.test.mjs`, `test/02-start-activation.test.mjs`: the two phases, before and after the n8n restart.
- `bootstrap-n8n.mjs`: for a throwaway n8n only, sets up the owner and creates a public API key with the scopes the suite needs.
- `mutate.mjs`: red controls, see below.
- `run-docker.sh`: the whole run on one Docker host; `build-stack.sh` is its build step, run inside the build container.

## Run it

`run-docker.sh` needs Docker and two image references, pinned by digest:

```bash
N8N_IMAGE='n8nio/n8n:2.47.7@sha256:<digest>' NODE_IMAGE='node:24.22.3@sha256:<digest>' EXPECT_N8N_VERSION=2.47.7 contract/run-docker.sh
```

It first checks that `n8n --version` in the image prints `EXPECT_N8N_VERSION`. It then creates a network, the volumes and the containers, all with one label `aut-t11.run=<random id>` and names under a prefix (`aut-t11-<epoch>-<random>-` unless `CONTRACT_PREFIX` is set), builds both packages from this checkout, installs them into a custom-extensions folder the way `npm install --legacy-peer-deps --ignore-scripts` lays them out, and starts the official n8n image unchanged with `N8N_CUSTOM_EXTENSIONS` pointing at that folder. The nodes load as `CUSTOM.letzBillTrigger` and `CUSTOM.letzCloudTrigger`. n8n serves HTTPS with a certificate from a CA made for the run, because the LetzCloud Trigger only registers `https://` webhook URLs. On exit, failure and interruption included, it removes every container, volume and network with that label, and lists the label before and after. Teardown selects by label only, so it never touches another run.

To test the published packages instead of the checkout:

```bash
PACKAGE_SOURCE=npm NPM_SPECS='@altarys/n8n-nodes-letzbill@<version> @altarys/n8n-nodes-letzcloud@<version>' \
  N8N_IMAGE=... NODE_IMAGE=... EXPECT_N8N_VERSION=... contract/run-docker.sh
```

The last lines of a run give the counts per phase and per target. `SUITE RESULT: PASS` needs the exact numbers: 37 tests in phase 1, 7 in phase 2, 14 passed per target, none failed. A phase that did not run or stopped early fails the run. `HARNESS_RED=skip-phase2` skips phase 2 to show that. The TAP output and the n8n and fake server logs are kept in `contract-logs/`.

## Red controls

`contract/run-docker.sh <mutation>` breaks one guard in both triggers before the build. The suite must then fail:

| Mutation | What it breaks | Tests that must fail |
|---|---|---|
| `no-signature-check` | The delivery is processed whatever signature v2 says | the tampered, v1-only and stale-timestamp tests |
| `no-delete` | Deactivation leaves the endpoint at the server | both deactivation tests |
| `no-activation-dedupe` | `checkExists` always answers "not registered" and removes nothing | activation at n8n start leaves exactly one subscription |

Each edit must match exactly once in each trigger file; when the source changes so that it no longer does, `mutate.mjs` stops the run instead of building an unbroken package.

## Against a real n8n and real servers

The tests read every address, key and type from the environment, so they run unchanged against another n8n: set `CONTRACT_N8N_URL`, `CONTRACT_N8N_API_KEY`, the server addresses and scoped keys (`CONTRACT_LETZBILL_*`, `CONTRACT_LETZCLOUD_*`), and the node type names (`CONTRACT_*_TRIGGER_TYPE`; a package installed as a community package has the type `<package name>.<node name>`). The subscription counts read the servers' own list routes with the scoped keys. Deliveries and the restart check need the delivery driver (`CONTRACT_DRIVER_URL`), which only the fake servers have; without it those tests fail and say why. Restarting n8n between the phases is the caller's step.

## Continuous integration

`.github/workflows/contract.yml` runs `run-docker.sh` on a GitHub-hosted runner, with n8n 2.47.7 and Node.js 24.22.3 pinned by digest. The repository variables `CONTRACT_N8N_IMAGE`, `CONTRACT_NODE_IMAGE` and `CONTRACT_N8N_VERSION` override them.
