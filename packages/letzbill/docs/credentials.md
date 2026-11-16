# LetzBill credentials

Use the **LetzBill API** credential to connect the **LetzBill** and **LetzBill Trigger** nodes to your LetzBill account.

This page is for cloud providers' staff. Customers of a cloud provider don't use LetzBill API keys: they use the LetzCloud package instead.

## Prerequisites

- Access to the LetzBill pages of your console, with the right to create API keys. If the **API keys** page says that you don't have access, ask your administrator.
- A self-hosted n8n instance with the `@altarys/n8n-nodes-letzbill` package installed.

## Supported authentication methods

- API key. The nodes send it as a bearer token in the `Authorization` header of each request.

## Credential fields

| Field | What to enter |
|---|---|
| **API URL** | The address of the LetzBill API, without `/api/v1`, for example `https://billing.example.com`. It must start with `https://`. |
| **API Key** | A LetzBill API key. It starts with `fb_`. |

## Create a LetzBill API key

1. In the console, open **Billing**.
2. In the sidebar, under **Developers**, select **API keys**.
3. Select **Create API key**.
4. In **Name**, enter a name that tells you where the key is used, such as `n8n billing workflows`.
5. Optional: in **Expires on**, pick the last day the key works. Without a date, the key doesn't expire.
6. Under **Permissions**, choose what the key may do. Either turn on **Full access**, or turn on the modes, such as **Read**, **Write**, **Create**, or **Delete**, for each resource your workflows use. The [permissions section](#choose-the-permissions) lists what each node needs.
7. Select **Create**.
8. Select **Copy key** and store the key in a safe place. Tick **I have copied and stored this key securely.** and select **Done**. The console shows the key only once.

## Find the API URL

The **API URL** is the address your console uses to reach LetzBill, without `/api/v1`.

1. In the console, open **Billing**, then **Developers** > **Developer mode**.
2. Open the request drawer with the `</>` button in the header. The **API requests** drawer lists the calls the page made.
3. Select a call and open the **cURL** tab. The address in the command starts with the API URL, followed by `/api/v1`.

For example, if the command calls `https://billing.example.com/api/v1/invoices`, the **API URL** is `https://billing.example.com`.

## Add the credential in n8n

1. In a **LetzBill** or **LetzBill Trigger** node, select **Create new credential** in the credential field.
2. Enter the **API URL** and the **API Key**.
3. Save the credential. n8n tests it by reading the list of LetzBill webhook events, and shows **Connection tested successfully** when the key works.

The test needs the **Read** mode for webhooks. A key without it fails the test, but you can still save the credential and use it for the operations the key may run.

The credential refuses an **API URL** that starts with `http://`, before anything is sent, because the key travels with every request and could be read on the way.

## Choose the permissions

Give a key only the permissions your workflows need.

- **LetzBill node:** each operation needs the permission for its resource and action. For example, **Get many invoices** needs **Read** for invoices, and **Send invoice** needs **Send** for invoices. When a key lacks a permission, the node names it in its message. See [Troubleshooting](troubleshooting.md#the-api-key-may-not-do-this).
- **LetzBill Trigger node:** the **Read**, **Write**, and **Delete** modes for webhooks. The trigger uses them to register its webhook endpoint when you publish the workflow and to remove it when you unpublish it.

## Replace a key

Replace a key before it expires, or at once if it might have been seen by someone else.

1. On the **API keys** page, open the actions of the key and select **Rotate**. During the **Grace period (hours)** that you set, both the old and the new key work.
2. Copy the new key, then open the credential in n8n and paste it into **API Key**.
3. Save the credential.

To stop a key at once, select **Revoke** in its actions. Every workflow that uses it stops working until you give its credential a new key.

## Related resources

- [Getting started](getting-started.md)
- [LetzBill Trigger](trigger.md): how deliveries are signed and checked
- [n8n credentials documentation](https://docs.n8n.io/credentials/)
