# LetzCloud example workflows

These example workflows show practical uses of the LetzCloud nodes that you can import into n8n and adapt.

Each one starts with a sticky note that explains it, keeps the values you change in a **Settings** node, and handles the case where a step fails. Each example says which kind of key it needs: a provider key, a customer key, or either.

## Import an example

1. Download the JSON file of the example.
2. In n8n, open a new workflow, open the workflow menu, and select **Import** > **From file**.
3. Follow the steps in the workflow's sticky note: select your credentials and change the values in **Settings**.

The examples contain no credentials, IDs, or addresses of your own. n8n asks you to select a credential in each node that needs one.

Each example needs the `@altarys/n8n-nodes-letzcloud` package, version 0.1.0 or later. See [Installation](../README.md#installation). The examples are built for n8n 2.47.7 and haven't been run on a live n8n instance yet.

## Restart stopped instances every morning

File: [restart-stopped-instances.json](../examples/restart-stopped-instances.json)

Every day at 7:00, the workflow finds the stopped instances whose name contains the text you set in **Settings**, starts each one, and waits until it runs.

- **Starts with:** a **Schedule Trigger**.
- **Needs:** a provider key or a customer key that may list, read, and start instances, and an SMTP credential.
- **When something fails:** if an instance can't be started, or doesn't reach the **Running** state within 15 minutes, the workflow emails your team. If the instances can't be listed, **Stop and Error** fails the execution.

## Email last month's usage as a CSV file

File: [monthly-usage-export.json](../examples/monthly-usage-export.json)

On the first day of each month, the workflow reads last month's usage of your account, writes one row per resource to a CSV file, and emails the file.

- **Starts with:** a **Schedule Trigger**.
- **Needs:** a customer key with `usage_billing:read`, and an SMTP credential. A provider key is refused, because usage belongs to a customer.
- **When something fails:** **Get last month's usage** retries three times. If it still fails, **Stop and Error** fails the execution, so it shows as failed in the list of executions.

## Alert the team when an instance enters the Error state

File: [instance-error-alert.json](../examples/instance-error-alert.json)

LetzCloud sends an event each time an instance changes. The workflow checks each event and emails your team when the instance is in the `Error` state.

- **Starts with:** the **LetzCloud Trigger** on `instance.updated`, with **Subscribe As** set to **Provider**. For a customer key, set **Subscribe As** to **Customer**.
- **Needs:** a provider key with `infrastructure:admin`, or a customer key with `monitoring:read` and `monitoring:write`, and an SMTP credential. Your n8n instance must be reachable over HTTPS, as described in [LetzCloud Trigger](trigger.md#what-your-n8n-instance-needs).
- **When something fails:** if the email can't be sent, **Stop and Error** fails the execution.

## Related pages

- [Getting started](getting-started.md)
- [Operations reference](operations.md)
- [Troubleshooting](troubleshooting.md)
