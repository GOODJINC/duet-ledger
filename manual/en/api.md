# REST API manual

[Manual home](index.md) · [MCP](mcp.md)

## Contents

- [Connection and authentication](#connection-and-authentication)
- [Using Postman](#using-postman)
- [Amounts and dates](#amounts-and-dates)
- [Permissions and endpoints](#permissions-and-endpoints)
- [Queries and statistics](#queries-and-statistics)
- [Create, update, delete and restore](#create-update-delete-and-restore)
- [Receipts](#receipts)
- [Errors, limits and operation](#errors-limits-and-operation)

## Connection and authentication

The base URL is `http://SERVER:18088/api/v1`. Use your actual HTTPS origin and port. Web UI routes under `/api/...` use cookies and are not external app-password endpoints.

1. An administrator enables API access in **Administration → API and MCP**.
2. Open **Account settings → API app passwords → Create app password**, choose a name, accounts and permissions.
3. Choose 30 days, 90 days, 1 year (365 days) or never. Verify your current password and second factor if enabled.
4. The secret is shown only once. Use a separate key for each connection and revoke it when no longer needed.

```http
Authorization: Bearer APP_PASSWORD
Content-Type: application/json
```

Do not use the sign-in password or Basic authentication. Never put keys in URLs, prompts, logs or Git. Use HTTPS on the public internet.

## Using Postman

Set `base_url` to `http://SERVER:18088` and `account_id` to an allowed account ID in a collection or environment. Select **Bearer Token** in Authorization and enter the app password. Do not save real keys in synchronized or shared collections or variables.

### Find an account

Send **GET** `{{base_url}}/api/v1/accounts`. Check `id`, `currency` and `scale`; copy the desired ID to `account_id`. The following sequence requires both read and create permissions.

### Create an expense

**POST** `{{base_url}}/api/v1/transactions`

Add and enable these rows in **Headers**, not Body or Params:

| Key             | Value               |
| --------------- | ------------------- |
| Content-Type    | application/json    |
| Idempotency-Key | example-expense-001 |

Select Body → raw → JSON:

```json
{
  "account_id": "{{account_id}}",
  "kind": "expense",
  "date": "2026-01-15",
  "time": "12:30",
  "amount": "12000",
  "title": "Lunch",
  "category": "food",
  "note": ""
}
```

Replace the dates, account ID and category with your own values. This example uses a KRW account. **This saves a real transaction immediately.** First creation returns `201` and `{"id":"TRANSACTION_ID"}`. Retrying identical input with the same key returns `200` and the same ID. Use a new `Idempotency-Key` for a new transaction.

### Monthly statistics

**GET** `{{base_url}}/api/v1/statistics`, with Params:

| Key              | Value          |
| ---------------- | -------------- |
| from             | 2026-01-01     |
| to               | 2026-01-31     |
| account          | {{account_id}} |
| display_currency | KRW            |

The response contains transaction `count`, `totals`, `categories` and `daily` totals. Set equal dates for a daily report. Omit `account` to include every account accessible to the key.

## Amounts and dates

| Field      | Convention                                                                              |
| ---------- | --------------------------------------------------------------------------------------- |
| Amounts    | **Integer strings in minor currency units**: KRW 1,000=`"1000"`; USD 12.34=`"1234"`     |
| `scale`    | Decimal digits: KRW/JPY/VND=0; USD/EUR/GBP/CNY/TWD=2; KWD=3                             |
| `date`     | `YYYY-MM-DD`, years 1900–2100                                                           |
| `time`     | 24-hour `HH:mm`; optional; recommended for new entries                                  |
| `timezone` | IANA time zone; defaults to the user's setting                                          |
| IDs        | Use identifiers returned by lookups. A transaction ID is an account-specific posting ID |

Send positive `amount` values for new income, expenses and transfers. Response `legs[].amount` represents account changes and is negative for expenses/withdrawals; do not copy it directly into create requests. Keep amounts as strings to avoid precision loss.

Foreign payments use `original_currency`, `original_amount` and `exchange_rate` together. The original amount uses its currency's minor units. The rate is account currency per one original currency unit; `amount` is the rounded account-currency result. Example: USD 20 paid on a KRW account at 1,400 KRW/USD uses `amount="28000"`, `original_currency="USD"`, `original_amount="2000"`, `exchange_rate="1400"`.

## Permissions and endpoints

Prefix every path with `/api/v1`.

| Method and path                    | Key permission    | Purpose                                       |
| ---------------------------------- | ----------------- | --------------------------------------------- |
| GET `/me`                          | Valid key         | User, time zone, currency and key permissions |
| GET `/accounts`                    | read              | Allowed accounts, currencies and balances     |
| GET `/categories`                  | read              | Account categories                            |
| GET `/transactions`                | read              | Transactions and totals for the query         |
| GET `/transactions/{id}`           | read              | One transaction and latest version            |
| GET `/statistics`                  | read              | Aggregates without transaction rows           |
| POST `/transactions`               | create            | Create a transaction                          |
| PUT `/transactions/{id}`           | update            | Replace transaction input                     |
| DELETE `/transactions/{id}`        | delete            | Move to trash                                 |
| POST `/transactions/{id}/restore`  | delete            | Restore from trash                            |
| POST `/transactions/{id}/receipts` | receipts          | Upload photo                                  |
| GET `/receipts/{id}`               | read              | Download photo                                |
| DELETE `/receipts/{id}`            | delete + receipts | Detach photo                                  |

Both key permissions and **current account sharing rights** must permit the action. A viewer cannot write even with a write-enabled key. New accounts are not added to existing keys automatically. Hidden transfer counterparts, balances and totals are not disclosed. Updating, deleting or restoring a transfer requires access and edit rights to both accounts.

Keys cannot create accounts or other keys, change users/sharing/server settings, or permanently delete transactions.

## Queries and statistics

`GET /me` returns user `id`, `name`, `timezone`, `default_currency`, app-password identity/expiry, `permissions` and `account_ids`. `GET /accounts` returns an array of allowed accounts.

Categories: `GET /categories?account=ACCOUNT_ID&kind=expense` or `kind=income`. Use the returned `code` in a transaction's `category`; do not substitute an arbitrary category name.

Returns shared category definitions configured for the ledger and legacy categories derived from the requested account’s transactions. Categories used only in other accounts’ transactions are excluded.

List/statistics query parameters:

| Parameter           | Meaning                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `from`, `to`        | Inclusive dates; defaults to the current month in the user's time zone         |
| `account`, `ledger` | Restrict to account or ledger ID                                               |
| `scope`             | `all`, `private`, `shared`                                                     |
| `type`              | Stored kind, e.g. `income`, `expense`, `transfer`                              |
| `search`            | Description, notes, category label, author name/username; up to 300 characters |
| `currency`          | Filter account currency, e.g. `USD`                                            |
| `display_currency`  | Convert totals with saved rates, e.g. `KRW`                                    |
| `trash`             | `true` to query trashed transactions                                           |
| `page`, `page_size` | Lists only: default page 1, 50 rows; page size 1–200                           |

`GET /transactions` returns `items`, `count`, `page`, `page_size`, `totals`, `categories`, `daily`. Use the transaction `version` for updates. `legs` contains account effects, categories and receipt IDs; `can_edit` reflects actual editing rights.

`GET /statistics` returns `count`, `totals`, `categories`, `daily`, `missing_currencies`. Aggregates cover the whole allowed query, independently of pagination. Without conversion, totals are separated by currency. Missing exchange rates exclude a currency from converted totals and are reported in `missing_currencies`. Rates are user-saved settings, not live market rates.

```json
{
  "count": 1,
  "totals": [
    { "currency": "KRW", "scale": 0, "income": "0", "expense": "12000" }
  ],
  "categories": [
    {
      "name": "식비",
      "currency": "KRW",
      "scale": 0,
      "category": "food",
      "amount": "12000"
    }
  ],
  "daily": [
    {
      "currency": "KRW",
      "scale": 0,
      "date": "2026-01-15",
      "income": "0",
      "expense": "12000"
    }
  ],
  "missing_currencies": []
}
```

Financial labels may contain Korean or other user data regardless of the interface language; do not translate or rewrite stored labels in your integration.

## Create, update, delete and restore

Creation input fields:

| Field                      | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `kind`                     | New entries: `expense`, `income`, `transfer`           |
| `account_id`               | Account or transfer source account                     |
| `date`, `time`, `timezone` | Date, time and time zone                               |
| `amount`, `title`          | Positive minor-unit amount and description             |
| `category`                 | Registered category code; use `transfer` for transfers |
| `note`, `target_note`      | Main/source note and destination-account note          |
| `to_id`                    | Transfer destination; same currency required           |
| Foreign-currency fields    | Original currency, amount and rate described above     |
| `ledger_id`                | Optional additional ledger-membership constraint       |

`Idempotency-Key` is required and limited to 128 bytes. Generate one per transaction. If a connection fails and the outcome is unknown, retry with **the same input and key**. Reusing a key for changed input returns `409`. Deduplication is scoped to the app password.

Updates use **PUT, not PATCH**. Fetch `GET /transactions/{id}` first. Submit the complete input plus its latest `version`; retain foreign-currency fields, notes and categories you want to keep. A successful update returns `200`, an `id` and account-specific `posting_ids`. Fetch again for the new version.

Delete and restore take Body → raw → JSON:

```json
{ "version": 1 }
```

The number is an example. After deletion, fetch the trashed transaction again to obtain its new version before restoration. Concurrent changes return `409`; review the newest data instead of guessing a higher version.

## Receipts

Send **POST** `/transactions/{POSTING_ID}/receipts` with Body → **form-data**. Use a key named `file`, change its type to **File** and select a photo. Disable any manually set `Content-Type: application/json` header for this request; Postman generates the multipart boundary.

JPG/PNG photos are limited to 5MB and 16 megapixels. Storage normalizes them to JPEG and removes metadata. The `201` response contains `id`, `size`, `media_type`.

`GET /receipts/{id}` returns an image, not JSON. Save it using Postman's response download feature. `DELETE /receipts/{id}` removes the attachment and requires both delete and receipts permissions. **No separate attachment-restore API is provided.**

## Errors, limits and operation

```json
{ "error": "invalid", "message": "Check your input." }
```

Branch on `error` codes, not translated `message` text. Use `Accept-Language: en` or `ko` to request an error language. Without the header, authenticated requests follow the user's language.

| HTTP status | Check                                                                   |
| ----------- | ----------------------------------------------------------------------- |
| 400         | JSON, fields, category, amount, Idempotency-Key                         |
| 401         | Incorrect, expired or revoked Bearer key                                |
| 403         | Administrator disabled API, insufficient key permission or sharing role |
| 404         | Item not found in the allowed scope                                     |
| 409         | Version conflict or changed input with the same creation key            |
| 429         | Rate limit; respect `Retry-After`                                       |
| 500         | Server status; retry creation with identical input and key              |

Business API calls allow 120 requests per minute per valid key. Ordinary request bodies are limited to 22MiB; receipt limits apply separately. Queries support up to 40,000 account postings; narrow dates/accounts if exceeded. Request history does not store secrets, bodies or search text.

Disabling API access pauses existing keys; valid keys work again after re-enabling. Revocation, password/security changes and backup restoration invalidate keys. Ordinary sign-out, signing out all devices and app restarts do not revoke them. Revoke individual keys on the App passwords screen.

Import the server's `/openapi.json` into Postman if desired. It also contains internal web routes; external integrations must use the `/api/v1` paths above. Public cross-origin browser access, OAuth login and automatic bank connections are not supported.
