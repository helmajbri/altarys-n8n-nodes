# @altarys/n8n-nodes-letzcloud

n8n community nodes for LetzCloud, the cloud platform a provider runs on its own LetzCloud
appliance:

- **LetzCloud**: manage instances, volumes, snapshots, networks, Kubernetes clusters, containers,
  databases and DNS records, wait for an instance or a cluster to be ready, and read your own
  invoices, usage and wallet. It can also be used as a tool by an n8n AI agent.
- **LetzCloud Trigger**: start a workflow when the appliance sends a webhook event. Every
  delivery is checked against its signature before the workflow runs.

Built against n8n 2.47.7 (`n8n-workflow` 2.47.2).

## Installation

In n8n, open **Settings > Community Nodes**, select **Install**, and enter
`@altarys/n8n-nodes-letzcloud`. See the n8n documentation on
[installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

Create a **LetzCloud API** credential with:

| Field | Value |
|---|---|
| Appliance URL | The address of your LetzCloud appliance, without `/api/v1`, for example `https://cloud.example.com`. Each appliance has its own address; your cloud provider gives it to you. |
| API Key | A LetzCloud service-account key. Keys start with `bff_sa_`; other keys are refused. |

The key is sent as `Authorization: Bearer <key>`.

Before n8n adds the key to any request, the credential:

1. refuses an appliance URL that does not start with `https://`, so the key never crosses the
   network unencrypted;
2. reads `/.well-known/letzcloud-appliance`, which the appliance serves without a key, and goes on
   only if the address answers as a LetzCloud appliance. A mistyped address therefore never
   receives the key.

This check runs before every request the nodes make, so each request costs one extra small read.
The **Test** button runs the same check, then lists the first instance with the key. It reports
a wrong address ("No LetzCloud appliance answered at ...") and a refused key ("The appliance did
not accept the API key ...") separately. Listing instances needs the `vm:read` permission: a key
without it fails the test with a message that says so, and can still be saved and used for the
operations it is allowed to run.

### Provider keys and customer keys

The same nodes serve two kinds of key, and the appliance decides what each may do; the nodes do
not hide operations:

- A **provider key** belongs to the organization that runs the appliance. It can use every
  operation its permissions allow.
- A **customer key** belongs to one of the provider's customers. It can list, read, start, stop,
  reboot and delete that customer's instances, read the customer's invoices, usage and wallet,
  and receive the customer's events in the trigger. Any other operation is refused with "A
  customer key cannot use this operation".

## LetzCloud node

| Resource | Operations |
|---|---|
| Container | Create, Delete, Get, Get Many |
| Database | Create, Delete, Get, Get Many |
| DNS Record | Create, Delete, Get Many, Update |
| DNS Zone | Get Many |
| Instance | Change State, Create, Delete, Get, Get Many, Wait for State |
| Invoice | Get Many |
| Kubernetes Cluster | Create, Delete, Get, Get Many, Wait Until Running |
| Network | Create, Delete, Get, Get Many |
| Snapshot | Create, Delete, Get Many |
| Usage | Get |
| Volume | Create, Delete, Get, Get Many |
| Wallet | Get |

Invoice, Usage and Wallet read the invoices, usage and wallet of the customer the key belongs to;
they need a customer key with the `usage_billing:read` permission.

Operations that cannot be undone (Delete) are separate operations, and their descriptions say
what they remove.

### Waiting for long-running operations

Creating an instance or a cluster, and starting, stopping or rebooting an instance, return at
once with a job; the work goes on in the cloud. Two operations wait for the result:

- **Instance > Wait for State** reads the instance until it is **Running** or **Stopped**. Use it
  after **Change State**: Running after a start or a reboot, Stopped after a stop. It stops with a
  message if the instance is in Error, Destroyed or Expunging instead.
- **Kubernetes Cluster > Wait Until Running** reads the clusters with the given name until that
  cluster is Running. Creating a cluster answers with a job, not with the cluster ID, so the wait
  finds the cluster by the name you created it with. It stops with a message if the cluster is in
  Error, Destroying or Destroyed, or if two clusters have that name.

Both read again every **Interval (Seconds)** until **Time Limit (Seconds)**, and then stop with a
message. They wait with n8n's own `sleep` helper.

### Amounts

Every amount is an integer in the minor unit of its currency, with the currency beside it:
`amount_cents: 1250` with `currency: "EUR"` means 12.50 EUR. In **Usage > Get**, the per-plan
rows and their charges carry the currency of the report, which the node copies into each row.
The wallet balance is `{"amount": 2500, "currency": "EUR"}`, also in minor units.

### Get Many

**Return All** reads every page; otherwise **Limit** sets how many results to return. Return All
stops with a message if the appliance sends the same page twice or is still sending full pages
after 10,000 pages.

### Retries

None of these appliance routes takes an idempotency key, so the node sends none. A Create that is
retried after a timeout can create a second resource: before retrying, use **Get Many** with a
name filter to check whether the first attempt went through.

### IDs

IDs that the appliance defines as UUIDs are checked before the request: anything else is
refused. Snapshot and Kubernetes cluster IDs are free text; they are refused when empty, `.`,
`..` or holding a slash, which would point the request at another address.

### Refusals

When the appliance refuses a request the node says why: a feature your plan does not include
(with the feature and the current plan, and the advice to upgrade), a plan limit, an operation a
customer key or a provider key cannot use, a permission the key lacks (named), an account that
is restricted or not yet verified, a record that does not exist, or the fields the appliance
rejected.

## LetzCloud Trigger

Choose **Subscribe As**:

- **Provider**: events of the whole provider organization, for a provider key with the
  `infrastructure:admin` permission. Today these are the instance lifecycle events.
- **Customer**: events of the customer the key belongs to, for a customer key with
  `monitoring:read` and `monitoring:write`. These include the customer's instance, invoice and
  usage-alert events.

Then choose the events; the list comes from your appliance. The appliance alone decides which
events a key receives: an event list for one customer never includes another customer's events.

When the workflow is activated, the trigger registers a webhook endpoint for those events and
keeps its signing secret; when the workflow is deactivated, it removes the endpoint. Activating
again does not add a second endpoint. The appliance only delivers to `https://` addresses, so
n8n's webhook URL must use HTTPS.

Each delivery carries `X-Webhook-Timestamp` and `X-Webhook-Signature-V2`, the HMAC-SHA256 of
`{timestamp}.{raw body}` with the endpoint secret. The trigger drops a delivery whose signature
does not match, or whose timestamp is further from the n8n clock than **Timestamp Tolerance
(Seconds)** (300 by default, at most 900; any other value drops every delivery). A dropped
delivery starts no workflow.

The appliance delivers each event at least once. The trigger remembers the `metadata.event_id`
of the deliveries it accepted within the tolerance window (up to 1,000 of them) and answers a
repeat with `200` and no workflow item. A retry later than the tolerance window, or two copies
arriving at the same moment, can still start a second execution: check `metadata.event_id` in the
workflow where a duplicate would matter.

### The signing secret

The trigger keeps the endpoint's signing secret in the workflow's static data. Anyone who can
read the workflow, including through the n8n public API, which returns a workflow's static data,
can read the secret and forge deliveries to this trigger. Limit who can read the workflow;
deactivating and activating it again registers a new endpoint with a new secret.

## Example

1. **LetzCloud > Instance > Change State** with **Action** `start`.
2. **LetzCloud > Instance > Wait for State** with the same **VM ID** and **State** `Running`.
3. Continue with the started instance, for example to send its IP address on.

## Development

```bash
npm install
npm run guard            # hard limits of a verified community node
npm run generate:check   # generated operations match openapi/letzcloud.openapi.json
npm run lint             # n8n-node lint, strict mode
npm run build
npm test                 # runs against dist/, so build first
```

The operations in `nodes/LetzCloud/generated/operations.ts` are generated from
`openapi/letzcloud.openapi.json` and `openapi/scope.manifest.json` by
`../../tools/generate-operations.mjs`. Change the manifest or the OpenAPI document, then run
`npm run generate`. The two wait operations are code in `nodes/LetzCloud/shared/wait.ts`; the
manifest lists them so that the generator checks the routes they read.

## License

[MIT](../../LICENSE)
