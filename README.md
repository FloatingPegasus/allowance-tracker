# Allowance Tracker

A local dashboard for AI account usage, remaining allowance, and billing. Connect ChatGPT, Claude, or OpenCode; account details come from the provider where available.

## Run

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

For the built app, run `npm run build` then `npm run preview -- --host 127.0.0.1 --port 4173`. The Vite dev/preview server provides the local API; serving `dist/` alone does not provide sign-in or usage requests.

## Use

Choose **ChatGPT**, **Claude**, or **OpenCode**. ChatGPT and Claude open sign-in directly; OpenCode asks for a key. No plan, tier, workspace, or account label is required first. The app applies the identity, plan and usage windows the provider reports. Unsupported or missing plan metadata stays unknown rather than becoming a guessed subscription.

The main view shows usage; account settings contain manual readings and labels. Session estimates are optional and depend on local plan presets. Example accounts are hidden until you choose **Show example accounts**, and hidden examples do not affect the planner.

Export creates a JSON backup of accounts and readings, without keys or provider sessions. Import replaces tracked accounts after confirmation and disconnects existing provider sessions. Storage failures are shown; export before closing the tab if a save fails.

## Data and limits

- Plan names, prices, relative capacities and session costs are editable code presets in `src/domain/catalog.ts`, not verified current provider entitlements. Recommendations are estimates, not guarantees.
- Usage meters show remaining allowance, while manual reading inputs accept usage consumed. ChatGPT readings come from the Codex usage endpoint; they are not a complete inventory of ChatGPT model limits.
- ChatGPT billing and workspace data sync automatically through the optional Chrome connection. It reads subscription status, renewal dates, the four most recent transactions' invoice summaries, complete member lists (up to 1,000 members), and purchased/assigned/available seats. These come from ChatGPT's browser endpoints, separate from the Codex OAuth usage connection.
- Billing sync is off by default. After you enable it, it runs every five minutes while the tracker stays open. Importing an export turns it off. Keep a signed-in ChatGPT tab open in the same Chrome profile. Each tracked account is matched by provider account ID and signed-in email. Usage refreshes independently using each saved provider session. Billing can only refresh the matching active ChatGPT login in that Chrome profile; multiple tabs share the profile’s login. Use **Switch ChatGPT account** on an entry, switch or sign in on ChatGPT, then return and choose **Check billing** for that entry. This checks only that account, without enabling background billing sync. Usage and billing have separate last-checked timestamps. A failed billing check records the attempt and error on that entry while retaining its previous data and successful section timestamps. Permission errors and stale sections remain visible independently.
- Invoice charges are actual historical payments, not predictions of the next bill. Unknown fields remain unknown. Manual billing and member forms have been removed; existing legacy records remain preserved in exports.
- Automatic billing and membership sync for Claude and OpenCode is not implemented.
- Session costs and plan capacities remain local estimates. Recording a used reset changes only this dashboard.
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

## Chrome connection setup

1. Open `chrome://extensions` and turn on Developer mode.
2. Choose **Load unpacked** and select the `extension/` folder in this repository.
3. Reload the tracker at `http://localhost:5173/` (or `127.0.0.1`, dev port 5173 or preview port 4173).
4. Keep ChatGPT open and signed in to the account being tracked. Choose **Enable billing sync**. **Sync now** requests a refresh and **Pause sync** stops polling. If the extension is missing, sync turns off with a setup message.

The extension requests ChatGPT host access and scripting access to run its reader in a ChatGPT tab. These browser permissions allow access to ChatGPT page data; the implementation uses only read-only GET requests. Its local bridge only accepts the root page on the four loopback origins above. It does not request cookie, filesystem, or clipboard API permissions. The reader uses the existing browser session in memory, sends credentials only to ChatGPT, and returns a strict allowlist of normalized tracking fields. Tokens, payment methods, and private invoice URLs are never sent to the tracker or saved by the extension. It does not invite users, change seats, or perform billing actions.

This is an unofficial integration with observed ChatGPT browser endpoints; it can require updates when those endpoints change. OpenAI’s terms restrict automated extraction; neither installing an extension nor Chrome Web Store approval guarantees account safety. See [SECURITY.md](SECURITY.md) for the data boundaries and deployment requirements. It does not bypass provider permissions or browser challenges. Direct server requests using the current OAuth login returned HTTP 403 with `cf-mitigated: challenge`; this establishes a browser-security challenge, not a missing account permission. The OAuth usage response itself contains no billing dates or invoices. Business uses the subscription endpoint; personal billing comes from the exact matching account in the browser account-check response.

After editing extension files, reload it on Chrome's Extensions page and reload the tracker. Tests use synthetic responses; live extension verification requires installing this connection. A mocked reader test is not a live provider integration test.

## Deployment status

This repository is a local application, not a deployed service. Hosting and owner login are pending an architecture decision. Do not expose the Vite API on a public domain. No personal account data or provider credentials are included in the source.
