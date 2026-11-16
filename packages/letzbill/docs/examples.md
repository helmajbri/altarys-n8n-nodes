# LetzBill example workflows

These example workflows show practical uses of the LetzBill nodes that you can import into n8n and adapt.

They're for cloud providers' staff. Each one starts with a sticky note that explains it and has a note for each section. The values you change are in a **Settings** node, and each example handles the case where a LetzBill call fails.

## Import an example

1. Download the JSON file of the example.
2. In n8n, open a new workflow, open the workflow menu, and select **Import** > **From file**.
3. Follow the steps in the workflow's sticky note: select your credentials and change the values in **Settings**.

The examples contain no credentials, IDs, or addresses of your own. n8n asks you to select a credential in each node that needs one.

Each example needs the `@altarys/n8n-nodes-letzbill` package, version 0.1.0 or later. See [Installation](../README.md#installation). The examples are built for n8n 2.47.7 and haven't been run on a live n8n instance yet.

## Notify the billing team when an invoice payment fails

File: [`notify-failed-invoice-payment.json`](../examples/notify-failed-invoice-payment.json)

When a payment attempt on an invoice is refused, the workflow reads the invoice and emails its number, customer, and amount to your billing team.

- **Starts with:** the **LetzBill Trigger** on `invoice.payment_failed`.
- **Needs:** a LetzBill API key with **Read**, **Write**, and **Delete** for webhooks and **Read** for invoices, and an SMTP credential for the email nodes. Your n8n instance must be reachable from LetzBill, as described in [LetzBill Trigger](trigger.md#what-your-n8n-instance-needs).
- **When something fails:** **Get invoice** retries three times. If it still fails, the second email tells the team which event couldn't be handled.
- **Amounts:** the email divides amounts by 100, which is right for two-decimal currencies such as EUR. See [Concepts](concepts.md#amounts-are-whole-numbers-in-minor-units) for other currencies.

## Email a weekly report of overdue invoices

File: [`weekly-overdue-invoices-report.json`](../examples/weekly-overdue-invoices-report.json)

Every Monday at 8:00, the workflow reads all overdue invoices, writes them to a CSV file, and emails the file. **Report columns** divides amounts in minor units by 100, which is right for two-decimal currencies such as EUR. See [Concepts](concepts.md#amounts-are-whole-numbers-in-minor-units) for other currencies.

- **Starts with:** a **Schedule Trigger**.
- **Needs:** a LetzBill API key with **Read** for invoices, and an SMTP credential.
- **When something fails:** if LetzBill can't be read, **Stop and Error** fails the execution, so it shows as failed in the list of executions. When no invoice is overdue, the workflow sends no email.

## Send each finalized invoice PDF to the accounting mailbox

File: [`email-finalized-invoice-pdf.json`](../examples/email-finalized-invoice-pdf.json)

When LetzBill finalizes an invoice, the workflow downloads its PDF and emails it to your accounting mailbox.

- **Starts with:** the **LetzBill Trigger** on `invoice.finalized`.
- **Needs:** a LetzBill API key with **Read**, **Write**, and **Delete** for webhooks and **Read** for invoices, and an SMTP credential.
- **When something fails:** the download retries three times. If it still fails, the second email names the invoice, so someone can send it by hand.

## Related pages

- [Getting started](getting-started.md)
- [Operations reference](operations.md)
- [Troubleshooting](troubleshooting.md)
