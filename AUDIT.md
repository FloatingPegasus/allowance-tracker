# Verification record

## 27 September 2026 — private usage tracker

The current build is a single-owner Node/SQLite app using the official Claude Code and Codex clients. The earlier billing browser, member management, session estimates and incomplete multi-user backend are retired. Billing dates and Business seat labels are manual.

Live read-only probes verified Claude subscription usage and Codex allowance/reset-credit availability through two fresh CLI processes each without re-login. No prompts or earned resets were consumed. These were local checks; cloud-IP acceptance and hosted login persistence still need a live deployment check.

The automated suite covers calendar recurrence, parser boundaries, owner setup, persistent sessions, logout, host/origin checks, credential exclusion, additive imports, failed-refresh retention, identity changes and reset idempotency through timeout/restart. Chrome tests use synthetic accounts, including mocked reset redemption: login/reload/logout, remaining percentages, saved dates, reset confirmation/cancellation, failed refreshes and 390px layout.

See SECURITY.md for actual storage boundaries. Automated checks are not an independent security audit or a guarantee of uninterrupted provider access.

Results: 53 tests passed; lint and production build passed. Desktop and 390px Chrome screenshots were reviewed. A Linux ARM64 Docker image built successfully. Its owner login, account database and session cookie survived a container restart; both installed CLIs started their official sign-in flows and were cancelled without entering provider credentials. No cloud deployment or live reset redemption occurred.
