# Changelog

[한국어](CHANGELOG.md)

## 0.1.1 · Preparing for release

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
