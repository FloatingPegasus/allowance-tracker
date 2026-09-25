# Security

Allowance currently runs on localhost. There is no hosted database, shared account, or remote data sync. The public repository contains application code and synthetic test fixtures, not browser data.

## Local data

Account readings and billing records stay in browser localStorage. Provider tokens and OpenCode keys are also stored there, unencrypted. Anyone with access to that browser profile, or malicious code running on the app's origin, may be able to read them. Use a trusted profile and keep the development server bound to loopback.

Exports exclude provider sessions and keys, but contain account identifiers, usage, and any synced billing/member records. Treat exports as private. `.gitignore` excludes common environment, database, credential, export, and backup files; this does not replace reviewing staged files before publishing.

## Browser connection

The optional extension accepts messages only from the top-level local tracker at ports 5173 and 4173. It makes read-only requests in a signed-in ChatGPT tab. It returns validated account fields and omits tokens, payment methods, and private invoice URLs. Account ID and email must match. Repeated requests are throttled while the extension worker is running.

This is an unofficial integration, not an approved OpenAI API. Chrome installation or store approval would not establish OpenAI approval. [Individual terms](https://openai.com/policies/row-terms-of-use/) restrict automated extraction; the [Services Agreement](https://openai.com/policies/services-agreement/) also restricts extraction except as permitted through the service. No guarantee against account suspension is made. Sync is opt-in and can be paused.

## Before hosting

Do not expose the Vite dev or preview server publicly. A hosted version needs a separate design for authentication, server-side authorization, session handling, and storage. A hidden login screen or private source repository is not an authorization boundary.

The intended first deployment is owner-only, with credentials in server-side secret storage and database requests authorized against the signed-in owner. Keep provider browser credentials out of the hosted database. Hosting, retention, backups, deletion, and the extension's exact allowed production origin must be settled before enabling cloud sync.

## Reporting

Use GitHub private vulnerability reporting when enabled on the repository. Do not include tokens, exports, member lists, or other private account details in public issues.
