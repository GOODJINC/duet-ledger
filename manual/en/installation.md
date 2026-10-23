# Installation

[Manual home](index.md) · [Operations and backups](operations.md)

## Requirements and startup

Install Docker Engine, the Compose plugin and Git on your Linux server. You need permission to run Docker and disk space for persistent data. Check your installation with `docker version` and `docker compose version`.

```bash
git clone https://github.com/GOODJINC/duet-ledger.git
cd duet-ledger
docker compose up -d --build
docker compose ps
```

The first build downloads dependencies and base images. Runtime requires only one application container: no separate database, Redis or MCP container.

Open `http://localhost:18088` on the server. Select English and create the first administrator. **Create this account before exposing the server publicly.** Registration then requires invitations by default. A personal ledger is created automatically.

## Ports and access from another computer

The default binding is `127.0.0.1:18088`. Copy `.env.example` to `.env` in the project folder and edit it.

```bash
cp .env.example .env
```

For example, to listen on your network at port 18888:

```dotenv
DUET_LEDGER_BIND=0.0.0.0
DUET_LEDGER_PORT=18888
DUET_LEDGER_PUBLIC_URL=
DUET_LEDGER_SECURE_COOKIE=false
```

```bash
docker compose up -d
```

Connect from another device using `http://SERVER_IP:18888`. Your firewall and network must allow the port. With Tailscale, you may bind to the server's Tailscale IP instead. That address must be available when the container starts.

`0.0.0.0` exposes the port on all server interfaces. Configure HTTPS before exposing the app to the public internet. Change the **host port before the colon**; keep the container's internal port 8080.

## HTTPS and installing the PWA

Place a reverse proxy with a domain and trusted TLS certificate in front of the app. Forward requests to the container's port 8080 or its published host port, depending on your network setup. Serve the app at the domain root.

```dotenv
DUET_LEDGER_PUBLIC_URL=https://ledger.example.com
DUET_LEDGER_SECURE_COOKIE=true
```

`PUBLIC_URL` must be your real HTTPS origin without a path or trailing slash. Preserve the original `Host` header and forward `/api/` and `/mcp` too. Enabling secure cookies before HTTPS is ready can prevent HTTP sign-in from persisting.

PWA installation requires trusted HTTPS. A plain HTTP address remains restricted even over Tailscale. Open the HTTPS address and use your browser's install-app menu. Offline transaction entry and synchronization are not supported.

## Storage and commands

SQLite, receipts and keys are stored in the `duet-ledger-data` volume, separately from the source directory. Git backups do not include them. Multiple app instances cannot open the same dataset simultaneously.

Run Compose commands from the folder containing `compose.yaml`, or specify its path:

```bash
docker compose -f /actual/install/path/compose.yaml ps
docker logs --tail 100 duet-ledger
```

Use `docker compose stop` and `docker compose start` to stop and start. Check status using `docker compose ps` and `/healthz`. Do not delete or replace the running data volume with an empty volume.
