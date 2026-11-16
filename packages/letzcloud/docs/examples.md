# LetzCloud example workflows

These example workflows show practical uses of the LetzCloud nodes that you can import into n8n and adapt.

They're for cloud providers' staff, with a provider key. Each one starts with a sticky note that explains it and has a note for each section. The values you change are in a **Settings** node, and each example handles the case where a step fails.

## Import an example

1. Download the JSON file of the example.
2. In n8n, open a new workflow, open the workflow menu, and select **Import** > **From file**.
3. Follow the steps in the workflow's sticky note: select your credentials and change the values in **Settings**.

The examples contain no credentials, IDs, or addresses of your own. n8n asks you to select a credential in each node that needs one.

Each example needs the `@altarys/n8n-nodes-letzcloud` package, version 0.1.0 or later. See [Installation](../README.md#installation). The examples are built for n8n 2.47.7 and haven't been run on a live n8n instance yet.

## Restart stopped instances every morning

File: [`restart-stopped-instances.json`](../examples/restart-stopped-instances.json)

Every day at 7:00, the workflow finds the stopped instances whose name contains the text you set in **Settings**, starts each one, and waits until it runs.

- **Starts with:** a **Schedule Trigger**.
- **Needs:** a provider key with `vm:read` and the permission to start instances, and an SMTP credential.
- **When something fails:** if an instance can't be started, or doesn't reach the **Running** state within 15 minutes, the workflow emails your team. If the instances can't be listed, **Stop and Error** fails the execution.
- **Limit:** one execution waits at most 7,200 seconds in all. With many stopped instances, the last ones may get less than 15 minutes; any that don't reach **Running** in time get the email.

## Email a daily report of your instances

File: [`daily-instance-report.json`](../examples/daily-instance-report.json)

Every day at 8:00, the workflow lists all instances of your account, writes their name, state, zone, and IP address to a CSV file, and emails the file.

- **Starts with:** a **Schedule Trigger**.
- **Needs:** a provider key with `vm:read`, and an SMTP credential.
- **When something fails:** **Get all instances** retries three times. If it still fails, **Stop and Error** fails the execution, so it shows as failed in the list of executions.

## Alert the team when an instance enters the Error state

File: [`instance-error-alert.json`](../examples/instance-error-alert.json)

LetzCloud sends an event each time an instance changes. The workflow checks each event and emails your team when the instance is in the `Error` state.

- **Starts with:** the **LetzCloud Trigger** on `instance.updated`, with **Subscribe As** set to **Provider**.
- **Needs:** a provider key with `infrastructure:admin`, and an SMTP credential. Your n8n instance must be reachable over HTTPS, as described in [LetzCloud Trigger](trigger.md#what-your-n8n-instance-needs).
- **When something fails:** if the email can't be sent, **Stop and Error** fails the execution.

## Related pages

- [Getting started](getting-started.md)
- [Operations reference](operations.md)
- [Troubleshooting](troubleshooting.md)
