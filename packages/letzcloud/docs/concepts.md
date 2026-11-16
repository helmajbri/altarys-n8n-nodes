# LetzCloud node concepts

This page explains the ideas behind the LetzCloud nodes: the two kinds of keys, waiting for long-running changes, amounts, retries, IDs, and lists.

It's for cloud providers' staff and customers of a cloud provider who build workflows with the **LetzCloud** and **LetzCloud Trigger** nodes.

## Provider keys and customer keys

Each tenant has its own appliance.

The same nodes work with two kinds of key, and LetzCloud decides what each one may do. The nodes don't hide operations: an operation a key may not use stops with a message that says which key it needs.

- A **provider key** belongs to the organization of a cloud provider. It can use every operation its permissions allow.
- A **customer key** belongs to one customer of a cloud provider. It can list, read, start, stop, reboot, and delete that customer's instances, read the customer's invoices, usage, and wallet, and receive the customer's events in the trigger.

**Get many invoices**, **Get usage**, and **Get wallet** read what belongs to the customer of the key, so they need a customer key. A provider key gets the message `Only a customer key can use this operation`.

## Wait for a long-running change

Creating an instance or a Kubernetes cluster, and starting, stopping, or rebooting an instance, take time. LetzCloud answers at once with a job, and carries on with the change. Two operations wait for the result:

- **Wait for instance state** reads an instance until it's **Running** or **Stopped**. Use it after **Change instance state**: **Running** after a start or a reboot, **Stopped** after a stop. It stops with a message if the instance is in the `Error`, `Destroyed`, or `Expunging` state instead.
- **Wait until kubernetes cluster is running** takes the **Job ID** that **Create kubernetes cluster** returned in its `job_id` field. It reads that job until it names the cluster it made, then reads that cluster until it's running. It never looks for a cluster by name, so another cluster with the same name is never mistaken for it. Its output is the cluster, plus a `wait` field that names the job and the cluster it followed.

Both operations read again every **Interval (Seconds)**, until **Time Limit (Seconds)** has passed, and then stop with a message. One execution waits at most 7,200 seconds in all: with several items, each item waits at most what's left of that time.

A typical sequence: **Change instance state** with **Action** set to **Start**, then **Wait for instance state** with the same **VM ID** and **State** set to **Running**.

## Amounts are whole numbers in minor units

Every amount the nodes return is a whole number in the smallest unit of its currency, the minor unit, with the currency beside it. For the euro, the minor unit is the cent: `amount_cents: 1250` with `currency: "EUR"` means 12.50 euros.

To convert, divide by 100 for currencies with two decimal places. In an n8n expression: `{{ $json.amount_cents / 100 }}`.

- In **Get usage**, the rows per plan and their charges take the currency of the whole report. The node copies it into each row, so every amount has its currency beside it. When LetzCloud can't name a currency, the rows get `currency: null`.
- **Get wallet** returns the balance as `{"amount": 2500, "currency": "EUR"}`, also in minor units.

## Retries can create twice

LetzCloud operations don't take an idempotency key. If n8n retries a create after a timeout, for example with **Retry On Fail**, the first attempt might already have created the resource. Before you retry a create, use **Get Many** with a name filter to check whether the resource exists.

## IDs

Most LetzCloud IDs are UUIDs: 36 characters, like `3f2b8c1e-5d4a-4f6b-9c2d-1a2b3c4d5e6f`. The node checks such an ID before it sends the request, and refuses anything else. Snapshot and Kubernetes cluster IDs are free text; the node refuses only an empty value, `.`, `..`, or text with a slash, because they would point the request at another address.

## Lists: Return All and Limit

Operations named **Get Many** return one item per record.

- With **Return All** off, **Limit** sets how many records to return.
- With **Return All** on, the node reads every page until the last one. It stops with a message if LetzCloud sends the same page twice, or still sends full pages after 10,000 pages.

Use the **Filters** of an operation, such as the **State** of instances, to read only the records you need.

## Operations that can't be undone

Every **Delete** operation is a separate operation, and its description says what it removes. Deleting an instance with **Expunge** on removes it at once, without the period during which it can be recovered. Test workflows that delete resources on test resources first.

## Related pages

- [Operations reference](operations.md)
- [LetzCloud Trigger](trigger.md)
- [Troubleshooting](troubleshooting.md)
