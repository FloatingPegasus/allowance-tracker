# Allowance Tracker

Track provider-reported AI allowance locally, and check ChatGPT billing on demand through a saved cloud browser session. The hosted build adds an owner login and encrypted billing storage for access from other devices.

## Run

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

For the built app, run `npm run build` then `npm run preview -- --host 127.0.0.1 --port 4173`. The Vite dev/preview server provides the local API; serving `dist/` alone does not provide sign-in or usage requests.

## Use

Choose **ChatGPT**, **Claude**, or **OpenCode**. ChatGPT and Claude open sign-in directly; OpenCode asks for a key. No plan, tier, workspace, or account label is required first. The app applies the identity, plan and usage windows the provider reports. Unsupported or missing plan metadata stays unknown rather than becoming a guessed subscription.

The main view shows each account’s remaining allowance, reset times, and freshness. Readings older than two minutes are marked out of date. Failed refreshes keep the last saved reading and show the error. Disconnected accounts with no reading never show free capacity. Account details contains disconnect/remove actions and the ChatGPT billing connection. New installs start empty; existing accounts and legacy export fields are preserved.

Export creates a JSON backup of accounts and readings, without keys or provider sessions. Import replaces tracked accounts after confirmation and disconnects existing provider sessions. Storage failures are shown; export before closing the tab if a save fails.

## Data and limits

- Usage meters show remaining allowance. There are no manual overrides, local reset actions, model-session estimates, or recommendations. ChatGPT readings come from the Codex usage endpoint; they are not a complete inventory of ChatGPT model limits.
- ChatGPT billing is fetched only when requested for an individual account. The billing reader returns subscription status, renewal dates, invoice summaries from the four most recent transactions, complete member lists (up to 1,000 members), and purchased/assigned/available seats where permitted. These come from ChatGPT's browser endpoints, separate from the Codex OAuth usage connection.
- Usage refreshes independently using each saved provider session. Billing has no background polling and needs no extension. Each check verifies the selected provider account ID and signed-in email. Usage and billing have separate last-checked timestamps. Failed checks retain previous data and successful section timestamps, with a dated error on the affected entry.
- Invoice charges are actual historical payments, not predictions of the next bill. Unknown fields remain unknown. Manual billing and member forms have been removed; existing legacy records remain preserved in exports.
- Automatic billing and membership sync for Claude and OpenCode is not implemented.
- Usage refreshes every minute while the page is open. There is no background service, usage history, or alert delivery yet. Legacy planner and manual-record fields remain importable but are not used to infer live allowance.
- ChatGPT/Claude sign-in uses provider-specific OAuth/usage interfaces. They may change or reject this client. They require interactive account login to verify end to end. OpenCode uses its usage endpoint through a local proxy.
- Provider tokens and OpenCode keys are stored unencrypted in this browser profile's localStorage. Use a trusted local profile. Passwords stay with the provider; exports exclude tokens and keys.
- The app binds to loopback for local use. Do not expose the development/preview server to a public network.

## Checks

```sh
npm test
npm run lint
npm run build
```

See [AGENTS.md](AGENTS.md) for maintenance rules and [AUDIT.md](AUDIT.md) for the latest assessment.

## Cloud billing connection

The optional Browserbase connector runs the billing browser in the cloud. Each exact login/workspace pair has its own persistent Browserbase Context. The local server keeps only the context mapping in `.allowance/profiles/`; browser cookies stay in Browserbase's encrypted profile storage. Normal fetches try the saved session first. If sign-in is needed, the account shows a link to its interactive cloud browser.

1. Create a Browserbase project and copy `.env.example` to `.env.local`.
2. Set `BROWSERBASE_API_KEY` to the API key value. The dashboard's copy button may include `BROWSERBASE_API_KEY=`; keep that prefix only once. Set `BROWSERBASE_PROJECT_ID` only if the key needs an explicit project.
3. Restart the app. Open the selected account's billing section and choose **Fetch billing**.
4. If prompted, open the cloud browser, sign in to the indicated ChatGPT account, then choose **I'm signed in · fetch billing**.

Only server configuration uses the API key. Never prefix it with `VITE_`, commit it, or paste it into chat. The connector disables session recordings, browser logs and automatic CAPTCHA solving. Browser sessions close after a read, cancellation or fourteen minutes. The profile remains available for later reads; websites can still expire or revoke its authentication.

Live Business and Pro billing have both been verified, including a second fetch for each account using its saved cloud profile without signing in again. This does not guarantee future compatibility or permanent authentication. The hosted backend below lets these checks run without a local Mac process once deployed.

## Local billing connection

Without a Browserbase API key, the app uses a temporary local Chrome window. Its sign-in has failed during live testing; this fallback is not a verified billing integration.

1. Run Allowance locally with Google Chrome installed, and connect the account's usage login.
2. Open **Account details → Billing & workspace → Fetch billing** on that account.
3. Sign in to the indicated account in the temporary Chrome window. This isolated session does not use your regular Chrome profile, so it requires its own login.
4. Return to Allowance and choose **I'm signed in · fetch billing**. Only that entry is checked. A different login is rejected without saving its data.

