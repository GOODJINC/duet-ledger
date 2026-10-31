# Duet Ledger

[한국어](README.md) · [Manual](manual/en/index.md) · [Changelog](CHANGELOG.en.md)

A Docker-based personal and shared finance app. Manage multiple ledgers with one account and share entire ledgers or selected accounts.

- Income, expenses, transfers, search, calendar, statistics and receipts
- Viewer/editor permissions, multiple currencies, Korean and English
- Mobile web, PWA, offline records and edits with reconnection sync
- REST API and MCP
- One container with SQLite, server backup and restore

For personal use, no sharing setup is needed. To share, invite each person using their own account. Automatic bank connections are not supported. [Offline records and synchronization](manual/en/offline.md) are available; reopening the app offline requires HTTPS.

## Installation

Check [Releases](https://github.com/daytivehq/duet-ledger/releases) to confirm that the image for your chosen version has been published. Run on the server and open `http://localhost:18088`:

```bash
mkdir -p duet-ledger
cd duet-ledger
curl -fL https://raw.githubusercontent.com/daytivehq/duet-ledger/main/compose.yaml -o compose.yaml
docker compose up -d
```

Compose resolves `${…}` settings when it runs. Use `.env` to change the port and listen address.

**The first account becomes the administrator.** Create it on a trusted network before public exposure. See [Installation](manual/en/installation.md) for remote access, ports and HTTPS.

For an existing installation, follow [Updating](manual/en/operations.md#updating): back up your data, then change the image version. Check [Releases](https://github.com/daytivehq/duet-ledger/releases) for published versions.

## Manuals

[Installation](manual/en/installation.md) · [Usage](manual/en/usage.md) · [Updates, backup and restore](manual/en/operations.md) · [Appearance](manual/en/appearance.md) · [Offline and sync](manual/en/offline.md) · [API](manual/en/api.md) · [MCP](manual/en/mcp.md) · [Troubleshooting](manual/en/troubleshooting.md)

Also available in the app's user menu → **Help and support**.

## Data storage

Records are stored in the `duet-ledger-data` volume. **`docker compose down -v` can delete your data.** Keep operational backup ZIPs and the original `master.key` separately. See [key location and storage](manual/en/operations.md#masterkey) and back up important records regularly.

**Unsent device records are not included in server backups.** Use the cloud icon to sync or export pending work before clearing browser data or restoring the server.

[Issues and feature requests](https://github.com/daytivehq/duet-ledger/issues) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

[AGPL-3.0-only](LICENSE) · [Third-party notices](web/public/third-party-licenses.txt)
