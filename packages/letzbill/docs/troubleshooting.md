# Troubleshooting the LetzBill nodes

This page lists every message the LetzBill nodes show, what causes it, and how to fix it.

Messages about one item end with `[Item <n>]`, the position of the item in the node's input, counted from 0. Values in angle brackets, such as `<status>`, stand for the value in your message.

## Credential and connection messages

### The API URL doesn't start with HTTPS

`The LetzBill API URL must start with 'https://'. The API key was not sent: over plain 'http://' it could be read and reused. Use the 'https://' address of the LetzBill API.`

`The LetzBill credential's API URL must start with https://`

**Cause:** the **API URL** of the credential starts with `http://` or has no scheme. The nodes never send the key over an unencrypted connection.

**Fix:** open the credential and enter the `https://` address of the LetzBill API. See [Find the API URL](credentials.md#find-the-api-url).

### LetzBill didn't accept the key

`LetzBill did not accept the API key`

**Cause:** the key is wrong, was revoked, or has expired, or the **API URL** points at another LetzBill address.

**Fix:** check both fields of the credential. If the key was revoked or expired, create a new one and paste it into **API Key**. See [Create a LetzBill API key](credentials.md#create-a-letzbill-api-key).

### The API key may not do this

`The LetzBill API key may not do this`

**Cause:** the key lacks the permission this operation needs. When LetzBill names the permission, the message says which one, for example `invoice:write`.

**Fix:** on the **API keys** page, open the key's actions, select **Edit permissions**, and turn on the mode the message names. Or use a key that has it. See [Choose the permissions](credentials.md#choose-the-permissions).

## Plan and account messages

### Your plan doesn't include the feature

`Your LetzBill plan does not include this feature`

**Cause:** the operation uses a feature that your LetzBill plan doesn't include. The message names the feature and your current plan.

**Fix:** upgrade the plan, or ask the owner of your account to. The message includes the upgrade address when LetzBill gives one.

### You reached a plan limit

`Your LetzBill plan limit is reached`

**Cause:** your plan allows no more of what the operation creates, such as customers or webhook endpoints.

**Fix:** remove records you no longer use, or upgrade the plan.

### Your organization is restricted

`The LetzBill organization is restricted`

**Cause:** your organization can't use this operation in its current state, for example while a payment is overdue.

**Fix:** contact the owner of your LetzBill account.

## Request messages

### No record has that ID

`LetzBill found no record with that ID`

**Cause:** no record has this ID, or it belongs to another organization than the key.

**Fix:** check the ID, for example by reading it from a **Get Many** operation. Make sure the credential's key belongs to the organization that owns the record.

### The record's state doesn't allow the operation

`LetzBill refused the request in the current state of the record`

**Cause:** the record isn't in a state that allows the operation, for example voiding an invoice that's still a draft.

**Fix:** read the record again, and run the operation once its state allows it. The message explains the state when LetzBill gives a reason.

### LetzBill rejected the input

LetzBill rejected the input

**Cause:** one or more fields are missing or have a value LetzBill doesn't accept. The message names each field and the reason.

**Fix:** correct the fields the message names. The [operations reference](operations.md) lists the fields of each operation.

### Another answer from LetzBill

`LetzBill answered with status <status>`

**Cause:** LetzBill answered with an error the node doesn't recognize, or was unavailable for a moment.

**Fix:** run the node again later. Turn on **Retry On Fail** in the node's settings to retry on its own. If the message persists, contact LetzBill support with the time of the execution.

### An amount isn't a whole number

`'<field>' must be a whole number of minor units`

**Cause:** an amount field holds a decimal number, such as `12.5`, or text.

**Fix:** send the amount in the smallest unit of its currency: `1250` for 12.50 EUR. In an expression, convert with `{{ Math.round($json.price * 100) }}`. See [Amounts](concepts.md#amounts-are-whole-numbers-in-minor-units).

### The idempotency key has other characters

`'Idempotency Key' can only hold letters, digits and _ . : -`

**Cause:** **Idempotency Key** holds a space or another character LetzBill doesn't accept, or is longer than 255 characters.

**Fix:** use only letters, digits, and `_ . : -`, at most 255 of them, or leave the field empty so the node makes a key.

### An ID isn't a LetzBill ID

`'<parameter>' must be a LetzBill ID (a UUID)`

**Cause:** the ID field doesn't hold a LetzBill ID. LetzBill IDs look like `3f2b8c1e-5d4a-4f6b-9c2d-1a2b3c4d5e6f`.

**Fix:** map the `id` field of an earlier LetzBill node, or copy the ID from the console. To find a record by your own ID, use a **Get by External ID** operation.

### An ID has a slash or is empty

`'<parameter>' must be an ID, not empty, '.', '..' or a path`

**Cause:** the ID is empty, is `.` or `..`, or contains a slash or a backslash.

**Fix:** use the ID exactly as LetzBill or your own system shows it.

### A list repeats a page

`LetzBill returned page <page> with the same items as page <previous>`

**Cause:** with **Return All** on, LetzBill sent the same page twice, so reading on wouldn't end.

**Fix:** turn off **Return All** and set **Limit**, or narrow the **Filters**.

### A list is too long

`LetzBill still had full pages after <pages> pages`

**Cause:** with **Return All** on, the list still had more pages after 10,000 pages.

**Fix:** turn off **Return All** and set **Limit**, or narrow the **Filters**, for example to one month.

## Trigger messages

### The webhook was registered without a secret

`LetzBill registered the webhook without returning its signing secret`

**Cause:** when you published the workflow, LetzBill didn't return the secret that signs deliveries. Without it, the trigger can't check deliveries, so it removed the endpoint again.

**Fix:** publish the workflow again. If the message repeats, contact LetzBill support.

### A delivery was dropped

`LetzBill Trigger dropped a delivery: <reason>`

This message is in n8n's log, not in an execution: a dropped delivery starts no execution. The reason is one of these:

| Reason | Cause | Fix |
|---|---|---|
| `no_secret` | The trigger has no signing secret, for example after the workflow was copied. | Unpublish the workflow and publish it again. |
| `bad_tolerance` | **Timestamp Tolerance (Seconds)** isn't a number from 1 to 900. | Set a value from 1 to 900. |
| `missing_parameters` | The delivery has no signature or no time. It didn't come from LetzBill. | No action needed. |
| `bad_timestamp` | The time in the delivery isn't valid. | No action needed if you didn't send it. |
| `timestamp_outside_tolerance` | The delivery is older or newer than the tolerance allows. | Check that your n8n server's clock is right, or raise the tolerance. |
| `signature_mismatch` | The signature doesn't match: the delivery was changed, wasn't sent by LetzBill, or was signed with an old secret. | If real events are dropped, unpublish the workflow and publish it again. |

## Related pages

- [Credentials](credentials.md)
- [Concepts](concepts.md)
- [LetzBill Trigger](trigger.md)
