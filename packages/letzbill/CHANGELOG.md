# Changelog

All notable changes to `@altarys/n8n-nodes-letzbill` are listed here. Each release lists what was added, changed, and fixed, and what it means for compatibility.

## 0.1.1 (2026-11-17)

### Changed

- The installation steps no longer say that the package isn't on npm. Install it as described in [Installation](README.md#installation).

### Compatibility

- No changes to the nodes or the credential. Needs n8n 2.47.7 or later.

## 0.1.0 (2026-11-16)

### Added

- **LetzBill** node: customers, subscriptions, invoices, credit notes, payments, wallets, usage events, and webhook endpoints. n8n's AI agents can use it as a tool.
- **LetzBill Trigger** node: starts a workflow when LetzBill sends an event. It checks the signature and the time of each delivery, and ignores a repeated delivery.
- **LetzBill API** credential, tested by reading the list of LetzBill events.
- User documentation: getting started, credentials, operations reference, trigger, concepts, troubleshooting, and three example workflows.

### Compatibility

- Needs n8n 2.47.7 or later.
