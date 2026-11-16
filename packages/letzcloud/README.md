# `@altarys/n8n-nodes-letzcloud`

This is an n8n community node. It lets you use LetzCloud in your n8n workflows.

LetzCloud is a cloud platform that cloud providers run for their customers. With these nodes you can manage instances, volumes, snapshots, networks, Kubernetes clusters, containers, databases, and DNS records. You can also start a workflow when something happens in LetzCloud. The package contains:

- The **LetzCloud** node, for actions in LetzCloud, including two operations that wait for a long-running change to finish. n8n's AI agents can also use it as a tool.
- The **LetzCloud Trigger** node, which starts a workflow when LetzCloud sends an event, such as an instance that changed state.
- The **LetzCloud API** credential, which both nodes use.

The nodes serve two kinds of readers:

- **Cloud providers' staff**, who automate their own LetzCloud organization with a provider key.
- **Customers of a cloud provider**, who automate their own resources, invoices, and usage with a customer key, at the address they open their LetzCloud console at.

New to these nodes? Start with [Getting started](docs/getting-started.md).

## Installation

The package isn't on npm yet. You can install it once version 0.1.0 is published.

- **Self-hosted n8n:** follow n8n's guide to [installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/). In n8n, open **Settings**, then **Community nodes**. In the install dialog, enter `@altarys/n8n-nodes-letzcloud` in **npm Package Name**, confirm that you understand the risks, and select **Install**.
- **n8n Cloud:** not available yet. n8n hasn't verified these packages, so install them on a self-hosted n8n instance.

## Operations

The **LetzCloud** node works on these resources:

| Resource | Operations |
|---|---|
| Container | Create, Delete, Get, Get Many |
| Database | Create, Delete, Get, Get Many |
| DNS Record | Create, Delete, Get Many, Update |
| DNS Zone | Get Many |
| Instance | Change State, Create, Delete, Get, Get Many, Wait for State |
| Invoice | Get Many (customer key) |
| Kubernetes Cluster | Create, Delete, Get, Get Many, Wait Until Running |
| Network | Create, Delete, Get, Get Many |
| Snapshot | Create, Delete, Get Many |
| Usage | Get (customer key) |
| Volume | Create, Delete, Get, Get Many |
| Wallet | Get (customer key) |

Every parameter and output field is in the [operations reference](docs/operations.md). The **LetzCloud Trigger** node and its events are described in [LetzCloud Trigger](docs/trigger.md).

## Credentials

You need a LetzCloud service-account key and the address of your LetzCloud console. A key starts with `bff_sa_`. The address must start with `https://`.

- Cloud providers' staff create a provider key in the console, under **Administration** > **API keys & webhooks**.
- Customers of a cloud provider create a customer key in the console, under **Configuration** > **API tokens**. It can only reach what belongs to that customer.

Step-by-step instructions, the permissions each node needs, and how to replace a key are in [Credentials](docs/credentials.md).

## Compatibility

- Minimum n8n version: 2.47.7. Earlier versions aren't supported.
- Node.js: n8n 2.47.7 needs Node.js 24 or later.
- Tested: version 0.1.0 is built, linted, and unit-tested with the n8n node tools and `n8n-workflow` 2.47.2. Tests on a running n8n instance are still to be done.
- Known incompatibilities: the **LetzCloud Trigger** needs an n8n instance whose webhook URLs start with `https://`.

## Usage

- [Getting started](docs/getting-started.md): install the package, add the credential, and list your instances.
- [Concepts](docs/concepts.md): provider and customer keys, waiting for long-running changes, amounts, and lists.
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
