# Duet Ledger

[한국어](README.md) · [Manual](manual/en/index.md) · [Changelog](CHANGELOG.md)

A Docker-based personal and shared finance app. Manage multiple ledgers with one account and share entire ledgers or selected accounts.

- Income, expenses, transfers, search, calendar, statistics and receipts
- Viewer/editor permissions, multiple currencies, Korean and English
- Mobile web, PWA, REST API and MCP
- One container with SQLite, server backup and restore

## Installation

**Arcane:** paste [compose.arcane.yaml](compose.arcane.yaml) into a new stack, deploy and open `http://SERVER_IP:18088`.

**Docker Compose:** run on the server and open `http://localhost:18088`:

```bash
mkdir -p duet-ledger
cd duet-ledger
curl -fL https://raw.githubusercontent.com/GOODJINC/duet-ledger/main/compose.yaml -o compose.yaml
docker compose up -d
```

**The first account becomes the administrator.** Create it on a trusted network before public exposure. See [Installation](manual/en/installation.md) for remote access, ports and HTTPS.

## Manuals

[Installation](manual/en/installation.md) · [Usage](manual/en/usage.md) · [Updates, backup and restore](manual/en/operations.md) · [API](manual/en/api.md) · [MCP](manual/en/mcp.md) · [Troubleshooting](manual/en/troubleshooting.md)

Also available in the app's user menu → **Help and support**.

## Data storage

Records are stored in the `duet-ledger-data` volume. **`docker compose down -v` can delete your data.** Keep operational backup ZIPs and the original `master.key` separately. This is prerelease software; back up important records regularly.

[Issues and feature requests](https://github.com/GOODJINC/duet-ledger/issues) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

[AGPL-3.0-only](LICENSE) · [Third-party notices](web/public/third-party-licenses.txt)
