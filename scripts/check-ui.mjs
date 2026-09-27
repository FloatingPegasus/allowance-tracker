import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const origin = process.env.ALLOWANCE_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true }
  : { channel: 'chrome', headless: true });
const output = await mkdtemp(join(tmpdir(), 'allowance-ui-'));
const errors = [];
const now = '2026-02-28T06:30:00.000Z';
const account = (id, plan) => ({
  id, templateId: 'detect-chatgpt', provider: 'chatgpt', plan, seat: null,
  login: `${id}@example.test`, notes: '', windows: [], lanes: [], bankedResets: 0,
  bankedResetExpiresAt: null, supportsBankedResets: false, updatedAt: now,
  readingsKnown: false, readingSource: 'live', providerAccountId: id,
});
const accounts = [account('business', 'Business'), account('personal', 'Pro')];
const saved = { version: 1, intent: 'balanced', holdCodex: false, subscriptions: accounts };
const sessions = Object.fromEntries(accounts.map((item) => [item.id, {
  provider: 'openai', accessToken: 'synthetic-only', refreshToken: 'synthetic-only',
  expiresAt: Date.parse('2099-01-01'), accountId: item.id, email: item.login,
  plan: item.plan, workspaceName: null,
}]));
let failUsage = false;
let usageRequests = 0;
const forbiddenRequests = [];

