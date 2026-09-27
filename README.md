# Allowance

A private dashboard for your Codex, Claude and OpenCode allowance.

- Remaining usage, provider reset times and last successful check.
- Separate provider sign-ins for each account. Credentials stay on the server.
- Codex reset credits, with confirmation and safe retries.
- Monthly or yearly billing dates entered by you.
- Optional Standard/Premium labels for Business accounts, marked Manual.
- One owner, password authentication and a 30-day browser session.

Usage refreshes every five minutes while the page is visible, or when you press Refresh. Failed checks retain the previous reading and timestamp. Your phone can use the deployed app while your computer is off. There is no extension, cloud-browser service, billing scraper, seat inference or model-session estimate.

## Run

Requires Node 24+ on macOS or Linux. The official Claude Code and Codex clients are installed with the project.

```sh
npm ci
npm run setup
npm run dev
```

Open the private setup link printed by `setup`, and choose a password with at least 12 characters. The link expires after 30 minutes and works once. The development address is `http://localhost:5173`.

For the production Node server:

```sh
npm run build
ALLOWANCE_ORIGIN=http://localhost:3000 npm run setup
npm start
```

The server binds to loopback unless `ALLOWANCE_BIND` is set. Public deployments require an exact HTTPS `ALLOWANCE_ORIGIN`, TLS termination, and durable `ALLOWANCE_DATA_DIR` storage. A static deployment to Vercel or Cloudflare Pages alone cannot run the CLIs.

## Connect accounts

**Codex:** Add account → Codex. Open the provider link and enter its device code. Enable device-code login in ChatGPT settings if the provider requires it. Each account uses a separate `CODEX_HOME`; the official app-server handles login and token refresh. This tracks Codex allowance, not every ChatGPT conversation limit.

**Claude:** Add account → Claude. Open the provider link, authorize Claude Code, and paste the resulting sign-in code into the account's code field when prompted. The code goes to the official CLI's stdin. Each account has its own `CLAUDE_CONFIG_DIR`. Allowance does not exchange Claude OAuth tokens itself or send model prompts to read usage. The SDK usage method is experimental; the pinned CLI/SDK versions need retesting when upgraded.

**OpenCode:** Enter a Go API key. It is encrypted before being saved. An unsuccessful replacement preserves the previous working connection.

Reconnect creates a new isolated profile and keeps the old one until the replacement returns valid usage. A changed reported identity clears its saved billing date and seat label. Codex's account response does not identify the workspace separately from its email and plan: after changing Business workspaces, check the manually entered date/seat yourself. Roles and workspace member administration are not shown.

Use Settings → Import saved browser accounts on the old browser origin to copy earlier entries and dates. Reconnect those entries in the new server. Import is additive, excludes credentials and does not erase the old browser data. Export includes account labels, readings and billing dates, but no credentials or owner sessions. Treat exports as private.

## Free deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for Docker, HTTPS, backups and Oracle Always Free. Hosting availability and free-tier limits are provider-controlled. No cloud resource is provisioned by the build.

## Billing dates

Expected billing advances by calendar month or year, not every 30/365 days. A date on the 31st uses the last day of a shorter month and returns to the 31st when possible; annual February 29 uses February 28 in non-leap years.

OpenAI's [invoice-date guidance](https://help.openai.com/en/articles/8156167-invoice-dates-for-chatgpt-and-api-billing) says monthly subscriptions recur on their calendar subscription date. [Business billing](https://help.openai.com/en/articles/8792536-managing-billing-and-seats-in-chatgpt-business) supports monthly/annual schedules and separate prorated seat charges. Exact month-end adjustments are the app's calculation, not a verified provider renewal. Set the date from your regular renewal, and update it after cancellation or a plan change. No payment status or notifications are inferred.

## Checks

```sh
npm test
npm run lint
npm run build
npm run test:ui
```

The UI test starts a disposable server and an isolated Chrome profile. It uses synthetic accounts and mocked reset/refresh responses; it does not redeem real credits. On Linux, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to your installed Chromium executable. Screenshots are written to a temporary directory.

The [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server) and [T3's provider integration](https://github.com/pingdotgg/t3code/tree/main/apps/server/src/provider) informed the CLI approach. JetBrains Mono is bundled locally with its OFL license in `public/fonts/OFL.txt`.
