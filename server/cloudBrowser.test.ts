import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BillingProfiles } from "./billingProfiles.ts";
import { browserbaseRequest, cloudUrl } from "./cloudBrowser.ts";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const target = { email: "owner@example.test", accountId: "workspace-1", workspace: true };

it("restores cloud profiles across restarts without mixing accounts or workspaces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "allowance-profiles-"));
  directories.push(directory);
  const profiles = new BillingProfiles(directory);
  expect(await profiles.get(target)).toBeNull();
  await profiles.set(target, "profile-one");
  const restarted = new BillingProfiles(directory);
  expect(await restarted.get({ ...target, email: "OWNER@example.test" })).toBe("profile-one");
  expect(await restarted.get({ ...target, accountId: "workspace-2" })).toBeNull();
  expect(await restarted.get({ ...target, email: "other@example.test" })).toBeNull();
  expect(await restarted.get({ ...target, workspace: false })).toBeNull();
  const files = await readdir(directory);
  expect(files).toHaveLength(1);
  expect(files[0]).not.toContain("owner");
  expect((await stat(join(directory, files[0]))).mode & 0o777).toBe(0o600);
});

it("preserves corrupt profile records instead of silently starting a different session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "allowance-profiles-"));
  directories.push(directory);
  const profiles = new BillingProfiles(directory);
  await profiles.set(target, "profile-one");
  const path = join(directory, (await readdir(directory))[0]);
  await writeFile(path, "broken record");
  await expect(profiles.get(target)).rejects.toThrow("has not been replaced");
  expect(await readFile(path, "utf8")).toBe("broken record");
});

it("keeps cloud credentials in the API header and redacts provider error bodies", async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("private upstream details", { status: 403 }));
  const request = browserbaseRequest("test-private-key", send);
  await expect(request("sessions", {})).rejects.toThrow("credentials or project permissions");
  const [url, options] = send.mock.calls[0];
  expect(url).toBe("https://api.browserbase.com/v1/sessions");
  expect(options?.redirect).toBe("error");
  expect(options?.headers).toMatchObject({ "X-BB-API-Key": "test-private-key" });
  expect(options?.body).not.toContain("test-private-key");
});

it("rejects cloud connection URLs outside the service before connecting or rendering links", () => {
  expect(cloudUrl("wss://connect.browserbase.com?sessionId=test", "wss:")).toContain("connect.browserbase.com");
  expect(cloudUrl("https://www.browserbase.com/live/test", "https:")).toContain("browserbase.com/live");
  for (const url of ["https://browserbase.com.attacker.test/", "http://browserbase.com/", "https://secret@browserbase.com/", "https://127.0.0.1/"]) {
    expect(() => cloudUrl(url, "https:")).toThrow();
  }
});
