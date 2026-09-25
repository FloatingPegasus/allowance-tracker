# Assessment — 25 September 2026

## Purpose

Useful as a local AI usage ledger and estimated session planner. It is not a billing system or an authoritative statement of provider entitlements. The initial accounts and plan economics are presets; real recommendations depend on recent, correctly matched readings. Live provider compatibility remains unverified in this review.

## Changes

- Enforced loopback Host, same-origin JSON, exact OAuth state/provider matching, and callback expiry. Invalid callbacks no longer consume a valid pending login. Callback listeners are cleaned up when the server closes.
- Protected refresh-token rotation, prevented overlapping account syncs, and discarded late responses after disconnect. Optional profile failures no longer discard valid usage.
- Validated imported accounts, windows, identifiers, timestamps and workspace data. Readings cannot silently attach to an ambiguous account, unknown window, or mismatched provider. Count-only updates cannot make a percent-only window known.
- Ranked the limiting window by remaining sessions. Prevented expired banked resets and misleading source changes when renaming an account.
- Preserved unreadable browser storage and surfaced save failures. Imports disconnect old sessions and exclude credentials from exports.
- Replaced the decorative dashboard with a compact account ledger and planner. Collapsed secondary explanations and budget details; labelled plan assumptions and local estimates. Fixed phone overflow in the account form.
- Added maintenance instructions and setup/data-limit documentation.

## Verification

`npm test`: **25 tests passed** across six files, including a real disposable loopback callback flow, input/import boundaries, reading matching, ranking, provider adapters and optional profile failure.

`npm run build` and `npm run lint`: passed. Production output: JavaScript 277.52 kB / 85.51 kB gzip; CSS 9.43 kB / 2.82 kB gzip. No new runtime dependency was added. These are build sizes, not a performance benchmark.

Browser checks: changed a Claude sample reading to 85%, observed the recommendation switch to GLM, and verified persistence after reload. Reviewed desktop and 390px layouts; the phone document fits its viewport. No captured browser warnings or errors. The sample reading remains edited in the test browser profile.

## Remaining limits

- Real ChatGPT/Claude login, refresh and usage, and live OpenCode usage were not exercised with user credentials. Mocked adapters do not prove current provider compatibility.
- Tokens and keys remain unencrypted in localStorage. This is a trusted local-profile application, not a multi-user hosted service. Do not publish its Vite server.
- Preset prices, capacities and session costs are not verified current values. An estimated recommendation cannot guarantee remaining provider capacity.
- Browser checks used desktop emulation, not a physical phone. No exhaustive load, accessibility, or penetration audit is claimed.


## Follow-up: provider-first setup

Setup now offers only ChatGPT, Claude and OpenCode. OAuth starts directly, while OpenCode opens its key field. Account details and usage windows are reconciled from the provider response, rather than requiring a template and label up front. Unknown plans show usage without invented model estimates, and responses cannot borrow metadata from an unrelated ChatGPT workspace. The UI names Codex accounts ChatGPT, consistent with their sign-in provider.

Example accounts are hidden by default and excluded from the planner while hidden. Session planning, model estimates, backups and manual controls are secondary disclosures. Existing saved accounts remain intact. A pending connection is reused when the same provider is clicked again; unavailable storage prevents redirect-based setup.

Verification: 30 tests passed, including five provider-setup regressions. Production build and lint passed. Browser checked OpenCode setup without a plan or account label, automatic key-field focus, persistence and pending-account reuse, plus the responsive provider picker. No real credentials were entered; live OAuth and provider compatibility still require account testing. The preview profile contains an unconnected OpenCode account created by this check.

## 2026-09-25 — Remaining allowance and account management repair

- Confirmed both existing ChatGPT sessions can refresh in the user's Chrome tab after starting the loopback dev server. Business reports Owner; usage meters reflect the remaining quota and explicitly identify the Codex allowance source.
- Replaced fabricated invoices, renewal dates, roster counts, role toggles, and local-only “Refresh billing” success messages with explicit unknown values and persistent manual billing/member/seat records. Legacy values remain in saved exports without being presented as provider facts.
- Workspace identity now uses provider account IDs, never display names; login roles are account-specific. Manual records survive usage refresh and export/import. Personal profile names do not create workspaces.
- Verified in Chrome using synthetic accounts on the separate 127.0.0.1 origin: annual and monthly billing, renewal dates, member role/seat records, inconsistent member-total rejection, save/reload persistence, and cancel. Inspected desktop and 390px screenshots; the mobile document has no horizontal overflow. Fixed a date-field persistence issue found during browser testing.
- Automated checks cover remaining meters, missing/legacy billing, role controls, workspace isolation, record persistence and malformed records. Tests, lint and production build passed.
- Limitation: real provider billing and member-directory synchronization is not implemented by this OAuth connection. Manual fixture tests are not live billing integration tests. Phone validation used browser emulation, not physical hardware.
- Role/access reference: https://learn.chatgpt.com/docs/enterprise/roles-and-workspace-permissions

