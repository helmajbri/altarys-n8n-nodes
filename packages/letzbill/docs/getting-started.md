# Getting started with the LetzBill nodes

This tutorial takes you from an empty n8n workflow to a list of your latest LetzBill invoices.

It's for cloud providers' staff who bill their customers with LetzBill. It takes about 10 minutes.

## Before you begin

You need:

- A self-hosted n8n instance, version 2.47.7 or later, where you can install community nodes.
- Access to the LetzBill pages of your console, with the right to create API keys.

## Step 1: Install the package

The package isn't on npm yet. You can follow this step once version 0.1.0 is published.

1. In n8n, open **Settings**, then **Community nodes**.
2. Open the install dialog and enter `@altarys/n8n-nodes-letzbill` in **npm Package Name**.
3. Confirm that you understand the risks of installing community code, then select **Install**.

n8n's own guide to [installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/) describes the other ways to install a package.

## Step 2: Create a LetzBill API key

1. In the console, open **Billing**, then **Developers** > **API keys**.
2. Select **Create API key**.
3. In **Name**, enter a name that tells you where the key is used, such as `n8n invoices`.
4. Under **Permissions**, turn on **Read** for invoices and webhooks. For this tutorial, you don't need any other permission.
5. Select **Create**.
6. Select **Copy key**, store the key somewhere safe, tick **I have copied and stored this key securely.**, and select **Done**. The console never shows the key again.

The key starts with `fb_`. You also need the address of the LetzBill API: see [Find the API URL](credentials.md#find-the-api-url).

## Step 3: Add the credential in n8n

1. In n8n, select **Create workflow**.
2. Add a **Manual Trigger** node, so you can start the workflow yourself.
3. Add a **LetzBill** node after it, and choose the **Get many invoices** action.
4. In the credential field of the node, select **Create new credential**.
5. In **API URL**, enter the address of the LetzBill API without `/api/v1`, for example `https://billing.example.com`.
6. In **API Key**, paste the key from step 2.
7. Save the credential. n8n tests it and shows **Connection tested successfully** when the key works.

## Step 4: List your invoices

1. In the **LetzBill** node, keep **Return All** off and set **Limit** to `5`.
2. Select **Execute step**.

The output panel shows up to five invoices, one item each. Each invoice has its `invoice_number`, `status`, `currency`, and amounts such as `total_amount_cents`. Amounts are whole numbers in the smallest unit of the currency: `total_amount_cents: 1250` with `currency: "EUR"` means 12.50 EUR.

If the node shows a message instead, look it up in [Troubleshooting](troubleshooting.md).

## Next steps

- Start a workflow when an invoice is paid with the [LetzBill Trigger](trigger.md).
- Import a ready-made workflow from the [examples](examples.md).
- Read how amounts, retries, and long lists work in [Concepts](concepts.md).
