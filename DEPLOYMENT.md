# Deployment

Run one Linux container with a persistent disk. The same container serves the app and runs the official CLIs. Do not use multiple replicas against the same data directory.

## Oracle Always Free

As checked on 27 September 2026, Oracle documents an Always Free A1 allowance equivalent to **2 OCPUs and 12 GB memory**, with **200 GB combined boot/block storage** in the home region. Account-wide usage counts toward these limits. Start with an eligible Ubuntu ARM instance, 1 OCPU, 6 GB memory and a 50 GB boot volume if that fits your remaining allowance. Check the console's eligibility and cost summary before creation. Do not upgrade to a paid account or accept a paid shape as a workaround.

Availability is limited, and Oracle can reclaim idle free VMs. Keep backups outside the instance. These terms do not guarantee an always-on free service. [Current Oracle limits and reclamation rules](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

For account recovery: find the original welcome email, use its tenancy/domain sign-in, then Forgot Password. If the reset email is missing, [Oracle documents live chat support without signing in](https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signinginIdentityDomain.htm).

## Start on a VM

1. Install Docker Engine and the Compose plugin using [Docker's Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
2. Clone this repository on the VM. Copy `.env.example` to `.env`, and set `ALLOWANCE_DOMAIN` to your domain.
3. Point the domain's DNS A record to the VM's public IPv4 address. Remove stale AAAA records unless IPv6 is configured. Allow inbound TCP 80/443 in both the cloud security rules and the host firewall. Restrict SSH to your own IP. App port 3000 stays private to Docker.
4. Build and start:

```sh
docker compose up -d --build
docker compose exec app node --import tsx scripts/setup-owner.ts
```

Open the private setup link printed by the second command and create your password. Caddy obtains and renews HTTPS certificates. Set up each provider through the app; this creates server-side logins independently of your Mac's logins.

The `allowance-data` volume holds SQLite, encryption key and provider profiles. Browser sessions persist there for 30 days. A container replacement retains the named volume. **Do not run `docker compose down -v`** unless you intend to erase saved data and sign-ins.

A managed container host can run the same image with a persistent disk mounted at `/data`, `ALLOWANCE_ORIGIN` set to its exact public HTTPS origin, and port 3000 forwarded by its HTTPS proxy. Its disk must survive restarts and deployments. Free Render instances do not support persistent disks; a free static frontend does not solve provider credential persistence.

## Verify before relying on it

- Sign in on your phone, connect one account from each provider, and refresh.
- Restart the container with `docker compose restart app`, then refresh again without re-login.
- Close your laptop and check from your phone.
- Check that logged-out `/api/accounts` returns 401.
- Do not spend a reset merely to test deployment. Its confirmation/retry behavior has synthetic tests.

Local CLI checks establish usage access; they do not prove that a provider will accept the selected cloud IP or keep its session indefinitely. Reconnect remains available if authentication expires.

## Backups and updates

Settings → Export accounts gives a portable backup of dates and readings, without credentials. Save it on another device. You can recover these entries by importing and signing in again.

For a full snapshot, briefly stop the app and back up the entire `allowance-data` volume using your host's volume/boot-volume backup facility; then start it again. Preserve `allowance.sqlite` plus any `-wal`/`-shm` files, `encryption.key`, and `profiles/` together. Full backups contain usable provider logins and owner sessions: keep them encrypted and private. Restoring only the database will not restore CLI profiles. Test a restore privately before depending on the backup.

To update:

```sh
git pull --ff-only
docker compose build --pull app
docker compose pull https
docker compose up -d
```

Back up first. CLI/SDK versions are pinned in `package.json`; rerun usage and sign-in checks before upgrading those versions.

## Recover the owner password

With SSH access to your own VM:

```sh
docker compose exec app node --import tsx scripts/setup-owner.ts --reset-owner
```

This revokes existing browser sessions and issues a new 30-minute setup link. It preserves tracked accounts and provider logins. Keep server console access private; there is no public signup or email password reset.
