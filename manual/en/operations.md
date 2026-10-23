# Operations, updates and recovery

[Manual home](index.md) · [Installation](installation.md)

## Routine operation

Run commands in the project folder, or use `docker compose -f /install/path/compose.yaml`.

```bash
docker compose ps
docker compose logs --tail 100 duet-ledger
docker compose restart duet-ledger
```

The restart policy starts the container after reboots when Docker is running. `/healthz` checks application health; it is not a backup check.

## Updating

Read the changelog and storage migration notes first. Save an operational backup and `master.key`. Check and preserve local source modifications before updating.

```bash
git status
git pull --ff-only
docker compose up -d --build
docker compose ps
docker compose logs --tail 100 duet-ledger
```

If installed from a Git tag, fetch and check out your intended published tag before building. Do not assume that unpublished tags or registry images exist: the default installation builds from source.

Keep your data volume and `.env`. Storage migrations may run automatically. **Switching back to an old image alone is not a safe rollback.** A changed schema requires a compatible app and a pre-update data copy. Do not delete the operational volume.

## Backup and restore

### Make a backup

Administrators can create and download a ZIP in **Server backup**. Automatic backups run daily while the server is running. **Automatic cleanup keeps only the latest seven backups on the server, including manually created backups.** Copy backups to another device; copies on the same disk do not protect against disk failure.

The operational ZIP contains all users' records, receipts and shared appearance files, but **not `master.key`**. It is unencrypted. Never upload it to GitHub or a public share.

```bash
mkdir -p private-backup
chmod 700 private-backup
docker cp duet-ledger:/data/master.key ./private-backup/master.key
chmod 600 ./private-backup/master.key
```

Place the downloaded ZIP in this private folder too. CSV/JSON exports are data-transfer formats, not complete operational backups.

### Test a restore into a separate Docker volume

**Leave the production volume untouched.** Replace `BACKUP.zip` with the actual filename and `IMAGE` with your current image, for example `duet-ledger:0.1.0-alpha.12`. Check it with `docker inspect --format '{{.Config.Image}}' duet-ledger`.

```bash
docker volume create duet-ledger-restore-test
docker run --rm --user 0 \
  -v duet-ledger-restore-test:/restore \
  -v "$PWD/private-backup:/backup:ro,Z" \
  --entrypoint sh IMAGE -c \
  '/duet-ledger restore --archive /backup/BACKUP.zip --key-file /backup/master.key --data-dir /restore/restored && chown -R 10001:10001 /restore/restored'
```

The `restored` directory is created afresh; existing data is never overwritten. The original key must match the backup. `:Z` supports SELinux environments such as Fedora; use a dedicated folder containing only restore copies.

Test on a separate port bound to the server itself:

```bash
docker run -d --name duet-ledger-restore-check \
  -p 127.0.0.1:18089:8080 \
  -e DUET_LEDGER_DATA_DIR=/data/restored \
  -v duet-ledger-restore-test:/data IMAGE
```

Open `http://localhost:18089`, sign in again and verify transaction counts, balances, photos and sharing. Restoration invalidates old sessions, pending invitations and app passwords. Existing accounts and sharing relationships remain, so review them before external exposure.

For a production switch, stop the test container, set the original Compose data-volume `name` to `duet-ledger-restore-test`, and set `DUET_LEDGER_DATA_DIR` to `/data/restored`. Recreate the service. **Never let two servers open the same dataset.** Preserve the previous volume until verification is complete.

A directly installed binary uses the same restore command:

```bash
./duet-ledger restore --archive /backups/BACKUP.zip \
  --key-file /backups/master.key --data-dir /new/data-directory
```

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
