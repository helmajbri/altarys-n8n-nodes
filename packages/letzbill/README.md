# @altarys/n8n-nodes-letzbill

This is an n8n community node. It lets you use LetzBill in your n8n workflows.

LetzBill is the billing service that cloud providers use to bill their customers. With these nodes, a cloud provider's staff can manage customers, subscriptions, invoices, credit notes, payments, wallets, and usage events, and start a workflow when something happens in LetzBill. The package contains:

- The **LetzBill** node, for actions on your LetzBill account. n8n's AI agents can also use it as a tool.
- The **LetzBill Trigger** node, which starts a workflow when LetzBill sends an event, such as a paid invoice.
- The **LetzBill API** credential, which both nodes use.

New to these nodes? Start with [Getting started](docs/getting-started.md).

## Installation

Follow n8n's guide to [installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/) and use the package name `@altarys/n8n-nodes-letzbill`.

- **Self-hosted n8n:** in n8n, open **Settings**, then **Community nodes**. In the install dialog, enter `@altarys/n8n-nodes-letzbill` in **npm Package Name**, confirm that you understand the risks, and select **Install**.
- **n8n Cloud:** not available yet. n8n hasn't verified these packages, so install them on a self-hosted n8n instance.

## Operations

The **LetzBill** node works on these resources:

| Resource | Operations |
|---|---|
| Credit Note | Create, Get, Get Many, Void |
| Customer | Create, Delete, Get, Get by External ID, Get Many, Update |
| Invoice | Create One-Off, Download PDF, Finalize, Get, Get Many, Send, Void |
| Payment | Create, Get, Get Many, Refund |
| Subscription | Create, Get, Get by External ID, Get Many, Terminate, Update |
| Usage Event | Create, Create Batch, Get, Get Many |
| Wallet | Create, Get, Get Many, Get Transactions, Top Up |
| Webhook Endpoint | Delete, Get, Get Many, Send Test |

Every parameter and output field is in the [operations reference](docs/operations.md). The **LetzBill Trigger** node and its events are described in [LetzBill Trigger](docs/trigger.md).

## Credentials

You need a LetzBill API key and the address of the LetzBill API. A LetzBill API key starts with `fb_`. You create it in the console, under **Billing** > **Developers** > **API keys**. The API address must start with `https://`.

Step-by-step instructions, the permissions each node needs, and how to replace a key are in [Credentials](docs/credentials.md).

## Compatibility

- Minimum n8n version: 2.47.7. Earlier versions aren't supported.
- Node.js: n8n 2.47.7 needs Node.js 24 or later.
- Tested: version 0.1.0 is built, linted, and unit-tested with the n8n node tools and `n8n-workflow` 2.47.2. Tests on a running n8n instance are still to be done.
- Known incompatibilities: none known.

## Usage

- [Getting started](docs/getting-started.md): install the package, add the credential, and list your invoices.
- [Concepts](docs/concepts.md): amounts in minor units, retries, IDs, and how lists are read.
- [Example workflows](docs/examples.md): workflows you can import and adapt.
- [Troubleshooting](docs/troubleshooting.md): every message the nodes show, with its cause and fix.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Operations reference](docs/operations.md)
- [Security policy](../../SECURITY.md)

## Version history

See the [changelog](CHANGELOG.md).

## License

[MIT](../../LICENSE)
