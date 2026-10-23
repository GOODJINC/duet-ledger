# Troubleshooting and support

[Manual home](index.md)

| Problem | Check first |
| --- | --- |
| Cannot connect from another computer | Default binding is127.0.0.1. Check `.env`, recreate the service, and check firewall/Tailscale |
| `no configuration file provided` | Run from the Compose folder or specify `-f /actual/path/compose.yaml` |
| First-time setup appears again | Before creating an account, verify the original data volume and `DUET_LEDGER_DATA_DIR`; you may have connected an empty dataset |
| Port already in use | Change the host port and recreate |
| Sign-in fails after HTTPS setup | Check the real origin, `PUBLIC_URL`, preserved Host header and secure-cookie setting |
| PWA cannot be installed | Use trusted HTTPS; plain HTTP remains restricted over Tailscale |
| Accepted sharing invitation but no records | The owner must approve it; verify which account accepted |
| Access remains after sharing removal | Check other grants, including ledger membership and direct account sharing |
| Display currency does not change account currency | Expected: existing accounts and amounts are preserved. Configure default account and additional currencies separately |
| No gallery option | Photo/file picker varies by device/browser; convert HEIC to JPG/PNG |
| Custom CSS makes the UI unusable | Open `/admin?safe-theme=1` and remove shared CSS/font files |
| API requires Idempotency-Key | Add and enable it in Postman **Headers**, not Body or Params |
| MCP environment variable missing | Enter/export the app password and restart Codex in the same terminal |

## Requesting support

Use [GitHub Issues](https://github.com/GOODJINC/duet-ledger/issues). Include the app version, installation method, OS/browser, reproduction steps, expected behavior and actual result. For mobile issues, include screen size and text scaling.

**Never upload passwords, app passwords, cookies, backups, master.key or real financial data.** Redact screenshots and logs. For vulnerabilities, read the repository's [security policy](https://github.com/GOODJINC/duet-ledger/blob/main/SECURITY.md) before publicly posting exploit details.

See the [changelog (Korean)](https://github.com/GOODJINC/duet-ledger/blob/main/CHANGELOG.md), [API](api.md), [MCP](mcp.md) and [operations](operations.md) guides for detailed changes, permissions, connections and recovery.
