# Offline use and synchronization

After signing in and loading data, a browser can show stored records and save new transactions or edits without a server connection. **Saved on this device is different from saved on the server.** Check pending operations using the cloud icon in the header.

## Preparation and preferences

1. While connected, open **Settings → Offline records**.
2. Enable offline mode and choose **7, 30 or 90 days** of recent transactions. The default is enabled with seven days. Preferences apply to this account in this browser.
3. View any accounts and historical records you need. Records actually loaded are cached for 30 days after their last view, even outside the recent period.
4. To retain a transaction, open its details and select **Keep offline**. It is excluded from age-based cleanup until unpinned. A confirmed server deletion or loss of account access still removes the corresponding cached records.

While connected, the app prepares recent transactions, accounts and categories. Data that has not been loaded yet is unavailable if the connection drops. It does not automatically download your entire history or receipt photos.

**Reopening or reloading the app offline requires a trusted HTTPS origin.** On ordinary HTTP, an already-open page can store data and pending entries, but offline loading of the app itself is restricted. Installing the PWA does not remove this requirement.

## Connection status and pending operations

Select the cloud next to the account icon to see the connection state, last server response, pending operations and errors. Internet access and server availability are different. A number badge counts unfinished operations; a spinner indicates synchronization.

When the server is unavailable, saving stores the transaction and its selected photo on the device first. The app checks the connection and sends pending operations while open or when reopened. Use **Reconnect and sync** to retry immediately. Uploads while the app is completely closed are not guaranteed.

Offline search and totals include **stored transactions only**. Unloaded periods may be empty or incomplete. Account balances are from the last server response and do not yet include pending transactions. The last-response timestamp does not mean all cached historical records are current.

New income, expenses, transfers, edits and their selected receipt photos can wait for synchronization. Account creation, sharing changes, category management, deleting/restoring transactions and administration require a server connection. Existing receipt photos are not automatically cached for offline viewing.

## Conflicts and sign-in

The app sends each changed transaction's identifier, expected version and payload. It does not compare or replace the entire ledger. If a response is lost, retries use the same request identifier to avoid duplicate creations or edits.

If another person changed the transaction first, or an account or sharing permission changed, the app retains the pending operation with an error instead of overwriting server data. Restoring server data also blocks replay from an older dataset. **Export pending records**, compare them with current server records and enter only the changes still needed.

Expired sessions require signing in again with the same account. One account never automatically sends another account's pending operations. Sign-out clears cached viewing data but keeps pending work for the original account to handle after signing in again.

If a connection or access problem interrupts photo changes, the transaction may already be saved while its photo operation remains pending. Check the cloud menu for **The transaction is saved on the server** and retry the existing operation. Creating a new transaction can create a separate record.

## Device storage precautions

- Offline storage is enabled by default. Disable it on shared devices. Device storage does not replace server authentication; someone with access to the device or browser may be able to read stored copies.
- Offline devices cannot immediately learn about revoked sharing permissions or server deletions. Cached copies are cleaned up after reconnecting and checking access.
- Pending operations are never removed by age-based cleanup. Up to 500 can wait; sync or export them before adding more.
- **Clearing site data, ending a private browsing session, losing the device or browser storage eviction can lose unsent work.** Export important pending data. Server backups do not include device-local pending operations.
- Pending export downloads JSON and attached photos separately. Check the browser's multiple-download permission. The JSON is an emergency reference format, not the regular ledger JSON import format.
- **Clear cached records** removes this device's viewing copies only. Server records and pending operations remain. Reconnect to prepare viewing copies again.
- **Cancel pending operation** removes that device's pending copy and photo. If part of the operation already succeeded, the server transaction remains. Export anything you need before cancelling.

Before restoring a server, moving installations or changing the connection address, sync or export pending work on every device. Storage is isolated by origin: HTTP, HTTPS and different domains do not automatically share device copies.

[Usage](usage.md) · [Backup and restore](operations.md) · [한국어](../ko/offline.md)
