# LetzBill node concepts

This page explains the ideas behind the LetzBill nodes: amounts, retries, IDs, lists, and what an API key can do.

It's for cloud providers' staff who build workflows with the **LetzBill** and **LetzBill Trigger** nodes.

## Amounts are whole numbers in minor units

Every amount the nodes send or return is a whole number in the smallest unit of its currency, the minor unit, with the currency beside it. For the euro, the minor unit is the cent.

| Field | Value | Meaning |
|---|---|---|
| `total_amount_cents` | `1250` | 12.50 |
| `currency` | `"EUR"` | in euros |

How many minor units make one unit depends on the currency, as the ISO 4217 standard defines it:

| Currency | Decimal places | `1250` means | Convert with |
|---|---|---|---|
| EUR, USD, GBP, CHF | 2 | 12.50 | divide by 100 |
| JPY | 0 | 1,250 | use as is |
| KWD, BHD | 3 | 1.250 | divide by 1,000 |

In an n8n expression for a two-decimal currency: `{{ $json.total_amount_cents / 100 }}`. To send 12.50 EUR, enter `1250` in a field that ends with **(Minor Units)**. Workflows that divide by 100 are right only for two-decimal currencies.

The node refuses to send an amount that isn't a whole number, so `12.5` in a minor-unit field stops the node before anything is sent. LetzBill also returns some amounts in other units, such as a wallet's `rate_amount` beside `rate_amount_cents`. The node leaves those out of its output, so every amount you see has its currency beside it.

Wallet credits are a count of credits, not money. Fields such as credit amounts are decimal numbers written as text, for example `10.5`.

## Retries don't charge twice

n8n can run a node again, for example when you turn on **Retry On Fail** in the node's settings. Some LetzBill operations make sure that a retry has no second effect.

- **Send invoice**, **Create credit note**, and **Refund payment** send an idempotency key. LetzBill answers a repeat with the same key with the first result, instead of acting twice.
- Leave **Idempotency Key** empty, and the node makes a key from the workflow, the node, the execution, and the item. n8n's retries of the same item then reuse it.
- To make retries across executions safe too, set **Idempotency Key** to a value from your own data, such as an order number.
- **Create usage event** and **Create usage event batch** are recorded once per transaction ID. Use an ID from your own data, never a random value, so that a retry isn't counted twice.
- Other operations have no idempotency key. Before a create, use **Get customer by external ID** or **Get subscription by external ID** to check whether the record already exists.

## LetzBill IDs

LetzBill IDs, such as customer, invoice, and payment IDs, are UUIDs: 36 characters, like `3f2b8c1e-5d4a-4f6b-9c2d-1a2b3c4d5e6f`. The node checks an ID before it sends the request, and refuses anything else.

The IDs your own system gives, such as an external customer ID or a usage event's transaction ID, can be any text. The node refuses only an empty value, `.`, `..`, or text with a slash. Such values would point the request at another address.

## Lists: Return All and Limit

Operations named **Get Many** return one item per record.

- With **Return All** off, **Limit** sets how many records to return.
- With **Return All** on, the node reads every page until the last one. It stops with a message if LetzBill sends the same page twice, or still sends full pages after 10,000 pages.

Use the **Filters** of an operation to read only the records you need, for example invoices of one customer or invoices that are overdue.

## What an API key can do

A LetzBill API key acts for your organization, within the permissions you gave it. A key can't read or change another organization's data. Each operation needs the permission for its resource and action, and the node names a missing permission in its message.

If your LetzBill plan doesn't include a feature, or you've reached a plan limit, the node says so and tells you how to upgrade. See [Troubleshooting](troubleshooting.md).

## Operations that can't be undone

**Delete customer**, **Void invoice**, **Void credit note**, **Terminate subscription**, **Refund payment**, and **Delete webhook endpoint** are separate operations, and their descriptions say what they change. Test workflows that use them on test data first.

## Related pages

- [Operations reference](operations.md)
- [LetzBill Trigger](trigger.md)
- [Troubleshooting](troubleshooting.md)
