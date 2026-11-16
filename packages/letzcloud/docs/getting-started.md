# Getting started with the LetzCloud nodes

This tutorial takes you from an empty n8n workflow to a list of the instances in your LetzCloud account.

It's written for cloud providers' staff, with a provider key, and takes about 10 minutes. Customers of a cloud provider create a customer key with `vm:read` as described in [Customer keys](credentials.md#customer-keys), then continue at step 3.

## Before you begin

You need:

- A self-hosted n8n instance, version 2.47.7 or later, where you can install community nodes.
- Access to **Administration** in your LetzCloud console, with the right to create API keys.

## Step 1: Install the package

The package isn't on npm yet. You can follow this step once version 0.1.0 is published.

1. In n8n, open **Settings**, then **Community nodes**.
2. Open the install dialog and enter `@altarys/n8n-nodes-letzcloud` in **npm Package Name**.
3. Confirm that you understand the risks of installing community code, then select **Install**.

n8n's own guide to [installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/) describes the other ways to install a package.

## Step 2: Create a LetzCloud API key

1. In the console, open **Administration**, then **API keys & webhooks** under **Identity & access**.
2. On the **API keys** tab, select **Generate key**.
3. In **Name**, enter a name that tells you where the key is used, such as `n8n-instances`.
4. In **Type**, keep **Organization**.
5. In **Scopes**, enter `vm:read`. This permission lets the key list instances.
6. Select **Generate key**.
7. Copy the key and store it somewhere safe. The console shows it only once.

The key starts with `bff_sa_`. The [credentials guide](credentials.md) explains each field and the permissions other operations need.

## Step 3: Add the credential in n8n

1. In n8n, select **Create workflow**.
2. Add a **Manual Trigger** node, so you can start the workflow yourself.
3. Add a **LetzCloud** node after it, and choose the **Get many instances** action.
4. In the credential field of the node, select **Create new credential**.
5. In **LetzCloud URL**, enter the address you open your LetzCloud console at, for example `https://cloud.example.com`.
6. In **API Key**, paste the key from step 2.
7. Save the credential. n8n first checks that the address answers as LetzCloud, then lists one instance with the key, and shows **Connection tested successfully** when both work.

## Step 4: List your instances

1. In the **LetzCloud** node, keep **Return All** off and set **Limit** to `5`.
2. Select **Execute step**.

The output panel shows up to five instances, one item each, with fields such as `id`, `name`, `state`, and `zone_name`.

If the node shows a message instead, look it up in [Troubleshooting](troubleshooting.md).

## Next steps

- Start an instance and wait until it runs: see [Wait for a long-running change](concepts.md#wait-for-a-long-running-change).
- Start a workflow when an instance changes with the [LetzCloud Trigger](trigger.md).
- Import a ready-made workflow from the [examples](examples.md).
