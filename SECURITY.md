# Security

Allowance is a single-owner application. It has no public signup, shared tenant database or billing scraper. A public source repository does not make its private server data public; credentials must never be committed or included in container builds.

## Authentication

Owner passwords use salted scrypt. Login cookies are HttpOnly, SameSite=Strict and, on HTTPS, Secure with the `__Host-` prefix. Only hashes of session tokens are stored. Sessions expire after 30 days; logout revokes the current session and changing the password revokes all previous sessions.

Initial setup requires a random one-time secret generated through the server console. Its hash and 30-minute expiry are stored server-side. A visitor cannot claim an unconfigured app without that secret. The operator can reset owner access through the server console.

The API checks the exact configured host. Writes require the same Origin and JSON content type. Login attempts, API requests and provider refreshes are throttled. Bodies are bounded. The production server serves only the built static directory and blocks hidden paths. Provider failures never return raw subprocess output or credentials to the browser.

## Data and credentials

The data directory is mode 0700. SQLite and the app encryption key are mode 0600. The official Codex CLI owns credentials in each isolated `CODEX_HOME`; Claude Code owns credentials in each `CLAUDE_CONFIG_DIR`. Linux CLI credential files are not encrypted by Allowance. Use an encrypted host disk and private backups. Anyone who controls the server account, disk or a full backup may access these logins.

OpenCode keys use AES-256-GCM with account-bound associated data. The encryption key is stored outside SQLite but on the same volume; this protects a database-only leak, not full server compromise. Nonsecret account readings and billing dates are stored as ordinary SQLite data.

The browser receives account metadata and usage, never provider tokens, profile paths or saved keys. Claude authorization codes submitted during sign-in go directly to the official CLI's stdin. Usage reads initialize the official clients without sending model prompts. The app does not scan local Claude transcripts.

Each account has a separate profile. Reconnect retains the old profile until the new login returns usage. Disconnect/removal deletes the app's isolated profile; it does not log out another app or promise provider-wide token revocation. Cancelled, failed and expired login profiles are discarded. A process crash can leave an unused profile on disk; keep the volume private.

Reset credits require a confirmation, per-account serialization and a persisted idempotency key. Unknown results retain that key for retry, including after a server restart. Successful outcomes are recorded and followed by a fresh usage read. A failed refresh preserves the previous data with an error.

Exports contain account identifiers, usage and manual dates, but no credentials or sessions. Imports append disconnected accounts and never import profile paths or keys. Legacy browser data remains untouched; remove old localStorage credentials yourself after confirming migration if you no longer need the retired local build.

## Boundaries

There is no claim of perfect security, an independent penetration test, or permanent provider compatibility. Claude's usage SDK method is experimental. Usage API metadata does not establish the assigned Business seat or workspace role, so the app does not infer them. Expected billing dates do not establish payment or invoice status.

Profiles from the retired Browserbase billing version are managed in Browserbase until separately removed; this build neither uses nor revokes them. Report issues using synthetic data, never personal exports or credentials.
