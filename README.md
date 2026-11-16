# altarys-n8n-nodes

n8n community nodes for LetzBill and LetzCloud. One npm package per service:

| Package | Folder | Contents |
|---|---|---|
| `@altarys/n8n-nodes-letzbill` | [`packages/letzbill`](packages/letzbill) | LetzBill action node, LetzBill Trigger, LetzBill API credential |
| `@altarys/n8n-nodes-letzcloud` | `packages/letzcloud` (planned) | LetzCloud nodes |

Each folder is a complete n8n node package in the layout `npm create @n8n/node` produces: its own
`package.json`, `tsconfig.json`, default `eslint.config.mjs` and `n8n-node` scripts. Run every
command inside the package folder.

## Repository tools

- `tools/generate-operations.mjs` writes a package's declarative operations from its OpenAPI
  document and `openapi/scope.manifest.json`. It checks every path, parameter and field the
  manifest names against the document, and refuses money fields that are not integer minor units
  with a currency. `npm run generate` writes, `npm run generate:check` fails when the committed
  file differs.
- `tools/check-package.mjs` checks the hard limits of a verified community node before install:
  no runtime dependencies, `peerDependencies` exactly `"n8n-workflow": "*"`, allowed imports
  only, no restricted globals, no environment or file access, no `eval` or `child_process`,
  ASCII-only node files, one credential, the default lint config with strict mode.

## CI and publishing

- `.github/workflows/ci.yml`: per package, the guard, the generator check, `n8n-node lint`
  (strict), build and tests; plus the tests of the tools.
- `.github/workflows/publish.yml`: on a tag `<package>-v<version>` (for example
  `letzbill-v0.1.0`), publishes that package to npm with a provenance statement from a
  GitHub-hosted runner, then runs `@n8n/scan-community-package` on the published version and
  fails unless its output reports that the package passed. The publish job runs in the
  `npm-publish` environment, whose required reviewers approve each release, and refuses a tag
  whose commit is not on `main`. Actions are pinned by commit SHA.

Run `npm run release` inside a package folder to bump its version and push its tag. The first
version of a package is published with an `NPM_TOKEN` repository secret; after that, configure
npm trusted publishing for the workflow file `publish.yml` and remove the secret.

## License

[MIT](LICENSE)
