# @altarys/n8n-nodes-letzbill

n8n community nodes for LetzBill billing:

- **LetzBill**: manage customers, subscriptions, invoices, credit notes, payments, wallets,
  usage events and webhook endpoints. It can also be used as a tool by an n8n AI agent.
- **LetzBill Trigger**: start a workflow when LetzBill sends a webhook event. Every delivery is
  checked against its signature before the workflow runs.

Built against n8n 2.47.7 (`n8n-workflow` 2.47.2).

## Installation

In n8n, open **Settings > Community Nodes**, select **Install**, and enter
`@altarys/n8n-nodes-letzbill`. See the n8n documentation on
[installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

Create a **LetzBill API** credential with:

| Field | Value |
|---|---|
| API URL | The address of your LetzBill API, without `/api/v1`, for example `https://billing.example.com` |
| API Key | A LetzBill API key. Keys start with `fb_`. |

The key is sent as `Authorization: Bearer <key>`. Give the key only the permissions your
workflows need: each operation needs one permission, for example `customer:read` to get
customers or `invoice:write` to send an invoice. The trigger needs `webhook:read`,
`webhook:write` and `webhook:delete`.

The credential test reads the list of webhook event types, so it needs `webhook:read`. A key
without that permission fails the test, but you can still save the credential and use it for the
operations it is allowed to run.

## LetzBill node

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

Operations that cannot be undone (Delete, Void, Terminate, Refund) are separate operations, and
their descriptions say what they do.

### Amounts

Every amount is an integer in the minor unit of its currency, with the currency beside it:
`total_amount_cents: 1250` with `currency: "EUR"` means 12.50 EUR. The node refuses to send an
amount that is not a whole number, and leaves out of its output the few figures LetzBill also
returns in other units (for example a wallet's `rate_amount`, which duplicates
`rate_amount_cents`). Wallet credits are counts of credits, not money, and are sent as decimal
text such as `10.5`.

### Get Many

**Return All** reads every page; otherwise **Limit** sets how many results to return.

### Retries

- **Invoice > Send** and **Credit Note > Create** send an `Idempotency-Key` header, and
  **Payment > Refund** sends an idempotency key in its body. LetzBill answers a repeated request
  with the same key with the first result instead of acting twice. Set **Idempotency Key** to a
  value from your own data to make retries across executions safe; left empty, the node derives a
  key from the workflow, the execution and the item.
- **Usage Event > Create** and **Create Batch** are recorded once per transaction ID. Use an ID
  from your own data, never a random value, so that a retry is not counted twice.
- Other operations have no idempotency key in LetzBill. Before a Create, use **Get by External
  ID** where it exists to check whether the record is already there.

### Refusals

When LetzBill refuses a request the node says why: an operation your plan does not include
(with the upgrade path), a plan limit, a permission the API key lacks, a restricted
organization, a record that does not exist, or the fields LetzBill rejected.

## LetzBill Trigger

Choose the events to listen to; the list comes from your LetzBill instance. When the workflow is
activated, the trigger registers a webhook endpoint in LetzBill for those events and keeps its
signing secret; when the workflow is deactivated, it removes the endpoint. Activating again does
not add a second endpoint.

Each delivery carries `X-Webhook-Timestamp` and `X-Webhook-Signature-V2`, the HMAC-SHA256 of
`{timestamp}.{raw body}` with the endpoint secret. The trigger drops a delivery whose signature
does not match, or whose timestamp is further from the n8n clock than **Timestamp Tolerance
(Seconds)** (300 by default). A dropped delivery starts no workflow.

LetzBill delivers each event at least once. Use `metadata.event_id` in the payload to recognise
a repeated delivery.

The n8n instance must be reachable from LetzBill at its webhook URL.

## Example

1. **LetzBill Trigger** on `invoice.paid`.
2. **LetzBill > Invoice > Download PDF** with **Invoice ID** set to the invoice ID from the event.
3. Send the PDF on with any n8n node, for example an email node.

## Development

```bash
npm install
npm run guard            # hard limits of a verified community node
npm run generate:check   # generated operations match openapi/letzbill.openapi.json
npm run lint             # n8n-node lint, strict mode
npm run build
npm test                 # runs against dist/, so build first
```

The operations in `nodes/LetzBill/generated/operations.ts` are generated from
`openapi/letzbill.openapi.json` and `openapi/scope.manifest.json` by
`../../tools/generate-operations.mjs`. Change the manifest or the OpenAPI document, then run
`npm run generate`.

## License

[MIT](../../LICENSE)
