# Changelog

[한국어](CHANGELOG.md)

## 0.3.0 · Unreleased

- Added per-browser offline storage: seven recent days by default, optional 30/90 days, 30-day retention of viewed historical records and individually pinned records.
- Added cached search, viewing and totals, plus a durable outbox for new transactions, edits and attached photos. Operations synchronize when the app reconnects. Account balances remain the last confirmed server values.
- A cloud indicator shows server connectivity, pending counts, errors, exports and cancellation. Conflicts, revoked access and restored datasets retain pending work without overwriting server changes.
- Retry identifiers prevent duplicates after lost responses or multiple-tab synchronization. Storage is isolated by account and excludes passwords, session tokens and CSRF secrets.
- Storage schema remains at version 8. **Server backups do not contain device-local pending work.** Sync or export before clearing browser data or restoring the server.
- Added Korean/English offline, troubleshooting and update/recovery guidance, plus automated browser regression coverage. Background upload while the app is closed is not guaranteed; offline reopening requires HTTPS.

## 0.2.0 · 2026-10-29

- Account opening balances become transactions dated at account creation: positive amounts are income and negative amounts are expenses. View, edit, trash and restore them like ordinary entries. Zero amounts create no entry.
- Existing opening balances are converted without changing balances. **Historical income/expense totals change.** Very large amounts are split within the existing per-transaction limit.
- Clarified account archiving/deletion, improved spacing, and replaced typed account-name confirmation with Confirm/Cancel.
- Added permanent deletion and empty-trash actions for records and accounts. **Permanent deletion cannot be undone.** Only owners of every involved account may purge a record; account purging cannot remove another account's transfer history or balance.
- Save quick entries and transaction edits with Ctrl+Enter, or Command+Enter on Mac.
- **Storage upgrades automatically to schema 8.** Save an operational backup and the original master.key before updating. Existing backups may retain copies of permanently deleted data.
- Added administrator backup creation/download and web restoration with a preview, reauthentication, an automatic pre-restore backup and transactional rollback on failure.
- Administrators can securely download `master.key` after reauthentication. Backups from another server use their original key for import while retaining the installed key. Updated Korean and English recovery guides.

## 0.1.1 · 2026-10-28

- Slow request bodies and response transfers no longer hold the shared data lock. Authentication and sharing permissions are checked again before saving.
- Account-scoped API/MCP category lookups exclude categories found only in other accounts. Failed uploads count toward API limits and appear in request history.
- Sign-in/registration bodies and ordinary temporary-file usage are bounded. Successful sign-ins no longer consume the failure budget; only explicitly trusted proxies can supply client IPs.
- New sessions preserve the chosen sign-in duration after password and two-factor changes. Signing out all devices ends web sessions; app passwords are revoked separately.
- Fixed statistics grouping for category codes/names containing special characters, required MCP category input, and account/balance query efficiency.
- Added account-access review, personal entry favorites and recent-entry reuse.
- Improved full-screen mobile forms, Back navigation, background scrolling and layout. Browser preferences control page headings, quick-entry buttons, colors and text size.
- Updated Korean/English UI and manuals, including shared CSS/font instructions and a sample.
- **Updating from 0.1.0 automatically upgrades storage schema 6 to 7.** Save an operational backup and the original `master.key` first. Switching only to an older image is not a safe rollback.

## 0.1.0 · 2026-10-25

- First release without a prerelease suffix, with matching app, OpenAPI and Docker image versions.
- Published AMD64/ARM64 images and image-based Docker Compose installation, with separate development configuration.
- Added Korean/English installation, usage, API/MCP and operations manuals.
- Updates from alpha.12 preserve the existing schema, accounts, transactions, sharing and app passwords.

Earlier prerelease history is retained in the [Korean changelog](CHANGELOG.md).
