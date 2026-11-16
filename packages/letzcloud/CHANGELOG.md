# Changelog

All notable changes to `@altarys/n8n-nodes-letzcloud` are listed here. Each release lists what was added, changed, and fixed, and what it means for compatibility.

## 0.1.0 (not released yet)

### Added

- **LetzCloud** node: instances, volumes, snapshots, networks, Kubernetes clusters, containers, databases, DNS zones, and DNS records, and the invoices, usage, and wallet of the customer a key belongs to. n8n's AI agents can use it as a tool.
- **Wait for State** for instances and **Wait Until Running** for Kubernetes clusters, which wait up to 7,200 seconds per execution.
- **LetzCloud Trigger** node: starts a workflow when LetzCloud sends an event, for a provider key or a customer key. It checks the signature and the time of each delivery, and ignores a repeated delivery.
- **LetzCloud API** credential. It sends the key only to an `https://` address that answers as LetzCloud.
- User documentation: getting started, credentials, operations reference, trigger, concepts, troubleshooting, and three example workflows.

### Compatibility

- Needs n8n 2.47.7 or later.
