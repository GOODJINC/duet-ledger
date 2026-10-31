# Installation

[Manual home](index.md) · [Operations](operations.md)

## Requirements

Use Docker Engine with the Compose plugin. Images support AMD64 and ARM64; Docker selects the correct architecture.

## Docker Compose

Run on the server:

```bash
mkdir -p duet-ledger
cd duet-ledger
curl -fL https://raw.githubusercontent.com/daytivehq/duet-ledger/main/compose.yaml -o compose.yaml
docker compose up -d
docker compose ps
```

Open `http://localhost:18088` to create the first account. This preset allows access only from the server itself (`127.0.0.1`) by default.

## Address and port

Create an optional `.env` file beside the Compose file. You can choose any installation directory.

| Variable                      | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `DUET_LEDGER_IMAGE`           | Image and version; defaults to the Compose version |
| `DUET_LEDGER_BIND`            | Server address to listen on                        |
| `DUET_LEDGER_PORT`            | Host port; default 18088                           |
| `DUET_LEDGER_PUBLIC_URL`      | HTTPS origin                                       |
| `DUET_LEDGER_SECURE_COOKIE`   | Set to `true` for HTTPS                            |
| `DUET_LEDGER_TRUSTED_PROXIES` | Trusted proxy IPs/CIDRs; leave empty by default    |

Example for remote access on port 18888:

```dotenv
DUET_LEDGER_BIND=0.0.0.0
DUET_LEDGER_PORT=18888
```

Apply with `docker compose up -d`, then open `http://SERVER_IP:18888`. Allow the port in your firewall. To restrict access to one network, bind to that server IP. Keep the internal container port 8080.

## `${…}` and defaults

`curl` saves the Compose file unchanged. `${VARIABLE:-default}` is standard Docker Compose syntax. Compose substitutes the value when it runs, using the default after `:-` when no non-empty value is provided. It does not rewrite the downloaded file.

For example, `${DUET_LEDGER_IMAGE:-ghcr.io/daytivehq/duet-ledger:0.3.0}` defaults to `ghcr.io/daytivehq/duet-ledger:0.3.0`. The default bind address is `127.0.0.1` and host port is `18088`. An exported shell variable takes precedence over `.env`.

```bash
docker compose config
```

This displays the resolved image, ports and environment. Seeing `${…}` in an editor is normal. In a Docker management interface, paste the same Compose content and set the environment variables there. Cloning the Git repository or building from source is not required.

## HTTPS and PWA

For internet access, configure a reverse proxy with a trusted TLS certificate. Serve the app at the domain root, preserve the original `Host`, and forward `/api/` and `/mcp` requests.

```dotenv
DUET_LEDGER_PUBLIC_URL=https://ledger.example.com
DUET_LEDGER_SECURE_COOKIE=true
```

Use the actual origin without a path or trailing slash. Enabling secure cookies before HTTPS is ready can prevent HTTP sign-in from persisting.

Install the PWA using the browser's install-app menu at the trusted HTTPS address. Plain HTTP may remain restricted even over a VPN. See [Offline use](offline.md) for cached records, pending entries and synchronization.

## Proxies and login limits

Forwarded IP headers are ignored by default. If you use a reverse proxy, optionally set `DUET_LEDGER_TRUSTED_PROXIES` to a comma-separated list of exact proxy IP addresses or CIDRs that connect directly to the app. The proxy must set or append the real client address in `X-Forwarded-For`. The app walks the chain from right to left and uses the first untrusted address.

Do not trust the entire internet. Leave this empty until you have verified your proxy addresses. Successful sign-ins do not consume the failed-login budget. Failures are limited to 30 per account and 300 overall per client IP in ten minutes. This reduces interference between users behind one proxy while still bounding attempts across many accounts.

## Storage

The installation directory holds Compose and `.env`; application data is stored in the Docker volume `duet-ledger-data` and survives container replacement. **Deleting the volume can lose your records.** Follow [Operations](operations.md) for updates, backups and restoration.
