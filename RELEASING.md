# Releasing the n8n node packages

This page explains how a maintainer sets up publishing once, releases a new version of `@altarys/n8n-nodes-letzbill` or `@altarys/n8n-nodes-letzcloud`, and submits a package to n8n for verification.

## Who this page is for

This page is for maintainers who have admin access to this repository and an npm account that belongs to the `altarys` organization on npm.

Each package is published by the **Publish** workflow (`.github/workflows/publish.yml`) on a GitHub-hosted runner, with an npm provenance statement. npm provenance and trusted publishing don't support self-hosted runners.

## One-time setup

Do these steps once, in this order. Steps 1 and 4 need an npm account and can't be done from this repository.

### 1. Create the npm organization

The package names start with `@altarys/`, so the npm organization `altarys` must exist and your npm account must belong to it. An npm organization's name is also its scope.

1. Sign in at [npmjs.com](https://www.npmjs.com/login). If you don't have an npm account, [sign up](https://www.npmjs.com/signup) first.
2. In the upper-right corner, select your profile picture, then select **Add an Organization**.
3. In the **Name** field, enter `altarys`.
4. Choose the free plan **Unlimited public packages**, then select **Create**.
5. Optionally invite other maintainers, then select **Continue**.

n8n verifies a community node only when the package's author or maintainer on npm matches the repository on GitHub, and the repository is public. Keep the `author` and `repository` fields in each `package.json` pointing at this repository.

### 2. Check the release environment

The **Publish** workflow runs in the GitHub environment `npm-publish`. That environment requires a reviewer to approve each release, and accepts only tags that match `letzbill-v*` or `letzcloud-v*`. It already exists in this repository. To create the same environment in another repository, run the following with the GitHub CLI as a repository admin, replacing the placeholders:

```bash
# Who approves each release (a GitHub user id; find it with: gh api users/<reviewer-login> --jq .id).
gh api -X PUT repos/<owner>/<repo>/environments/npm-publish --input - <<'EOF'
{"wait_timer":0,"prevent_self_review":false,
 "reviewers":[{"type":"User","id":<reviewer-user-id>}],
 "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
EOF

# Only release tags may deploy to the environment.
gh api -X POST repos/<owner>/<repo>/environments/npm-publish/deployment-branch-policies -f name='letzbill-v*' -f type=tag
gh api -X POST repos/<owner>/<repo>/environments/npm-publish/deployment-branch-policies -f name='letzcloud-v*' -f type=tag

# Read it back.
gh api repos/<owner>/<repo>/environments/npm-publish --jq '{name, rules: [.protection_rules[].type]}'
```

The workflow also refuses a tag whose commit isn't on `main`.

### 3. Check private vulnerability reporting

Private vulnerability reporting is on for this repository, so the **Security** tab offers **Report a vulnerability** (see [SECURITY.md](SECURITY.md)). To turn it on in another repository, run `gh api -X PUT repos/<owner>/<repo>/private-vulnerability-reporting`. To read it back, run `gh api repos/<owner>/<repo>/private-vulnerability-reporting`, which returns `{"enabled":true}`.

### 4. Publish the first version with an access token

npm lets you add a trusted publisher only to a package that already exists, so the first version of each package is published with an access token.

1. On npmjs.com, select your profile picture, then select **Access Tokens**.
2. Select **Generate New Token**.
3. In **Token name**, enter a name such as `n8n-nodes first publish`.
4. In **Packages and scopes**, set **Permissions** to **Read and write (publish and stage)**, select **Only select packages and scopes**, and choose the `@altarys` scope. The workflow publishes directly with `npm publish`, which the stage-only permission doesn't allow.
5. In **Expiration**, choose a short period, for example seven days.
6. Select **Generate Token**, then copy the token.
7. Store it as a secret of the `npm-publish` environment. The command asks for the value, so the token doesn't end up in your shell history:

   ```bash
   gh secret set NPM_TOKEN --env npm-publish --repo <owner>/<repo>
   ```

8. Release the first version of each package, as described in [Release a version](#release-a-version).

### 5. Switch to trusted publishing

After the first version of a package is on npm, let the workflow publish with a short-lived token from GitHub instead of a stored secret. Do this for each package. You need two-factor authentication on your npm account: npm refuses this change from an access token that bypasses two-factor authentication, including the token from step 4.

1. On npmjs.com, open the package, then its settings.
2. Add a trusted publisher of type **GitHub Actions** with these values:

   | Field | Value |
   |---|---|
   | Organization or user | `helmajbri` |
   | Repository | `altarys-n8n-nodes` |
   | Workflow filename | `publish.yml` (the file name, not the workflow's display name) |
   | Environment name | `npm-publish` |
   | Allowed actions | Also allow `npm publish`. `npm stage publish` is always allowed. |

3. Release a version within two days. npm drops a new trusted publisher that hasn't completed a publish in that time. The first successful publish binds it to this repository.
4. Delete the token secret, then revoke the token on npmjs.com under **Access Tokens**:

   ```bash
   gh secret delete NPM_TOKEN --env npm-publish --repo <owner>/<repo>
   ```

5. Optionally, in the package's publishing access settings, select **Require two-factor authentication and disallow tokens**. The trusted publisher keeps working, because it doesn't use a stored token.

You can also add the trusted publisher from the command line with npm 11.10.0 or later, after `npm login`. The command has no option for allowed actions, so check that field on npmjs.com afterward:

```bash
npm trust github @altarys/n8n-nodes-letzbill --file publish.yml --repo <owner>/<repo> --env npm-publish
```

npm doesn't check the trusted publisher's fields when you save them. If a publish fails with `ENEEDAUTH`, compare every field with the table, including the `.yml` extension. To change a trusted publisher, delete it and add a new one.

## Release a version

1. On a branch, update `packages/<name>/CHANGELOG.md` with what changed, and merge the branch into `main`.
2. Check out an up-to-date `main`, then run the release command for the package:

   ```bash
   git switch main && git pull
   cd packages/letzbill        # or packages/letzcloud
   npm run release
   ```

   The command bumps the version, commits, and pushes the tag `letzbill-v<version>` (or `letzcloud-v<version>`). The tag starts the **Publish** workflow.
3. Open the workflow run on the repository's **Actions** tab. The run waits for a reviewer: select **Review deployments**, select `npm-publish`, then select **Approve and deploy**.
4. The workflow checks that the tagged commit is on `main`, builds, lints, tests, publishes with a provenance statement, and then scans the published version with the n8n community package scanner. The scanner prints `has passed all security checks` when the version passes; the workflow fails if that line is missing.
5. Check the package page on npmjs.com: the new version shows its provenance and links back to the commit it was built from.

## Submit a package for n8n verification

After a version passes the scan, submit the package in the [n8n Creator Portal](https://creators.n8n.io/nodes). n8n's review can take up to four weeks. Until n8n verifies a package, it can only be installed on self-hosted n8n.

## Move the repository

If this repository moves to another owner, the package names stay the same. In the next release:

1. Update `repository` and `author` in each `package.json` to the new location.
2. Replace the trusted publisher of each package with one that names the new owner and repository. npm doesn't let you edit an existing one.
3. Create the `npm-publish` environment and private vulnerability reporting in the new repository, as described in step 2 and step 3.

## Related resources

- [README.md](README.md)
- [SECURITY.md](SECURITY.md)