The window closes after the read, cancellation, or fourteen minutes. The connector does not save a browser profile or export its cookies. Passwords are entered directly on ChatGPT. The reader makes GET requests and returns only validated tracking fields; provider tokens, payment methods and private invoice URLs are omitted. It does not invite users, change seats, or perform billing actions. Existing records remain readable after the window closes.

This is an unofficial integration with observed ChatGPT browser endpoints; it may break or be blocked. OpenAI's terms restrict automated extraction, and no account-safety guarantee is made. See [SECURITY.md](SECURITY.md). The connector does not bypass provider permissions or browser challenges. Direct server billing requests using the current OAuth login returned HTTP 403 with `cf-mitigated: challenge`; that establishes a browser challenge, not a missing account permission. The OAuth usage response contains no billing dates or invoices.

Business uses the subscription endpoint after exact workspace membership validation; personal billing comes from the exact matching account in the account-check response. Tests use synthetic responses and disposable local servers. They do not establish live provider compatibility.

## Official administration APIs

The [OpenAI API Platform Admin API](https://developers.openai.com/api/docs/guides/admin-apis) manages Platform organizations and projects. It is separate from ChatGPT workspace administration and subscription billing.

ChatGPT has a separate Admin API for enabled workspace features, with its own scoped keys. Official documentation covers [service-account management](https://learn.chatgpt.com/docs/enterprise/service-accounts) and [app permissions](https://developers.openai.com/cookbook/examples/chatgpt/sharepoint_site_access/sharepoint_site_access). These documents do not establish a generally available Business invoice or subscription-billing API. This app does not request an admin key or claim that a Business plan grants access. Confirm workspace eligibility, exact read scopes, and endpoint coverage before replacing the browser connector.

## Hosted billing

The hosted build is a single-owner billing dashboard. It displays saved billing immediately, offers **Fetch billing** on each account and **Fetch all billing**, and pauses for sign-in when a cloud profile needs it. Provider usage OAuth remains in the local app; this build does not claim cloud usage refresh.

Requirements: Node 24+, a Browserbase project, an HTTPS hostname, and one server instance with private persistent storage. A static deployment is insufficient. Do not publish the Vite dev/preview server.

```sh
node scripts/create-owner.mjs
npm run build:hosted
npm start
```

The setup script creates a random owner password and its salted hash in the ignored, mode-0600 `.allowance/owner-setup.txt`. It refuses to overwrite an existing file. Save the password in a password manager. Set these **server-only** environment variables before starting:

- `ALLOWANCE_ORIGIN`: the exact public HTTPS origin, without a trailing slash. Local testing also permits `http://localhost:8080`.
- `ALLOWANCE_DATA_DIR`: a private persistent directory, outside `dist/`.
- `ALLOWANCE_PASSWORD_HASH`: the hash from the private setup file. Changing it invalidates existing owner sessions.
- `ALLOWANCE_ENCRYPTION_KEY`: a base64-encoded random 32-byte key. Keep a secure backup; losing it makes the database unreadable.
- `BROWSERBASE_API_KEY`: the service API key; optionally `BROWSERBASE_PROJECT_ID`.
- `PORT`: defaults to 8080; managed hosts may supply it.

Sign in with the owner password. On first setup, export the connected accounts from the local app, then import that file on the hosted dashboard. The server adds only ChatGPT identities and validated billing records, excludes usage credentials, and keeps existing records. Treat the export as private. New cloud profiles require sign-in once. To preserve existing profiles when moving servers, securely move the private `profiles/` directory to the new data directory; it never belongs in Git or a dashboard export.

The backend stores account records encrypted with AES-256-GCM in SQLite. Owner sessions use random tokens in HttpOnly, SameSite=Strict cookies (Secure on HTTPS); only token hashes are stored. Every account and billing API requires owner authentication. Writes also require the configured Host, exact Origin and JSON content type. Billing checks verify the selected account before reading and saving. Browser passwords and cookies stay in Browserbase.

### Deployment package

`render.yaml` prepares an owner-only Render Node service with a 1 GB persistent disk, checks-before-deploy, and `allowance.kanishq.dev`. It does **not** provision a service until explicitly applied. It prompts for the password hash and Browserbase key, and generates a separate encryption key. Set the optional project ID separately if needed.

As checked on 26 September 2026, the proposed service is approximately $7.25/month before taxes and excess usage ($7 compute + $0.25 disk). Browserbase usage is separate. Verify the [current pricing](https://render.com/pricing) before provisioning. Free Render services have no persistent disk and are unsuitable for this SQLite setup. The same Node build can run on an existing server with a private persistent volume.

After provisioning, add the DNS record supplied by the host, wait for HTTPS, and verify sign-in, an unauthenticated API denial, each account's live billing fetch, and persistence after a restart. Keep encrypted database backups, profile mappings, and the encryption key separately and securely; a filesystem snapshot alone is not a tested database backup. Single-instance hosting is required because browser checks and SQLite access are coordinated within one process.

The hosted package has local automated and browser tests. Public deployment, real-phone access, DNS/TLS and production recovery remain unverified until provisioning is completed. No account data, browser profiles or provider credentials are included in the public source.
