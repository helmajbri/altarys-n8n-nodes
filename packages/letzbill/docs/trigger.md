# LetzBill Trigger node

Use the **LetzBill Trigger** node to start a workflow when LetzBill sends an event, such as a paid invoice or a failed payment.

This page is for cloud providers' staff. It explains how the trigger subscribes to events, what your n8n instance needs, how deliveries are checked, and which events you can choose.

## Set up the trigger

1. Add the **LetzBill Trigger** node to a new workflow and select your **LetzBill API** credential. The key needs the **Read**, **Write**, and **Delete** modes for webhooks. See [Credentials](credentials.md).
2. In **Event Names or IDs**, choose one or more events. n8n loads the list from your LetzBill account.
3. Add the nodes that should run for each event.
4. Publish the workflow.

When you publish the workflow, the trigger registers a webhook endpoint in LetzBill for the events you chose, at the workflow's production webhook URL. LetzBill then sends each of those events to n8n, and each delivery starts one execution.

When you unpublish the workflow, the trigger removes the endpoint, and LetzBill stops sending events to it. Publishing again doesn't add a second endpoint: the trigger reuses its endpoint, or replaces it when you changed the events.

## What your n8n instance needs

LetzBill must be able to reach your n8n instance at the workflow's production webhook URL. n8n shows it under **Production URL** in the trigger's **Webhook URLs**.

If your self-hosted n8n runs behind a reverse proxy, set the `N8N_WEBHOOK_URL` environment variable to the public address of n8n, so that the webhook URLs n8n gives LetzBill point at that address. `N8N_WEBHOOK_URL` exists from n8n 2.30.0. The older `WEBHOOK_URL` still works but is deprecated from n8n 2.35.0.

## How deliveries are checked

Each delivery is signed with a secret that only LetzBill and this trigger know. The trigger receives the secret when it registers the endpoint, and keeps it in the workflow.

Before a delivery starts the workflow, the trigger checks that:

- the signature matches the delivery, so the content wasn't changed and the sender knows the secret, and
- the time in the delivery is within **Timestamp Tolerance (Seconds)** of the clock of your n8n instance. The default is 300 seconds; the largest value is 900.

A delivery that fails either check starts no workflow. n8n's log records why, as described in [Troubleshooting](troubleshooting.md#a-delivery-was-dropped).

Anyone who can read the workflow can also read its signing secret. Limit who can open the workflow. To get a new secret, unpublish the workflow and publish it again: the trigger then registers a new endpoint with a new secret.

## Why a repeated delivery is ignored

LetzBill delivers each event at least once, so the same event can arrive twice, for example when LetzBill retries after a network error. The trigger remembers the events it accepted during the timestamp tolerance, up to 1,000 of them, and ignores a repeat: it answers LetzBill, but starts no execution.

A repeat that arrives later than the tolerance, or two copies that arrive at the same moment, can still start a second execution. Where a duplicate would matter, check `metadata.event_id` in your workflow, for example against the IDs your workflow already handled.

## What the trigger outputs

Each delivery becomes one item: the event exactly as LetzBill sent it, with these fields:

| Field | Content |
|---|---|
| `webhook_type` | The event, such as `invoice.paid`. |
| `object_type` | The kind of object the event is about, such as `invoice`. |
| `invoice`, or the field named by `object_type` | The object itself. For example, `{{ $json.invoice.id }}` reads its ID in an expression. |
| `metadata.event_id` | The ID of the event. A retry of the same event has the same ID. |
| `metadata.timestamp` | When LetzBill built the event. |

## Reference

The parameters of the trigger and the events you can choose. The event list is the one LetzBill offered when this version of the package was released; the list in the node is always your account's own.

<!-- BEGIN GENERATED: trigger reference -->
<!-- END GENERATED: trigger reference -->