## 2026-09-25 — Automatic ChatGPT account details

- Supersedes the manual billing/member interface above. Added a local Chrome extension that reads subscription status, renewal dates, recent invoice charges, purchased/assigned/available seats, and paginated membership from the signed-in ChatGPT browser session. Polls on tracker opening and every five minutes while open; pause and retry are available.
- Inspected the actual Business billing and members pages and their response formats in Chrome. Confirmed Standard/Premium seat mappings and invoice minor-unit amounts. The existing Codex OAuth sessions returned 403 for subscription/member/seat endpoints; usage refresh still works for both existing accounts. Browser access is a separate connection, not an OAuth permission workaround.
- Reader credentials remain inside the ChatGPT tab and are sent only to ChatGPT. The extension passes allowlisted normalized fields to the local tracker; tokens, payment methods and private invoice links are excluded. Account ID and signed-in email must both match, with ambiguous matches rejected. No provider writes or account-management operations are implemented.
- Per-section failures preserve previous successful data with visible errors and timestamps. Unknown values do not become zero or estimated bills. Legacy manual records remain in exports but do not appear as automatically synced data.
- Verification: 44 tests across eight files, lint and production build passed. Regression checks cover account isolation, complete pagination, malformed data, partial failures, stale data, credential exclusion, export round trips, invoice currency units and personal accounts. In Chrome, checked missing-extension failure, pause/resume, desktop and 390px screenshots; no document overflow at 390px. User accounts and OAuth sessions were preserved.
- Installation consent was granted, but browser tooling blocked the protected Chrome Extensions page. The extension remains uninstalled and live end-to-end sync unverified; the owner asked to investigate a direct connection instead. Synthetic reader tests do not establish a working live integration. The reader relies on unofficial browser endpoints; changes may require maintenance. It can only refresh the matching currently signed-in ChatGPT login, and member lists over 1,000 are rejected visibly. Claude/OpenCode billing is not implemented. Phone checks used emulation.


## 2026-09-25 — Direct billing access investigation

- Inspected the live Business admin billing page and the signed-in Pro billing page at `/settings/billing`. Both expose actual billing data. No payment, subscription, seat, or security setting was changed.
- Correction to earlier findings: HTTP 403 responses from direct subscription and browser account-check requests include `cf-mitigated: challenge` and non-JSON content. They are browser-security challenges, not evidence that the OAuth user lacks billing permission. Temporary diagnostic code was removed, and no credentials or raw provider responses were logged.
- Verified that successful OAuth usage/account metadata responses and inspected subscription-related token claims do not supply billing dates or invoice amounts. Business access-token creation is disabled in workspace policy; the documented token scopes cover Codex/Workspace Agents rather than billing. No token was created and no policy was enabled.
- The Pro UI reads entitlement data from `/backend-api/accounts/check/v4-2023-04-27`, keyed by exact account ID, and invoices from the transaction-history endpoint. Updated the browser reader accordingly, with regressions against default-account fallback and mislabeling browser challenges as permission denials.
- Replaced unsynced billing fact placeholders with an explicit connection-required state and corrected the personal billing link. No inspected balances or invoices were hardcoded or recorded as an automatic sync. The local extension remains uninstalled; no extension-free unattended billing connection has been established.
- References: https://learn.chatgpt.com/docs/enterprise/access-tokens and https://learn.chatgpt.com/docs/enterprise/service-accounts

Verification for this investigation: 46 tests passed; lint and production build passed. Inspected the revised connection-required state in Chrome at desktop and 390px widths, with no horizontal document overflow. The direct server probes were removed after confirming the challenge response.

## 2026-09-25 — Public repository preparation and per-account checks

- Shortened repeated account copy, collapsed the provider picker after setup, and corrected heading order. Usage meters continue to show remaining allowance.
- Billing sync is opt-in; importing accounts disables it. Added per-entry Check billing and Switch ChatGPT account controls. Usage and billing check timestamps are independent. Failed checks remain on the affected entry with an attempt time, preserving previous billing and section freshness.
- The extension verifies its own sender ID, the top-level frame, exact allowed local origins, and account identities. It rejects duplicate targets and throttles repeated reads while its worker is alive. No hosted origins have been granted access.
- Added secret/export/database ignore rules, a security document, and CI with pinned GitHub Actions. Reviewed source for personal account details and credentials before publication; browser storage and screenshots are not part of the repository.
- Verification: 50 regression tests pass, along with lint and the production build. npm audit reports zero known dependency vulnerabilities. Chrome checks cover a Business-only billing attempt with no extension, an unchanged Pro entry, error persistence after reload, live usage refresh for both saved accounts, and desktop/390px screenshots with no horizontal overflow. Responsive checks used emulation.
- Live billing remains unverified until the owner installs the extension. OpenAI approval and freedom from account suspension are not established. Public deployment and its authentication/storage design remain pending the owner's hosting discussion; the local Vite API is not a production backend.
