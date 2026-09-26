# Security

Allowance has a loopback local app and a separate owner-only hosted billing backend. Browserbase holds the cloud browser sessions. The hosted backend has been tested locally; public deployment is not yet established. The public repository contains application code and synthetic test fixtures, not browser data.

## Local data

Account readings and billing records stay in browser localStorage. Provider tokens and OpenCode keys are also stored there, unencrypted. Anyone with access to that browser profile, or malicious code running on the app's origin, may be able to read them. Use a trusted profile and keep the development server bound to loopback.

Exports exclude provider sessions and keys, but contain account identifiers, usage, and any synced billing/member records. Treat exports as private. `.gitignore` excludes common environment, database, credential, export, and backup files; this does not replace reviewing staged files before publishing.

## Browser connection

When `BROWSERBASE_API_KEY` is configured, a selected billing check uses a persistent Browserbase Context. Browserbase holds the site's authenticated browser state; this can grant more access than billing alone. Context mappings are private server files keyed by a hash of the exact email, provider account ID and workspace flag. They are not sent to the frontend or exported. `.env.local`, `.allowance/` and browser-auth artifacts are ignored by Git. Protect the service API key and the private server volume; a public repository does not provide access to either.

Cloud session recordings, logs and automatic CAPTCHA solving are disabled. A short-lived interactive browser URL is returned only to the requesting local origin for sign-in. Treat that URL as sensitive: it can control the active browser. The app never logs or persists it. Expired authentication requires the user to sign in again. Provider access denials and challenges are not bypassed.

Without cloud configuration, the connector opens an isolated temporary Chrome session for one selected account and does not retain its browser profile. Local transports require a loopback Host and same-origin JSON. The hosted route instead requires the configured HTTPS Host/Origin and an authenticated owner session. An opaque connection ID binds each read to the original account and origin. Only one connection/read runs at a time, and cancellation or expiry discards late results. The browser closes after a read, cancellation, or fourteen minutes. Cloud profiles persist separately; cookies are never exported to the dashboard.

The reader makes GET requests only to ChatGPT, rejects redirects, verifies email and workspace membership, and returns a strict allowlist of tracking fields. Tokens, payment methods and private invoice URLs are excluded. It never changes billing, seats or membership. No extension is installed or required.

This is an unofficial integration, not an approved OpenAI API. [Individual terms](https://openai.com/policies/row-terms-of-use/) restrict automated extraction; the [Services Agreement](https://openai.com/policies/services-agreement/) also restricts extraction except as permitted through the service. No guarantee against account suspension is made. Billing runs only when requested and respects access failures and browser challenges.

## Hosted backend

Do not expose the Vite dev or preview server publicly. The separate Node server starts only with an exact origin, an owner password hash, a 32-byte encryption key and cloud-browser credentials. Account and billing endpoints require owner authorization; the login and health endpoints expose no account data. Writes require same-origin JSON. The server rejects unexpected Host headers, throttles login attempts and cloud-browser launches, and serves files only from the built asset directory.

Passwords are salted and hashed with scrypt. Random owner session tokens are stored only as hashes, expire after seven days, and are invalidated by logout or a password-hash change. Cookies are HttpOnly and SameSite=Strict, with Secure outside loopback testing. No provider token is imported into the hosted database.

SQLite account/billing records are encrypted with AES-256-GCM and an environment-held key. Context mappings remain private files on the same persistent volume. Only one server instance is supported. Keep the volume, cloud API key, encryption key and owner password out of Git, frontend builds, logs and public uploads. Encryption at rest does not protect against a compromised running server with access to its environment. Public source code is compatible with private data; security depends on authorization and secret handling, not hiding code.

The initial account import is additive and allowlisted. Invalid records fail without replacing existing accounts. Failed billing attempts retain previous successful sections and their timestamps. Browser results from the wrong email or account ID are rejected. The hosted UI does not persist account records or credentials in localStorage.

Before using real hosted records, configure HTTPS and private persistent storage, test backups and restoration, and retain the encryption key separately. To revoke cloud authentication, sign out the cloud profile through the provider or revoke the provider session; disconnecting a local usage token does not revoke a Browserbase profile. No security audit or account-safety guarantee is claimed.

## Reporting

Use GitHub private vulnerability reporting when enabled on the repository. Do not include tokens, exports, member lists, or other private account details in public issues.
