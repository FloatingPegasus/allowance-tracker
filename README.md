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
- ChatGPT billing is fetched only when requested for an individual account. The local Chrome connector reads subscription status, renewal dates, invoice summaries from the four most recent transactions, complete member lists (up to 1,000 members), and purchased/assigned/available seats where permitted. These come from ChatGPT's browser endpoints, separate from the Codex OAuth usage connection.
- Usage refreshes independently using each saved provider session. Billing has no background polling and needs no extension. Each check verifies the selected provider account ID and signed-in email. Usage and billing have separate last-checked timestamps. Failed checks retain previous data and successful section timestamps, with a dated error on the affected entry.
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

## Fetch billing once

1. Run Allowance locally with Google Chrome installed, and connect the account's usage login.
2. Choose **Billing** beside that account, then **Fetch billing**.
3. Sign in to the indicated account in the temporary Chrome window. This isolated session does not use your regular Chrome profile, so it requires its own login.
4. Return to Allowance and choose **I'm signed in · fetch billing**. Only that entry is checked. A different login is rejected without saving its data.

The window closes after the read, cancellation, or eight minutes. The connector does not save a browser profile or export its cookies. Passwords are entered directly on ChatGPT. The reader makes GET requests and returns only validated tracking fields; provider tokens, payment methods and private invoice URLs are omitted. It does not invite users, change seats, or perform billing actions. Existing records remain readable after the window closes.

This is an unofficial integration with observed ChatGPT browser endpoints; it may break or be blocked. OpenAI's terms restrict automated extraction, and no account-safety guarantee is made. See [SECURITY.md](SECURITY.md). The connector does not bypass provider permissions or browser challenges. Direct server billing requests using the current OAuth login returned HTTP 403 with `cf-mitigated: challenge`; that establishes a browser challenge, not a missing account permission. The OAuth usage response contains no billing dates or invoices.

Business uses the subscription endpoint after exact workspace membership validation; personal billing comes from the exact matching account in the account-check response. Tests use synthetic responses and disposable local servers. They do not establish live provider compatibility.

## Official administration APIs

The [OpenAI API Platform Admin API](https://developers.openai.com/api/docs/guides/admin-apis) manages Platform organizations and projects. It is separate from ChatGPT workspace administration and subscription billing.

ChatGPT has a separate Admin API for enabled workspace features, with its own scoped keys. Official documentation covers [service-account management](https://learn.chatgpt.com/docs/enterprise/service-accounts) and [app permissions](https://developers.openai.com/cookbook/examples/chatgpt/sharepoint_site_access/sharepoint_site_access). These documents do not establish a generally available Business invoice or subscription-billing API. This app does not request an admin key or claim that a Business plan grants access. Confirm workspace eligibility, exact read scopes, and endpoint coverage before replacing the browser connector.

## Deployment status

This repository is a local application, not a deployed service. Hosting and owner login are pending an architecture decision. A hosted web page cannot open or inspect your local Chrome session by itself; this connector needs a local process. Do not expose the Vite API on a public domain. No personal account data or provider credentials are included in the source.
