# Security policy

This page explains which versions of the n8n nodes for LetzBill and LetzCloud get security fixes, and how to report a vulnerability.

## Supported versions

| Package | Supported versions |
|---|---|
| `@altarys/n8n-nodes-letzbill` | The latest published version |
| `@altarys/n8n-nodes-letzcloud` | The latest published version |

No version is published yet. Security fixes will be released as a new version of the affected package, so update to the latest version to get them. Each version will be published from this repository's GitHub Actions with an npm provenance statement, so that you can check that it was built from this source.

## Report a vulnerability

Report a vulnerability privately, never in a public issue, pull request, or discussion.

- **Private security advisory:** once private vulnerability reporting is turned on for this repository, open the **Security** tab and select **Report a vulnerability**.
- **Until then:** contact the owner of this repository through GitHub and ask for a private channel. Don't describe the vulnerability in the first message.

In your report, describe the problem, the package and version, and the steps to reproduce it. Don't include real API keys, signing secrets, or customer data: use placeholders.

You get an answer within five working days. When the report is confirmed, the fix is released as soon as possible, and the advisory credits you unless you ask otherwise.

## Scope

In scope: the code in this repository, the published packages, and their documentation and example workflows.

Out of scope, and where to report it instead:

- Vulnerabilities in n8n itself: report them to n8n.
- Vulnerabilities in the LetzBill or LetzCloud services: cloud providers' staff report them to their LetzBill or LetzCloud account contact. Customers of a cloud provider report them to their cloud provider.
