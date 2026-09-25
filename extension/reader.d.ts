import type { BrowserDetails, BrowserTarget } from "../src/domain/browserSync";
export function readAccount(target: BrowserTarget, fetcher?: typeof fetch): Promise<BrowserDetails | { error: string } | { mismatch: true }>;
