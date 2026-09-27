# Allowance

Private single-owner React/TypeScript tracker with a Node server, SQLite and isolated official CLI profiles. Billing dates are manual calendar schedules; no billing fetching, cloud browser, member administration or seat inference.

- `src/PrivateApp.tsx`: authenticated dashboard and connection UI.
- `server/privateApi.ts`: owner authentication and account actions.
- `server/cliProvider.ts`: official Claude Code and Codex connections; no model prompts.
- `server/cliUsage.ts`: provider usage normalization.
- `server/privateStore.ts`: durable accounts, sessions and reset idempotency.
- `src/domain/billingSchedule.ts`: calendar schedules.
- `scripts/check-private-ui.mjs`: isolated Chrome tests with synthetic accounts.

Preserve personal browser data and credentials. Never copy a personal CLI profile into a fixture, image or Git. Keep unknown usage distinct from zero, failed checks visible, and remaining allowance explicit. Never infer Standard/Premium seats or roles. Keep reset retries idempotent across server restarts; live reset redemption requires explicit user authorization.

Run `npm test`, `npm run lint`, and `npm run build`. For UI changes run `npm run test:ui`, then inspect desktop and phone screenshots. This script starts its own disposable server; never overwrite a personal browser profile. Test the container when changing deployment files. Do not claim hosted provider persistence until a real hosted restart check passes.
