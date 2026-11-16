# LetzCloud Trigger node

Use the **LetzCloud Trigger** node to start a workflow when LetzCloud sends an event, such as an instance that changed state or a customer's invoice that was issued.

This page is for cloud providers' staff and for customers of a cloud provider. It explains how the trigger subscribes to events, what your n8n instance needs, how deliveries are checked, and which events each kind of key can choose.

## Set up the trigger

1. Add the **LetzCloud Trigger** node to a new workflow and select your **LetzCloud API** credential.
2. In **Subscribe As**, choose whose events you want:
   - **Provider**: events of the whole provider organization. Needs a provider key with the `infrastructure:admin` permission.
   - **Customer**: events of the customer the key belongs to, including its invoices and usage alerts. Needs a customer key with `monitoring:read` and `monitoring:write`.
3. In **Event Names or IDs**, choose one or more events. n8n loads the list your key may choose from LetzCloud.
4. Add the nodes that should run for each event.
5. Publish the workflow.

When you publish the workflow, the trigger registers a webhook endpoint in LetzCloud for the events you chose, at the workflow's production webhook URL. LetzCloud then sends each of those events to n8n, and each delivery starts one execution. A customer's events go only to that customer's endpoints.

When you unpublish the workflow, the trigger removes the endpoint, and LetzCloud stops sending events to it. Publishing again doesn't add a second endpoint: the trigger reuses its endpoint, or replaces it when you changed the events or **Subscribe As**.

## What your n8n instance needs

LetzCloud sends events only to `https://` addresses, and it must be able to reach your n8n instance at the workflow's production webhook URL. n8n shows it under **Production URL** in the trigger's **Webhook URLs**. If the URL starts with `http://`, publishing the workflow fails with a message that says so.

If your self-hosted n8n runs behind a reverse proxy, set the `N8N_WEBHOOK_URL` environment variable to the public `https://` address of n8n, so that the webhook URLs n8n gives LetzCloud point at that address. `N8N_WEBHOOK_URL` exists from n8n 2.30.0. The older `WEBHOOK_URL` still works but is deprecated from n8n 2.35.0.

## How deliveries are checked

Each delivery is signed with a secret that only LetzCloud and this trigger know. The trigger receives the secret when it registers the endpoint, and keeps it in the workflow.

Before a delivery starts the workflow, the trigger checks that:

- the signature matches the delivery, so the content wasn't changed and the sender knows the secret, and
- the time in the delivery is within **Timestamp Tolerance (Seconds)** of the clock of your n8n instance. The default is 300 seconds; the largest value is 900.

A delivery that fails either check starts no workflow. n8n's log records why, as described in [Troubleshooting](troubleshooting.md#a-delivery-was-dropped).

Anyone who can read the workflow can also read its signing secret. Limit who can open the workflow. To get a new secret, unpublish the workflow and publish it again: the trigger then registers a new endpoint with a new secret.

## Why a repeated delivery is ignored

LetzCloud delivers each event at least once, so the same event can arrive twice, for example when LetzCloud retries after a network error. The trigger remembers the events it accepted during the timestamp tolerance, up to 1,000 of them, and ignores a repeat: it answers LetzCloud, but starts no execution.

A repeat that arrives later than the tolerance, or two copies that arrive at the same moment, can still start a second execution. Where a duplicate would matter, check `metadata.event_id` in your workflow.

## What the trigger outputs

Each delivery becomes one item: the event exactly as LetzCloud sent it, with these fields:

| Field | Content |
|---|---|
| `webhook_type` | The event, such as `instance.updated`. |
| `object_type` | The kind of object the event is about, such as `instance`. |
| `instance`, or the field named by `object_type` | The object itself. For example, `{{ $json.instance.id }}` reads its ID in an expression. |
| `metadata.event_id` | The ID of the event. A retry of the same event has the same ID. |
| `metadata.timestamp` | When LetzCloud built the event. |

## Reference

The parameters of the trigger and the events each kind of key can choose. The event lists are the ones LetzCloud offered when this version of the package was released; the list in the node is always the one for your key.

<!-- BEGIN GENERATED: trigger reference -->
<!-- END GENERATED: trigger reference -->
