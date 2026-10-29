# Operations, updates and recovery

[Manual home](index.md) · [Installation](installation.md)

## Routine operation

Run commands in the folder containing your Compose file, or use `docker compose -f /install/path/compose.yaml`.

```bash
docker compose ps
docker compose logs --tail 100 duet-ledger
docker compose restart duet-ledger
```

The restart policy starts the container after reboots when Docker is running. `/healthz` checks application health; it is not a backup check.

## Updating

Read the [changelog](https://github.com/GOODJINC/duet-ledger/blob/main/CHANGELOG.en.md) and save a backup with its original `master.key`. Check [Releases](https://github.com/GOODJINC/duet-ledger/releases) to confirm that the target image has been published.

Set the version in `.env` beside your Compose file. For example, to update to 0.2.0:

```dotenv
DUET_LEDGER_IMAGE=ghcr.io/goodjinc/duet-ledger:0.2.0
```

In a Docker management interface, change its environment variable or `image` tag. A `DUET_LEDGER_IMAGE` value in `.env` or the shell overrides the Compose default. Prefer an exact version over `latest` to control when you update.

```bash
docker compose pull duet-ledger
docker compose up -d
docker compose ps
docker compose logs --tail 100 duet-ledger
```

Pulling a fixed tag does not switch versions. Publishing an image does not automatically replace a running container.

Keep the volume and environment settings. **An old image alone is not a safe rollback after schema migration.** Use a compatible app and a pre-update data copy. Never delete the production volume during updates.

## Updating to 0.2.0

Storage upgrades to schema 8. Existing opening balances become income (positive) or expense (negative) entries dated at account creation. Current balances stay the same, but income/expense totals for those dates change. Keep a pre-update backup and review the changed reports.

## Moving Docker installations

On the same Docker server, stop the old app and attach the existing `duet-ledger-data` volume and environment settings to the new stack. For a different server, use backup and restoration below. **Never open the same dataset with two app instances.**

## Backup and restore

### master.key

`master.key` is a server secret generated automatically on first start. It currently encrypts two-factor authentication (TOTP) secrets and verifies that a backup matches its original key. It does not encrypt the entire transaction database. **The original key is required for operational restore even if two-factor authentication is disabled.**

| Installation           | Key location                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Default Docker Compose | `/data/master.key` inside the container, persisted in the `duet-ledger-data` volume |
| Custom data directory  | `master.key` in the directory selected by `DUET_LEDGER_DATA_DIR` or `--data-dir`    |

It is not automatically created beside your Compose file. Keeping the data volume preserves the key across container updates. Other installations and development containers have different keys; use the original key from the installation that created the backup.

Download the key in **Administration → Backup and restore → Download key file** after verifying your current password and, if enabled, a verification code. Keep a copy when first setting up the server.

If the web interface is unavailable, copy it from the default container as follows. Replace `duet-ledger` if you changed the container name. If a key already exists in the destination, do not overwrite it; keep a separate folder for each installation.

```bash
mkdir -p private-backup
chmod 700 private-backup
docker cp duet-ledger:/data/master.key ./private-backup/master.key
chmod 600 ./private-backup/master.key
```

**Operational backup ZIPs do not include the key.** Store it securely and separately, and label which backups it belongs to. Never upload it to GitHub, public shares or messages. Deleting or replacing it can break existing two-factor authentication or normal restoration. If it is missing, check the original volume and saved copies first. A newly generated key cannot replace the original.

### Make a backup

1. Open **Administration → Backup and restore**.
2. Select **Create and download backup**. The verified ZIP is saved on the server and downloaded to your device.
3. On first use, also select **Download key file** and keep `master.key` separately.

The ZIP includes all users’ records, receipts and shared appearance files. **It is not encrypted and does not include the key.** Keep both files private and label them so you know which installation they belong to. CSV/JSON exports do not replace a server backup.

Automatic backups run daily while the server is running. Cleanup retains the latest seven files, including manual and pre-restore backups. **Download important copies to another device.**

### Restore through the web interface

**All users’ data will be replaced with the selected backup.** Notify other users and finish any other work first.

1. Open **Backup and restore → Restore**, or use **Restore** next to a saved backup.
2. Select a server backup or attach a ZIP from your device.
3. Backups from this server use its current key automatically. For a backup from another server, attach that backup’s original `master.key`.
4. Select **Check backup** and review its date and user, account, transaction and receipt counts.
5. Enter your current administrator password and, if enabled, a verification code. Acknowledge that the data will be replaced, then select **Back up current data and restore**.
6. Sign in again using credentials from the backup and check balances, transactions, photos and sharing permissions.

The server checks the archive, key, database integrity and photos first. Current data is automatically backed up before restoration. If the database update fails, existing data remains intact. To undo a successful restore, select the file marked **Automatic backup before restore** and follow the same steps. Retention applies to this backup too; download it if needed.

Restoration invalidates **all login sessions, pending invitations and API app passwords**. Accounts and approved sharing relationships return to their backed-up state. Web restoration retains this server’s `master.key` and re-encrypts imported two-factor secrets with it. New backups use the current server’s key; older ZIP files still require the key they were created with.

Web uploads support ZIP files up to **512 MB**, with up to **10 GB** of uncompressed data. Proxy upload limits, available disk space and request timeouts may impose lower limits. A preview lasts 10 minutes and must be recreated after a restart. Other requests may briefly wait while the server validates, creates or restores a backup.

### When the web interface is unavailable or the backup is too large

Use the server’s `restore` command. It restores into a new directory and refuses to overwrite existing data. This also lets you test a backup in a separate volume. Place copies of the ZIP and its original key in `private-backup` before following the steps below.

### Test a restore into a separate Docker volume

**Leave the production volume untouched.** Replace `BACKUP.zip` with the actual filename and `IMAGE` with an app image compatible with the backup. Check it with `docker inspect --format '{{.Config.Image}}' duet-ledger`.

```bash
docker volume create duet-ledger-restore-test
docker run --rm --user 0 \
  -v duet-ledger-restore-test:/restore \
  -v "$PWD/private-backup:/backup:ro,Z" \
  --entrypoint sh IMAGE -c \
  '/duet-ledger restore --archive /backup/BACKUP.zip --key-file /backup/master.key --data-dir /restore/restored && chown -R 10001:10001 /restore/restored'
```

The `restored` directory is created afresh; existing data is never overwritten. The original key must match the backup. `:Z` supports SELinux environments; use a dedicated folder containing only restore copies.

Test on a separate port bound to the server itself:

```bash
docker run -d --name duet-ledger-restore-check \
  -p 127.0.0.1:18089:8080 \
  -e DUET_LEDGER_DATA_DIR=/data/restored \
  -v duet-ledger-restore-test:/data IMAGE
```

Open `http://localhost:18089`, sign in again and verify transaction counts, balances, photos and sharing. Restoration invalidates old sessions, pending invitations and app passwords. Existing accounts and sharing relationships remain, so review them before external exposure.

For a production switch, stop the test container, set the original Compose data-volume `name` to `duet-ledger-restore-test`, and set `DUET_LEDGER_DATA_DIR` to `/data/restored`. Recreate the service. **Never let two servers open the same dataset.** Preserve the previous volume until verification is complete.

### Recover a sign-in password

Use only when you control the server and cannot sign in. Identify the username and stop the app. The new password needs at least eight characters.

```bash
docker compose stop duet-ledger
read -rsp 'New password: ' duet_new_password
printf '\n'
printf '%s' "$duet_new_password" | docker compose run --rm --no-deps -T \
  duet-ledger reset-password --username ACTUAL_USERNAME
unset duet_new_password
docker compose up -d
```

If the authenticator and recovery codes are both lost, add `--disable-totp` to `reset-password`. **This revokes all sessions and app passwords for that user.** Set up two-factor authentication and new integration keys after recovery.
