# Security policy

This page explains which versions of the n8n nodes for LetzBill and LetzCloud get security fixes, and how to report a vulnerability.

## Supported versions

| Package | Supported versions |
|---|---|
| `@altarys/n8n-nodes-letzbill` | The latest published version |
| `@altarys/n8n-nodes-letzcloud` | The latest published version |

Security fixes are released as a new version of the affected package. Update to the latest version to get them. Each release is published from this repository's GitHub Actions with an npm provenance statement, so you can check that a version was built from this source.

## Report a vulnerability

Report a vulnerability privately, never in a public issue, pull request, or discussion.

1. Open the **Security** tab of this repository.
2. Select **Report a vulnerability**.
3. Describe the problem, the package and version, and the steps to reproduce it. Don't include real API keys, signing secrets, or customer data: use placeholders.

You get an answer within five working days. When the report is confirmed, the fix is released as soon as possible, and the advisory credits you unless you ask otherwise.

## Scope

This policy was written in wave 4.


In scope: the code in this repository, the published packages, and their documentation and example workflows.

Out of scope: vulnerabilities in n8n itself, which you report to n8n, and in the LetzBill or LetzCloud services, which you report to your cloud provider.
