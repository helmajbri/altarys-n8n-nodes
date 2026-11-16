# altarys-n8n-nodes

This repository holds the n8n community nodes for LetzBill and LetzCloud, one npm package per service.

| Package | For | Documentation |
|---|---|---|
| `@altarys/n8n-nodes-letzbill` | Cloud providers' staff who bill their customers with LetzBill | [LetzBill nodes](packages/letzbill/README.md) |
| `@altarys/n8n-nodes-letzcloud` | Cloud providers' staff, and customers of a cloud provider, who automate LetzCloud | [LetzCloud nodes](packages/letzcloud/README.md) |

Each package has a README in the layout of n8n's community node template. Its `docs` folder holds a getting started tutorial, credentials guide, operations reference, trigger guide, concepts, troubleshooting, and example workflows.

To report a vulnerability, see the [security policy](SECURITY.md).

## Repository layout

Each folder under `packages` is a complete n8n node package, in the layout that `npm create @n8n/node` produces: its own `package.json`, `tsconfig.json`, the default `eslint.config.mjs`, and the `n8n-node` scripts. Run every package command inside the package folder:

```bash
npm install
npm run guard            # hard limits of a verified community node
npm run generate:check   # generated operations match the OpenAPI document
npm run lint             # n8n-node lint, strict mode
npm run build
npm test                 # runs against dist/, so build first
node ../../tools/generate-docs.mjs . --check   # documentation matches the built nodes
node ../../tools/check-docs.mjs .              # documentation checks
```

## Repository tools

- `tools/generate-operations.mjs` writes a package's declarative operations from its OpenAPI document and `openapi/scope.manifest.json`. It checks every path, parameter, and field the manifest names against the document, and refuses money fields that aren't integer minor units with a currency. `npm run generate` writes; `npm run generate:check` fails when the committed file differs.
- `tools/check-package.mjs` checks the hard limits of a verified community node before install. It allows no runtime dependencies, `peerDependencies` exactly `"n8n-workflow": "*"`, and allowed imports only. It refuses restricted globals, environment or file access, `eval`, and `child_process`. It also wants ASCII-only node files, one credential, and the default lint configuration in strict mode.
- `tools/generate-docs.mjs` writes `docs/operations.md` and the reference block of `docs/trigger.md` from the built nodes and `openapi/event-types.json`, a snapshot of the service's event list. Run it with `--write` after `npm run build`; `--check` fails when a committed page differs.
- `tools/check-docs.mjs` checks the documentation of a package:
  - every operation, trigger parameter, and event is in the reference;
  - every message the code shows has an entry in `docs/troubleshooting.md`;
  - no published file uses a term from the reviewed word list in `docs-lint/jargon.txt`;
  - every relative link resolves;
  - every example workflow is free of credentials, IDs, URLs, and secrets.

  With `--repo`, it checks this page and the security policy.

## Continuous integration and publishing

- `.github/workflows/ci.yml`: per package, the guard, the generator check, `n8n-node lint` in strict mode, build, tests, and the documentation checks. It also runs the tests of the tools, and prose lint of the documentation with Vale and the Microsoft style package, as n8n's own documentation uses. The configuration is in `.vale.ini`.
- `.github/workflows/publish.yml`: on a tag `<package>-v<version>`, such as `letzbill-v0.1.0`, publishes that package to npm with a provenance statement from a GitHub-hosted runner. It then runs `@n8n/scan-community-package` on the published version, and fails unless its output reports that the package passed. The publish job runs in the `npm-publish` environment, whose required reviewers approve each release, and refuses a tag whose commit isn't on `main`. Actions are pinned by commit SHA.

Run `npm run release` inside a package folder to bump its version and push its tag. The first version of a package is published with an `NPM_TOKEN` repository secret; after that, configure npm trusted publishing for the workflow file `publish.yml` and remove the secret.

## License

[MIT](LICENSE)
