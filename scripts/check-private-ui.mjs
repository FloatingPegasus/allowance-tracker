import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { PrivateStore } from '../server/privateStore.ts';
import { hashPassword } from '../server/password.ts';
import { blankAccount } from '../server/privateApi.ts';

const directory = await mkdtemp(join(tmpdir(), 'allowance-private-ui-'));
const dataDirectory = join(directory, 'data');
const password = `test-${randomUUID()}`;
const store = new PrivateStore(dataDirectory);
store.set('passwordHash', await hashPassword(password));
const accounts = ['codex', 'codex', 'claude'].map((provider, index) => {
  const account = blankAccount(provider);
  Object.assign(account, { email: `account${index + 1}@example.com`, plan: index === 0 ? 'Business' : 'Pro', connected: true,
    windows: [{ id: 'weekly', label: 'Weekly', usedPercent: [39, 98, 50][index], resetsAt: new Date(Date.now() + 86400_000).toISOString() }], checkedAt: new Date().toISOString(),
    resetCredits: provider === 'codex' ? { count: 1, expiresAt: new Date(Date.now() + 864000_000).toISOString() } : null,
    businessSeat: index === 0 ? 'Premium' : null });
  store.save(account); return account;
});
store.close();
const port = 4179;
const origin = `http://localhost:${port}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), ALLOWANCE_DATA_DIR: dataDirectory, ALLOWANCE_ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverOutput += chunk; });
let browser;
try {
  const deadline = Date.now() + 20000;
  while (true) {
    try { if ((await fetch(origin + '/api/health')).ok) break; } catch {}
    if (Date.now() > deadline || server.exitCode !== null) throw new Error(`Server failed to start: ${serverOutput}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await fetch(origin + '/api/accounts')).status, 401);
  assert.equal((await fetch(origin + '/.env.local')).status, 404);
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium.executablePath()), headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Your accounts' }).waitFor();
  const cards = page.getByRole('article');
  await cards.nth(2).waitFor();
  assert.equal(await cards.nth(0).getByRole('meter').getAttribute('aria-valuenow'), '61');
  assert.equal(await cards.nth(1).getByRole('meter').getAttribute('aria-valuenow'), '2');
  assert.match(await cards.nth(0).innerText(), /Premium seat · Manual/);
  assert.equal(await page.getByText('Adjust readings', { exact: true }).count(), 0);
  assert.equal((await context.cookies()).find(c => c.name === 'allowance').httpOnly, true);
  await page.reload();
  await page.getByRole('heading', { name: 'Your accounts' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await cards.nth(0).getByRole('button', { name: 'Set billing date' }).click();
  await cards.nth(0).getByLabel('Billing date', { exact: true }).fill('2026-01-31');
  await cards.nth(0).getByRole('button', { name: 'Save date' }).click();
  await page.waitForResponse(response => response.url().endsWith('/settings') && response.status() === 200);
  await page.reload();
  await cards.nth(0).getByText(/Expected billing/).waitFor();
  let resetCalls = 0;
  await page.route('**/api/accounts/*/reset', async route => {
    resetCalls++;
    const body = route.request().postDataJSON(); assert.equal(body.confirm, true); assert.match(body.requestId, /^[0-9a-f-]{36}$/);
    await route.fulfill({ json: { outcome: 'reset', account: { ...accounts[0], windows: [{ ...accounts[0].windows[0], usedPercent: 0 }], resetCredits: { count: 0, expiresAt: null } } } });
  });
  await cards.nth(0).getByRole('button', { name: 'Use reset', exact: true }).click();
  assert.equal(resetCalls, 0);
  await cards.nth(0).getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(resetCalls, 0);
  await cards.nth(0).getByRole('button', { name: 'Use reset', exact: true }).click();
  await cards.nth(0).getByRole('button', { name: 'Confirm reset' }).click();
  await page.getByText('Reset used.', { exact: false }).waitFor();
  assert.equal(resetCalls, 1);
  assert.equal(await cards.nth(0).getByRole('meter').getAttribute('aria-valuenow'), '100');
  await page.route('**/api/accounts/*/refresh', route => route.fulfill({ json: { account: { ...accounts[1], error: 'Usage could not refresh. Retry or reconnect.' } } }));
  await cards.nth(1).getByRole('button', { name: 'Refresh usage' }).click();
  await cards.nth(1).getByRole('alert').waitFor();
  assert.equal(await cards.nth(1).getByRole('meter').getAttribute('aria-valuenow'), '2');
  await page.screenshot({ path: join(directory, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Phone view must not overflow');
  await page.screenshot({ path: join(directory, 'phone.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).waitFor();
  await page.reload();
  await page.getByLabel('Password', { exact: true }).waitFor();
  assert.equal(await page.getByRole('article').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`Private UI checks passed. Screenshots: ${directory}`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
  await rm(dataDirectory, { recursive: true, force: true });
}
