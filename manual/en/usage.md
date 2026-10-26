# Basic usage

[Manual home](index.md) · [App passwords and API](api.md)

## Ledgers and accounts

One user account can use multiple ledgers. Personal ledgers start private; shared ledgers are accessible to invited and approved members. You can also share selected accounts from a personal ledger.

1. Use the ledger picker at the upper left, or at the top on mobile.
2. Open **Accounts → Create account** to add a bank, cash, card or loan account.
3. Set its currency and opening balance. Opening balances are not income. Enter unpaid card balances and loans as negative amounts.
4. Use **Settings → Manage ledgers** to create, edit, reorder or restore ledgers.

Selecting a ledger restricts accounts and quick-entry destinations to that ledger. All ledgers combines accounts you can access.

## Transactions and receipts

Open **Quick entry**, select Expense, Income or Transfer, and enter the amount, description, account, date/time and category. Date and time are filled when the dialog opens and can be changed. Check the privacy notice before saving.

- Income and expenses have separate categories. Ledger owners manage names, order and deletion in **Settings → Manage categories**.
- Transfers currently require accounts in the same currency. They are excluded from income and expense totals. Switch to All ledgers for transfers across ledgers.
- Receipts support JPG/PNG up to 5MB and 16 megapixels. Convert HEIC first.
- View and download photos in transaction details. Remove attachments in the edit dialog and save the change. **Removing an attachment has no separate restore action.** Restoring a trashed transaction is different.
- Restore deleted transactions in **Settings → Transaction trash**. Archiving an account keeps records and prevents new entries. Deleting an account moves it to the trash and stops shared access.

Close dialogs with Close, Escape or browser Back. Clicking outside does not close them. `Q` opens Quick entry; `/` focuses search. Shortcuts are ignored while typing in fields.

## Favorites and recent entries

Expand **Favorites and recent entries** in Quick entry to reuse common input.

- Fill in the amount, description, account, category and notes, then choose **Save current entry as favorite**. Favorites belong to your account, with up to 100 entries. This does not create a transaction.
- **Recent entries** shows up to 20 of your own latest transactions that you can currently enter again. Use the adjacent add button to save one as a favorite.
- Loading input sets the date and time to now. Foreign amounts use your current configured exchange rate; review the result. Receipts are not copied.
- Loading does not save a transaction. Review the draft, then choose **Save record** to create a new transaction.
- The selected ledger limits the available accounts. Transfers require write access to both accounts. Archived, deleted or no-longer-writable accounts are hidden.
- Removing a favorite keeps transaction records. Favorites are included in server backups, but not CSV/JSON data exports.

## Search and statistics

Choose day/week/month/year and list/calendar views. Click the month heading to jump to another year/month, or select This month.

Search matches descriptions, category labels, notes, author names and usernames. Combine account, transaction-type and date filters. Totals include all matching transactions, not just the current page. Insights shows daily trends and expenses by category.

Recorded balances use opening balances and saved transactions. They do not synchronize automatically with a bank.

## Sharing and invitations

**User registration invitations** and **account/ledger sharing invitations** are different. Registering a new user does not expose existing financial records.

1. The administrator enables registration or creates a user invitation.
2. The owner opens **Settings → Manage sharing**, chooses an account or an entire shared ledger, sets a role and creates an invitation.
3. The recipient accepts using their own account.
4. The owner verifies the accepting username and approves access.

| Role   | Access                                                                   |
| ------ | ------------------------------------------------------------------------ |
| Owner  | Manage accounts, members, sharing, ledger settings and financial records |
| Editor | Read, create, update and delete transactions in allowed accounts         |
| Viewer | Read allowed records                                                     |

Editing or deleting a complete transfer requires edit access to both accounts. Other private accounts and hidden transfer counterparts are not exposed. Shared access includes previous transactions, balances, notes and receipts. Downloaded copies cannot be recalled after sharing ends.

A user may have access through both direct account sharing and ledger membership. Removing one grant leaves other grants effective. Transfer ownership or leave sharing in Settings without deleting original records.

Open **Settings → Sharing → Review my account access** to see your effective role and access paths for each account. Whole-ledger and direct-account grants combine using the highest permission. Removing one path leaves access through other remaining paths.

## Currencies and exchange rates

**Settings → Display currency** controls totals and defaults for new accounts; it does not change existing account currencies or amounts. Set a **Default quick-entry account** separately.

Open **Additional currencies and exchange rates → Manage → Add currency** to register multiple currencies and review or enter rates. Optional lookup sends only currency codes to Frankfurter. Actual card rates and fees require your review.

For a USD purchase on a KRW account, the app stores the original amount, applied rate and KRW account amount. Changing rate settings does not rewrite saved payments. Views convert with saved rates. Without a rate, a currency is displayed at its original amount and excluded from converted totals.

## Account, appearance and data transfer

The user menu opens Account settings and Settings. Account settings includes your name, password, two-factor authentication and app passwords. Changing password/security settings or signing out all devices also revokes API keys. Store recovery codes separately.

Choose Korean or English. Personal text size (90–150%), colors and brightness apply in the current browser. Only administrators upload shared CSS/WOFF2 files, which apply to all signed-in users.

CSV export follows the current filters. JSON export is for moving records across all dates, without photos, login details or sharing permissions. Preview imports before applying. **A complete server restore requires an operational backup and its original `master.key`.** See [Operations](operations.md).
