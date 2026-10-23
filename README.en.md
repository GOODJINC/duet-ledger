# Duet Ledger

[한국어](README.md) · [User manual](manual/en/index.md) · [Changelog](CHANGELOG.md)

A self-hosted finance app for personal and shared records. Use it privately, share a ledger with your household, or share only selected accounts from a personal ledger.

- Multiple ledgers and accounts per user
- Income, expenses, transfers, search, calendar, statistics and receipt attachments
- Account sharing with viewer and editor roles
- Multiple currencies and configurable exchange rates
- Korean and English, responsive web UI and PWA
- REST API and MCP with account-scoped app passwords
- One Docker container with SQLite

This is **prerelease software**. Test with a small dataset and arrange backups before storing important records.

## Quick start

Use a published GHCR image. **No Git, Go, Node.js or source build is required.** Check that your version exists in [Packages](https://github.com/GOODJINC/duet-ledger/pkgs/container/duet-ledger); an unpublished tag cannot be pulled. Maintainers can follow [first publication](manual/en/publishing.md).

**Arcane:** create a stack, paste [compose.arcane.yaml](compose.arcane.yaml), and deploy. Open `http://SERVER_IP:18088`. This preset exposes the port on server network interfaces. Create the first administrator on a trusted network before any public exposure.

**Docker Compose:** save [compose.yaml](compose.yaml) in a folder and run:

```bash
mkdir -p duet-ledger
cd duet-ledger
curl -fL https://raw.githubusercontent.com/GOODJINC/duet-ledger/main/compose.yaml -o compose.yaml
docker compose up -d
```

The CLI preset binds to `127.0.0.1`, so open **http://localhost:18088** on the server. For remote access, ports and HTTPS, see [Installation](manual/en/installation.md).

**The first account becomes the administrator.** No setup token is needed. ARM64 and AMD64 images are selected automatically by Docker. Existing source installations should follow the [migration steps](manual/en/operations.md#move-an-existing-installation-to-arcane).

## Manuals

| Task | Guide |
| --- | --- |
| Install, connect from other devices, configure HTTPS | [Installation](manual/en/installation.md) |
| Accounts, transactions, sharing and exchange rates | [Usage](manual/en/usage.md) |
| Updates, backups, restoration and account recovery | [Operations](manual/en/operations.md) |
| Postman, transactions, search, statistics and receipts | [API](manual/en/api.md) |
| Connect Codex CLI directly to your home server | [MCP](manual/en/mcp.md) |
| Connection, permissions and installation problems | [Troubleshooting](manual/en/troubleshooting.md) |

The same manuals are bundled with the app under the user menu → **Help and support**. No separate documentation service is needed.

## Your data

Accounts, transactions and receipts are stored in the `duet-ledger-data` Docker volume and survive container replacement. **`docker compose down -v` can delete your data.**

Operational backups include every user's private data and photos. ZIP files are unencrypted and do not contain `/data/master.key`. Store the backup and its original key securely and separately. See [Backup and restore](manual/en/operations.md#backup-and-restore).

## Support and contributions

Report bugs or request features in [GitHub Issues](https://github.com/GOODJINC/duet-ledger/issues). Never attach passwords, app passwords, backups or real financial data. See [Contributing](CONTRIBUTING.md) and [Security](SECURITY.md).

[AGPL-3.0-only](LICENSE) · [Third-party notices](web/public/third-party-licenses.txt)
