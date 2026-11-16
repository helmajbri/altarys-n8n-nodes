# Troubleshooting the LetzCloud nodes

This page lists every message the LetzCloud nodes show, what causes it, and how to fix it.

Messages about one item end with `[Item <n>]`, the position of the item in the node's input, counted from 0. Values in angle brackets, such as `<status>`, stand for the value in your message.

## Credential and connection messages

### The address doesn't start with HTTPS

`The LetzCloud URL must start with 'https://'. The API key was not sent: over plain 'http://' it could be read and reused.`

`The LetzCloud credential's URL must start with 'https://'`

**Cause:** the **LetzCloud URL** of the credential starts with `http://` or has no scheme. The nodes never send the key over an unencrypted connection.

**Fix:** open the credential and enter the `https://` address of your LetzCloud console.

### Nothing answers at the address

`No LetzCloud server answered at <address>. Check the LetzCloud URL: it is the address of your cloud console (for example https://cloud.example.com). The API key was not sent.`

**Cause:** n8n couldn't reach the address, or the address doesn't belong to LetzCloud. The key wasn't sent.

**Fix:** check the **LetzCloud URL**: it's the address you open the LetzCloud console at, without `/api/v1`. Check that your n8n server can reach it, for example through your firewall.

### The address answers, but isn't LetzCloud

`<address> answered, but not as a LetzCloud server. Check the LetzCloud URL. The API key was not sent.`

**Cause:** a server answered at the address, but not as LetzCloud, for example a web page in front of it. The key wasn't sent.

**Fix:** enter the address of your LetzCloud console itself. Customers get it from their cloud provider.

### LetzCloud didn't accept the key

`LetzCloud did not accept the API key. Check that it is a LetzCloud service-account key (it starts with bff_sa_) and that it has not been revoked.`

`LetzCloud did not accept the API key`

**Cause:** the key is wrong, was revoked or disabled, or has expired. Only service-account keys work; they start with `bff_sa_`.

**Fix:** paste a valid service-account key into **API Key**. See [Credentials](credentials.md).

### The key can't list instances

`LetzCloud accepted the API key, but the key may not list instances (the 'vm:read' permission). It can still be used for the operations it has permissions for.`

**Cause:** the credential test lists one instance, which needs `vm:read`, and the key doesn't have it.

**Fix:** you can save the credential anyway and use it for the operations the key may run. To pass the test, add `vm:read` to the key's scopes.

### The API key may not do this

`The LetzCloud API key may not do this`

**Cause:** the key lacks the permission this operation needs. When LetzCloud names the permission, the message says which one, for example `vm:read`.

**Fix:** add the permission to the key's **Scopes**, or use a key that has it. See [Choose the permissions](credentials.md#choose-the-permissions).

## Key type messages

### A customer key can't use the operation

`A customer key cannot use this operation`

**Cause:** a customer key can read and manage its instances, read its invoices, usage, and wallet, and manage its webhooks. LetzCloud refuses every other operation for a customer key.

**Fix:** use a provider key for this operation.

### The operation needs a provider key

`Only a provider key can use this operation`

**Cause:** the operation changes something that belongs to the whole provider organization.

**Fix:** use a key issued to the provider organization, not to one of its customers.

### The operation needs a customer key

`Only a customer key can use this operation`

**Cause:** the operation reads or changes what belongs to one customer, such as **Get usage**. A provider key isn't tied to a customer.

**Fix:** use a key issued to that customer.

## Plan and account messages

### Your plan doesn't include the feature

`Your LetzCloud plan does not include this feature`

**Cause:** the operation uses a feature your plan doesn't include. The message names the feature and your current plan.

**Fix:** upgrade the plan with your cloud provider, or ask the owner of your account to.

### You reached a plan limit

`Your LetzCloud plan limit is reached`

**Cause:** your plan allows no more of what the operation creates.

**Fix:** remove resources you no longer use, or upgrade the plan with your cloud provider.

### LetzCloud couldn't read your plan

`LetzCloud could not read your plan just now`