try {
  const context = await browser.newContext({ timezoneId: 'Asia/Kolkata', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Connect an account' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('14px "JetBrains Mono"')), true);
  assert.equal(await page.getByRole('meter').count(), 0);
  await page.screenshot({ path: join(output, 'empty.png'), fullPage: true });
  await context.addInitScript(({ saved, sessions }) => {
    if (localStorage.getItem('allowance-ui-initialized')) return;
    localStorage.setItem('allowance-tracker/v1', JSON.stringify(saved));
    localStorage.setItem('allowance-tracker/sessions', JSON.stringify(sessions));
    localStorage.setItem('allowance-ui-initialized', 'yes');
  }, { saved, sessions });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/auth/usage') {
      forbiddenRequests.push(url.pathname);
      return route.fulfill({ status: 500, json: { error: 'Unexpected request' } });
    }
    usageRequests++;
    if (failUsage) return route.fulfill({ status: 400, json: { error: 'Sign in again to read usage.' } });
    const { accountId: id } = route.request().postDataJSON();
    return route.fulfill({ json: {
      usage: { account_id: id, email: `${id}@example.test`, plan_type: id === 'business' ? 'self_serve_business_prolite' : 'pro', rate_limit: { primary_window: { used_percent: id === 'business' ? 39 : 98, limit_window_seconds: 604800, reset_at: Date.parse('2026-03-05') / 1000 } } },
      accounts: { accounts: [{ id, name: id === 'business' ? 'Example workspace' : 'Personal', structure: id === 'business' ? 'workspace' : 'personal', account_user_role: 'account-owner' }] },
    } });
  });
  await page.clock.setFixedTime(new Date(now));
  await page.reload();
  const business = page.locator('#seat-business');
  const personal = page.locator('#seat-personal');
  await business.getByText('61% left', { exact: true }).waitFor();
  await personal.getByText('2% left', { exact: true }).waitFor();
  assert.equal(await page.getByText(/Fetch billing|Adjust readings|Invoices/).count(), 0);
  await business.getByRole('button', { name: 'Set billing date', exact: true }).click();
  await business.getByLabel('Billing date', { exact: true }).fill('2026-01-31');
  await business.getByRole('button', { name: 'Save date', exact: true }).click();
  await business.getByText('Today · Monthly · Manual', { exact: true }).waitFor();
  assert.equal(await personal.getByRole('button', { name: 'Set billing date', exact: true }).count(), 1);
  await page.reload();
  await business.getByText('Today · Monthly · Manual', { exact: true }).waitFor();
  await business.getByRole('button', { name: 'Edit billing date', exact: true }).click();
  await business.getByLabel('Billing date', { exact: true }).fill('2026-03-05');
  await business.getByRole('button', { name: 'Cancel', exact: true }).click();
  await business.getByText('Today · Monthly · Manual', { exact: true }).waitFor();
  await business.getByRole('button', { name: 'Edit billing date', exact: true }).click();
  await business.getByLabel('Billing date', { exact: true }).fill('2026-03-05');
  await business.getByRole('button', { name: 'Save date', exact: true }).click();
  await business.getByText('In 5 days · Monthly · Manual', { exact: true }).waitFor();
  failUsage = true;
  await business.getByRole('button', { name: 'Refresh usage', exact: true }).click();
  await business.getByText('Sign in again to read usage.', { exact: true }).waitFor();
  await business.getByText('Last saved usage', { exact: false }).waitFor();
  assert.equal(await business.getByText('61% left', { exact: true }).count(), 1);
  assert.equal(await business.getByText('In 5 days · Monthly · Manual', { exact: true }).count(), 1);
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true });
  failUsage = false;
  await business.getByRole('button', { name: 'Refresh usage', exact: true }).click();
  await business.getByText('Synced', { exact: true }).waitFor();
  await business.locator('summary').click();
  await personal.locator('summary').click();
  assert.equal(await business.getByText('Workspace role: owner', { exact: true }).count(), 1);
  assert.equal(await personal.getByText(/Workspace role/).count(), 0);
  assert.equal(await personal.getByLabel('Business seat (manual)', { exact: true }).count(), 0);
  await business.getByLabel('Business seat (manual)', { exact: true }).selectOption('Premium');
  await business.getByText('Premium seat · Manual', { exact: true }).waitFor();
  assert.equal(await business.getByText('61% left', { exact: true }).count(), 1);
  await page.reload();
  await business.getByText('Premium seat · Manual', { exact: true }).waitFor();
  await business.locator('summary').click();
  await personal.locator('summary').click();
  await business.getByRole('button', { name: 'Edit billing date', exact: true }).click();
  await business.getByLabel('Billing date', { exact: true }).fill('2025-03-05');
  await business.getByLabel('Billing frequency', { exact: true }).selectOption('annual');
  await business.getByRole('button', { name: 'Save date', exact: true }).click();
  await business.getByText('In 5 days · Yearly · Manual', { exact: true }).waitFor();
  await page.reload();
  await business.getByText('In 5 days · Yearly · Manual', { exact: true }).waitFor();
  await business.locator('summary').click();
  await personal.locator('summary').click();
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(output, 'phone.png'), fullPage: true });
  await business.getByRole('button', { name: 'Edit billing date', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(output, 'phone-edit.png'), fullPage: true });
  await business.getByRole('button', { name: 'Remove date', exact: true }).click();
  await page.reload();
  await business.getByRole('button', { name: 'Set billing date', exact: true }).waitFor();
  await business.locator('summary').click();
  await business.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await business.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).waitFor();
  const before = usageRequests;
  await page.reload();
  await personal.getByText('Synced', { exact: true }).waitFor();
  assert.equal(usageRequests, before + 1);
  await page.getByText('Data & backups', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  const exported = await readFile(await download.path(), 'utf8');
  assert.equal(exported.includes('synthetic-only'), false);
  assert.equal(JSON.parse(exported).subscriptions[0].billingSchedule, null);
  assert.equal(JSON.parse(exported).subscriptions[0].manualBusinessSeat, 'Premium');
  await context.close();
  assert.deepEqual(forbiddenRequests, []);
  assert.deepEqual(errors, []);
  console.log('Passed: usage, monthly/yearly dates, manual seats, reload, account isolation, failed refresh, disconnect, export, desktop and 390px layouts.');
  console.log(`Synthetic screenshots: ${output}`);
} catch (error) {
  console.error(`UI check failed; artifacts: ${output}`);
  throw error;
} finally {
  await browser.close();
}
