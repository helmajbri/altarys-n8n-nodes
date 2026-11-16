# LetzCloud credentials

Use the **LetzCloud API** credential to connect the **LetzCloud** and **LetzCloud Trigger** nodes to your LetzCloud account.

This page is for cloud providers' staff and for customers of a cloud provider. The kind of key decides what the nodes can do.

## Prerequisites

- **Cloud providers' staff:** access to **Administration** in your LetzCloud console, with the right to create API keys.
- **Customers of a cloud provider:** access to **Configuration** in your LetzCloud console. See [Customer keys](#customer-keys).
- A self-hosted n8n instance with the `@altarys/n8n-nodes-letzcloud` package installed.

## Supported authentication methods

- Service-account key. The nodes send it as a bearer token in the `Authorization` header of each request. Only service-account keys work: they start with `bff_sa_`.

## Credential fields

| Field | What to enter |
|---|---|
| **LetzCloud URL** | The address you open your LetzCloud console at, without `/api/v1`, for example `https://cloud.example.com`. It must start with `https://`. |
| **API Key** | A LetzCloud service-account key. It starts with `bff_sa_`. |

## Provider keys and customer keys

- A **provider key** belongs to the organization of a cloud provider. It can use every operation its permissions allow, across the organization.
- A **customer key** belongs to one customer of a cloud provider. It can list, read, start, stop, reboot, and delete that customer's instances, read the customer's invoices, usage, and wallet, and receive the customer's events in the trigger. LetzCloud refuses every other operation for a customer key.

A key can never see another customer's resources. LetzCloud decides what each key can do; the nodes show every operation and explain a refusal.

## Create a provider key

1. In the console, open **Administration**.
2. Under **Identity & access**, select **API keys & webhooks**.
3. On the **API keys** tab, select **Generate key**.
4. In **Name**, enter a name that tells you where the key is used, such as `n8n-automation`.
5. In **Type**, keep **Organization**.
6. In **Scopes**, enter the permissions the key needs, separated by commas or new lines, for example `vm:read`. The [permissions section](#choose-the-permissions) lists what each node needs.
7. Select **Generate key**.
8. In **Key generated**, copy the key and store it in a safe place. The console shows it only once.

A key can't do more than the person who created it may do.

## Customer keys

Customers of a cloud provider create their own key in the LetzCloud console.

1. In the console, open **Configuration**, then **API tokens**.
2. Select **New token**.
3. In **Name**, enter a name that tells you where the key is used, such as `n8n-invoices`.
4. Under **Permissions**, select what the key may do. The list groups permissions by area, such as **Virtual machines**, **Usage and billing**, or **Monitoring**, with actions such as **View** and **Change**. The table below says which ones each node needs.
5. Select **Create**.
6. In **Copy your API key now**, select **Copy** and store the key in a safe place, then select **Done**. The console shows the key only once.

| You use | Permission | In the console |
|---|---|---|
| The credential test, **Get instance**, **Get many instances**, **Wait for instance state** | `vm:read` | **Virtual machines**, **View** |
| **Change instance state** | `vm:update` | **Virtual machines**, **Change** |
| **Delete instance** | `vm:delete` | **Virtual machines**, **Delete** |
| **Get many invoices**, **Get usage**, **Get wallet** | `usage_billing:read` | **Usage and billing**, **View** |
| **LetzCloud Trigger** with **Subscribe As** set to **Customer** | `monitoring:read` and `monitoring:write` | **Monitoring**, **View** and **Change** |

Two limits apply to a customer key:

- It reaches only the operations your cloud provider offers to customer keys, as the console says when you create it. Those are the operations in the table above. LetzCloud refuses any other operation with `A customer key cannot use this operation`, even when the key holds a matching permission.
- You can give a key only the permissions you hold yourself. If the list doesn't show one you need, ask an owner or administrator of your account.

## Add the credential in n8n

1. In a **LetzCloud** or **LetzCloud Trigger** node, select **Create new credential** in the credential field.
2. Enter the **LetzCloud URL** and the **API Key**.
3. Save the credential. n8n tests it in two steps and shows **Connection tested successfully** when both work:
   1. It reads a public address of your LetzCloud console, without the key, to check that the address answers as LetzCloud.
   2. It lists one instance with the key. This needs the `vm:read` permission.

A key without `vm:read` fails the test, but you can still save the credential and use it for the operations its permissions allow.

Before any request, the credential refuses a **LetzCloud URL** that starts with `http://`, or an address that doesn't answer as LetzCloud. In both cases, the key isn't sent.

## Choose the permissions

Give a key only the permissions your workflows need. When a key lacks a permission, the node names it in its message, for example `vm:read`. See [Troubleshooting](troubleshooting.md#the-api-key-may-not-do-this).

| You use | The key needs |
|---|---|
| The credential test, **Get instance**, **Get many instances** | `vm:read` |
| **Wait Until Running** for a Kubernetes cluster | `async_job:read`, and the permission to read clusters |
| **Get many invoices**, **Get usage**, **Get wallet** | a customer key with `usage_billing:read` |
| **LetzCloud Trigger**, **Subscribe As** **Provider** | a provider key with `infrastructure:admin` |
| **LetzCloud Trigger**, **Subscribe As** **Customer** | a customer key with `monitoring:read` and `monitoring:write` |

Other operations need the permission for their resource and action. Add it to **Scopes** when the node names it.

## Replace a key

Replace a key before it expires, or at once if it might have been seen by someone else.

1. On the **API keys** tab, open the actions of the key and rotate it. The old key keeps working during the overlap period that your organization configured, so your workflows keep running.
2. Copy the new key, then open the credential in n8n and paste it into **API Key**.
3. Save the credential.

To stop a key at once, disable it in its actions. Disabling revokes every key of that service account.

## Related resources

- [Getting started](getting-started.md)
- [LetzCloud Trigger](trigger.md): how deliveries are signed and checked
- [n8n credentials documentation](https://docs.n8n.io/credentials/)
