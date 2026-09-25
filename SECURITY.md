# Security

Allowance currently runs on localhost. There is no hosted database, shared account, or remote data sync. The public repository contains application code and synthetic test fixtures, not browser data.

## Local data

Account readings and billing records stay in browser localStorage. Provider tokens and OpenCode keys are also stored there, unencrypted. Anyone with access to that browser profile, or malicious code running on the app's origin, may be able to read them. Use a trusted profile and keep the development server bound to loopback.

Exports exclude provider sessions and keys, but contain account identifiers, usage, and any synced billing/member records. Treat exports as private. `.gitignore` excludes common environment, database, credential, export, and backup files; this does not replace reviewing staged files before publishing.

## Browser connection

The on-demand connector opens an isolated temporary Chrome session for one selected account. Its local routes require a loopback Host and same-origin JSON. An opaque connection ID binds each read to the original account and origin. Only one connection/read runs at a time, and cancellation or expiry discards late results. The window closes after a read, cancellation, or eight minutes; the app does not retain a browser profile or export cookies.

The reader makes GET requests only to ChatGPT, rejects redirects, verifies email and workspace membership, and returns a strict allowlist of tracking fields. Tokens, payment methods and private invoice URLs are excluded. It never changes billing, seats or membership. No extension is installed or required.

This is an unofficial integration, not an approved OpenAI API. [Individual terms](https://openai.com/policies/row-terms-of-use/) restrict automated extraction; the [Services Agreement](https://openai.com/policies/services-agreement/) also restricts extraction except as permitted through the service. No guarantee against account suspension is made. Billing runs only when requested and respects access failures and browser challenges.

## Before hosting

Do not expose the Vite dev or preview server publicly. A hosted version needs a separate design for authentication, server-side authorization, session handling, and storage. A hidden login screen or private source repository is not an authorization boundary.

The intended first deployment is owner-only, with credentials in server-side secret storage and database requests authorized against the signed-in owner. Keep provider browser credentials out of the hosted database. Hosting, retention, backups, deletion, and any communication with a local connector must be settled before enabling cloud sync. The current loopback API does not accept requests from a hosted site.

## Reporting

Use GitHub private vulnerability reporting when enabled on the repository. Do not include tokens, exports, member lists, or other private account details in public issues.
