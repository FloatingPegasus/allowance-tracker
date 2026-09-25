import type { BillingTarget } from "../src/domain/billingRecords.ts";
export function readAccount(target: BillingTarget, fetcher?: typeof fetch): Promise<unknown>;
