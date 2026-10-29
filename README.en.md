# Duet Ledger

[한국어](README.md) · [Manual](manual/en/index.md) · [Changelog](CHANGELOG.en.md)

A Docker-based personal and shared finance app. Manage multiple ledgers with one account and share entire ledgers or selected accounts.

- Income, expenses, transfers, search, calendar, statistics and receipts
- Viewer/editor permissions, multiple currencies, Korean and English
- Mobile web, PWA, REST API and MCP
- One container with SQLite, server backup and restore

For personal use, no sharing setup is needed. To share, invite each person using their own account. Automatic bank connections and offline transaction entry are not supported.

## Installation

Run on the server and open `http://localhost:18088`:

```bash
mkdir -p duet-ledger
cd duet-ledger
curl -fL https://raw.githubusercontent.com/GOODJINC/duet-ledger/main/compose.yaml -o compose.yaml
docker compose up -d
```

Compose resolves `${…}` settings when it runs. Use `.env` to change the port and listen address.

**The first account becomes the administrator.** Create it on a trusted network before public exposure. See [Installation](manual/en/installation.md) for remote access, ports and HTTPS.

For an existing installation, follow [Updating](manual/en/operations.md#updating): back up your data, then change the image version. Check [Releases](https://github.com/GOODJINC/duet-ledger/releases) for published versions.

## Updating to 0.2.0

Opening balances become income/expense transactions dated at account creation. **Balances stay the same, but historical income/expense totals change.** Save an operational backup ZIP and the original `master.key` before updating.

Permanent deletion from trash cannot be undone. See [Usage](manual/en/usage.md) for editing opening entries, deletion scope and save shortcuts.

## Manuals

[Installation](manual/en/installation.md) · [Usage](manual/en/usage.md) · [Updates, backup and restore](manual/en/operations.md) · [Appearance](manual/en/appearance.md) · [API](manual/en/api.md) · [MCP](manual/en/mcp.md) · [Troubleshooting](manual/en/troubleshooting.md)

Also available in the app's user menu → **Help and support**.

## Data storage

Records are stored in the `duet-ledger-data` volume. **`docker compose down -v` can delete your data.** Keep operational backup ZIPs and the original `master.key` separately. Back up important records regularly.

[Issues and feature requests](https://github.com/GOODJINC/duet-ledger/issues) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

[AGPL-3.0-only](LICENSE) · [Third-party notices](web/public/third-party-licenses.txt)