**Cause:** LetzCloud couldn't check your plan at that moment. Nothing was changed.

**Fix:** retry in a few minutes. Turn on **Retry On Fail** in the node's settings to retry on its own. If the message persists, contact your cloud provider.

### Your account is restricted

`The LetzCloud account is restricted`

**Cause:** your account can't use this operation in its current state, for example while a payment is overdue.

**Fix:** contact your cloud provider.

### Your account isn't verified yet

`The LetzCloud account must be verified first`

**Cause:** the operation needs a verified account.

**Fix:** complete the verification in the LetzCloud console.

### Billing isn't set up yet

`Billing is not set up for this LetzCloud account yet`

**Cause:** the account's billing isn't ready, so LetzCloud can't run operations that cost money or read billing data.

**Fix:** ask your cloud provider to finish setting up billing for the account.

## Request messages

### No record has that ID

`LetzCloud found no record with that ID`

**Cause:** no record has this ID, or it belongs to another organization or customer than the key.

**Fix:** check the ID, for example by reading it from a **Get Many** operation.

### The current state doesn't allow the operation

`LetzCloud refused the request in the current state`

**Cause:** the resource isn't in a state that allows the operation, for example stopping an instance that's already stopped.

**Fix:** read the resource again, and run the operation once its state allows it.

### LetzCloud rejected the input

`LetzCloud rejected the input`

**Cause:** one or more fields are missing or have a value LetzCloud doesn't accept. The message names each field and the reason.

**Fix:** correct the fields the message names. The [operations reference](operations.md) lists the fields of each operation.

### Another answer from LetzCloud

`LetzCloud answered with status <status>`

**Cause:** LetzCloud answered with an error the node doesn't recognize, or was unavailable for a moment.

**Fix:** run the node again later, or turn on **Retry On Fail**. If the message persists, contact your cloud provider with the time of the execution.

### An ID isn't a LetzCloud ID

`'<parameter>' must be a LetzCloud ID (a UUID)`

`'VM ID' must be a LetzCloud ID (a UUID)`

**Cause:** the ID field doesn't hold a LetzCloud ID. LetzCloud IDs look like `3f2b8c1e-5d4a-4f6b-9c2d-1a2b3c4d5e6f`.

**Fix:** map the `id` field of an earlier LetzCloud node, such as **Get many instances**.

### An ID has a slash or is empty

`'<parameter>' must be an ID, not empty, '.', '..' or a path`

**Cause:** the ID is empty, is `.` or `..`, or contains a slash or a backslash.

**Fix:** use the ID exactly as LetzCloud shows it.

### A list repeats a page

`LetzCloud returned page <page> with the same items as page <previous>`

**Cause:** with **Return All** on, LetzCloud sent the same page twice, so reading on wouldn't end.

**Fix:** turn off **Return All** and set **Limit**, or narrow the **Filters**.

### A list is too long

`LetzCloud still had full pages after <pages> pages`

**Cause:** with **Return All** on, the list still had more pages after 10,000 pages.

**Fix:** turn off **Return All** and set **Limit**, or narrow the **Filters**.

## Wait messages

These messages come from **Wait for instance state** and **Wait until kubernetes cluster is running**.

### The wait ran out of time

`Still not ready after <seconds> seconds: <detail>`

**Cause:** the resource didn't reach the state in **Time Limit (Seconds)**. The detail says what the last read found, for example `the instance is Starting` or `the create job is still running`.

**Fix:** raise **Time Limit (Seconds)**, or check the resource in the LetzCloud console.

### The execution has waited long enough

`This execution has already waited <seconds> seconds over its items`

**Cause:** one execution waits at most 7,200 seconds over all its items, and that time is used up.

**Fix:** send fewer items to one wait, or wait for them in separate executions.

### The instance won't reach the state

`The instance is <state>, so it will not become <target>`

**Cause:** the instance is in a state it can't leave on its own, such as `Error`, `Destroyed`, or `Expunging`.

**Fix:** check the instance in the LetzCloud console.

### The state to wait for isn't valid

`'State' must be Running or Stopped`

**Cause:** **State** holds another value, for example from an expression.

**Fix:** set **State** to **Running** or **Stopped**.

### The job ID is missing or not valid

`'Job ID' must be the job_id a Create answered with`

**Cause:** **Job ID** is empty or isn't a job ID.

**Fix:** map the `job_id` field of the **Create kubernetes cluster** output into **Job ID**.

### The create job didn't succeed

`The create job <outcome>`

**Cause:** the job that creates the cluster failed or was cancelled. The message includes the reason LetzCloud gave.

**Fix:** check the cluster's settings and your plan, then create the cluster again.

### The create job doesn't name the cluster

`The create job finished but does not name the cluster it made`

**Cause:** the job finished, but its result has no cluster ID, so the wait can't tell which cluster to follow.

**Fix:** find the new cluster with **Get many kubernetes clusters**, then use **Get kubernetes cluster** on its ID.

### LetzCloud answered with another cluster

`LetzCloud answered with another cluster than '<id>'`

**Cause:** the cluster LetzCloud returned isn't the one the job created. The wait stops, so it never reports another cluster as ready.

**Fix:** check the cluster in the LetzCloud console, and run the workflow again.

### The cluster won't become Running

`The cluster is <state>, so it will not become Running`

**Cause:** the cluster is in the `Error`, `Destroying`, or `Destroyed` state.

**Fix:** check the cluster in the LetzCloud console.

## Trigger messages

### n8n's webhook URL isn't HTTPS

`LetzCloud only delivers to 'https://' webhook URLs`

**Cause:** the workflow's webhook URL starts with `http://`. LetzCloud sends events only to `https://` addresses.

**Fix:** serve n8n over HTTPS. Behind a reverse proxy, set `N8N_WEBHOOK_URL` to the public `https://` address of n8n. See [What your n8n instance needs](trigger.md#what-your-n8n-instance-needs).

### Some events aren't offered for the key

`LetzCloud does not send some of the chosen events`

**Cause:** the message names events your key can't subscribe to, for example a customer event with **Subscribe As** set to **Provider**.

**Fix:** choose the events again from the list in **Event Names or IDs**, which shows only the events your key may choose.

### Too many webhook endpoints

`LetzCloud lists more than <count> webhook endpoints`

**Cause:** the trigger looks for its own endpoint among all of your account's webhook endpoints, and there are more than it reads.

**Fix:** remove webhook endpoints that are no longer used, then publish the workflow again.

### The webhook was registered without a secret

`LetzCloud registered the webhook without returning its signing secret`

**Cause:** when you published the workflow, LetzCloud didn't return the secret that signs deliveries. Without it, the trigger can't check deliveries, so it removed the endpoint again.

**Fix:** publish the workflow again. If the message repeats, contact your cloud provider.

### A delivery was dropped

`LetzCloud Trigger dropped a delivery: <reason>`

This message is in n8n's log, not in an execution: a dropped delivery starts no execution. The reason is one of these:

| Reason | Cause | Fix |
|---|---|---|
| `no_secret` | The trigger has no signing secret, for example after the workflow was copied. | Unpublish the workflow and publish it again. |
| `bad_tolerance` | **Timestamp Tolerance (Seconds)** isn't a number from 1 to 900. | Set a value from 1 to 900. |
| `missing_parameters` | The delivery has no signature or no time. It didn't come from LetzCloud. | No action needed. |
| `bad_timestamp` | The time in the delivery isn't valid. | No action needed if you didn't send it. |
| `timestamp_outside_tolerance` | The delivery is older or newer than the tolerance allows. | Check that your n8n server's clock is right, or raise the tolerance. |
| `signature_mismatch` | The signature doesn't match: the delivery was changed, wasn't sent by LetzCloud, or was signed with an old secret. | If real events are dropped, unpublish the workflow and publish it again. |

## Related pages

- [Credentials](credentials.md)
- [Concepts](concepts.md)
- [LetzCloud Trigger](trigger.md)
