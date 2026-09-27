import { query } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Provider, ResetOutcome, SignIn, Snapshot } from '../src/domain/private.ts';
import { codexSnapshot, claudeSnapshot, record } from './cliUsage.ts';
import { CodexClient } from './codexClient.ts';
import { parseGoUsage } from '../src/domain/opencode.ts';

export interface LoginAttempt {
  profile: string;
  info: SignIn;
  status: () => 'waiting' | 'complete' | 'failed';
  submit: (code: string) => void;
  close: () => void;
}
export interface ProviderService {
  start(provider: Provider): Promise<LoginAttempt>;
  usage(provider: Provider, profile: string | null, key?: string): Promise<Snapshot>;
  reset(profile: string, key: string): Promise<ResetOutcome>;
  removeProfile(profile: string): Promise<void>;
}

export function createCliProvider(directory: string): ProviderService {
  let readers = 0;
  const waiting: (() => void)[] = [];
  async function limited<T>(operation: () => Promise<T>): Promise<T> {
    if (readers >= 2) await new Promise<void>(resolve => waiting.push(resolve));
    else readers++;
    try { return await operation(); }
    finally { const next = waiting.shift(); if (next) next(); else readers--; }
  }
  const codexBinary = process.env.ALLOWANCE_CODEX_BINARY || resolve('node_modules/.bin/codex');
  const claudeBinary = process.env.ALLOWANCE_CLAUDE_BINARY || resolve('node_modules/.bin/claude');
  const profilePath = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid provider profile.');
    return join(directory, 'profiles', id);
  };
  function environment(profile: string): NodeJS.ProcessEnv {
    return {
      PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, TMPDIR: process.env.TMPDIR,
      CODEX_HOME: profile, CLAUDE_CONFIG_DIR: profile, BROWSER: '/usr/bin/true',
      CLAUDE_CODE_SAFE_MODE: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_AUTO_CONNECT_IDE: '0', CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1',
      DISABLE_AUTOUPDATER: '1',
      ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined, CLAUDE_CODE_OAUTH_TOKEN: undefined,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: undefined, OPENAI_API_KEY: undefined, CODEX_API_KEY: undefined,
    };
  }
  async function client(profileId: string) {
    const path = profilePath(profileId);
    const client = new CodexClient(codexBinary, path, environment(path));
    try { await client.initialize(); return client; }
    catch (error) { client.close(); throw error; }
  }
  async function usage(provider: Provider, profile: string | null, key?: string): Promise<Snapshot> {
    if (provider === 'opencode') {
      if (!key) throw new Error('Connect an OpenCode key first.');
      const response = await fetch('https://opencode.ai/zen/go/v1/usage', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok) throw new Error('OpenCode usage could not refresh. Check the key and retry.');
      const reading = parseGoUsage(await response.json(), '');
      if (!reading || !reading.windows.length || reading.windows.some(w => w.usedPercent == null || !Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100)) throw new Error('OpenCode did not return valid usage.');
      return { email: null, identity: null, plan: 'Go', resetCredits: null, windows: reading.windows.map(w => ({ id: w.kind, label: w.kind === 'five_hour' ? '5-hour' : w.kind === 'weekly' ? 'Weekly' : 'Monthly', usedPercent: w.usedPercent ?? 0, resetsAt: w.resetsAt ?? null })) };
    }
    if (!profile) throw new Error('Connect this account first.');
    if (provider === 'codex') {
      const connection = await client(profile);
      try { return codexSnapshot(await connection.request('account/read', { refreshToken: false }), await connection.request('account/rateLimits/read')); }
      finally { connection.close(); }
    }
    const path = profilePath(profile);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 35_000);
    const session = query({
      // A never-yielding input initializes the CLI without making a model request.
      // oxlint-disable-next-line require-yield
      prompt: (async function* () { if (!abort.signal.aborted) await new Promise<void>(resolve => abort.signal.addEventListener('abort', () => resolve(), { once: true })); })(),
      options: {
        pathToClaudeCodeExecutable: claudeBinary, cwd: path, env: environment(path), abortController: abort,
        persistSession: false, settingSources: [], settings: { disableAllHooks: true },
        tools: [], allowedTools: [], permissionMode: 'dontAsk', mcpServers: {}, strictMcpConfig: true,
        stderr: () => {},
      },
    });
    try {
      const initialized = await session.initializationResult();
      const result = await session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      return claudeSnapshot(initialized.account, result);
    } catch { throw new Error('Claude usage could not refresh. Retry or reconnect.'); }
    finally { clearTimeout(timer); abort.abort(); session.close(); }
  }
  return {
    usage: (provider, profile, key) => limited(() => usage(provider, profile, key)),
    async start(provider) {
      if (provider === 'opencode') throw new Error('OpenCode uses an API key.');
      const profile = randomUUID();
      const path = profilePath(profile);
      await mkdir(path, { recursive: true, mode: 0o700 });
      let status: 'waiting' | 'complete' | 'failed' = 'waiting';
      const expiresAt = Date.now() + 10 * 60_000;
      if (provider === 'codex') {
        await writeFile(join(path, 'config.toml'), 'cli_auth_credentials_store = "file"\n', { mode: 0o600 });
        const connection = await client(profile);
        connection.onLogin = success => { status = success ? 'complete' : 'failed'; };
        connection.onClose = () => { if (status === 'waiting') status = 'failed'; };
        try {
          const result = record(await connection.request('account/login/start', { type: 'chatgptDeviceCode' }));
          if (typeof result.verificationUrl !== 'string' || new URL(result.verificationUrl).origin !== 'https://auth.openai.com' || typeof result.userCode !== 'string') throw new Error('Unexpected sign-in response.');
          return { profile, info: { url: result.verificationUrl, code: result.userCode, needsCode: false, expiresAt }, status: () => status, submit: () => {}, close: () => connection.close() };
        } catch { connection.close(); await rm(path, { recursive: true, force: true }); throw new Error('Codex sign-in could not start. Enable device-code login in ChatGPT settings and retry.'); }
      }
      const child = spawn(claudeBinary, ['auth', 'login', '--claudeai'], { cwd: path, env: environment(path), stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdin.on('error', () => {});
      const close = () => {
        child.stdin.end(); child.kill('SIGTERM');
        const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 2000); timer.unref();
      };
      try {
        const url = await new Promise<string>((resolve, reject) => {
          let buffer = '';
          const timer = setTimeout(() => reject(new Error('Sign-in timed out.')), 30_000);
          const receive = (chunk: Buffer) => {
            buffer = (buffer + chunk.toString('utf8')).slice(-65_536);
            const match = buffer.match(/https:\/\/[^\s]+(?=\s)/);
            if (!match) return;
            const url = new URL(match[0]);
            if (!['https://claude.com', 'https://claude.ai'].includes(url.origin) || !url.pathname.endsWith('/oauth/authorize')) return;
            clearTimeout(timer); resolve(url.toString());
          };
          child.stdout.on('data', receive); child.stderr.on('data', receive);
          child.once('error', () => { clearTimeout(timer); status = 'failed'; reject(new Error('Claude could not start.')); });
          child.once('exit', code => { clearTimeout(timer); status = code === 0 ? 'complete' : 'failed'; reject(new Error('Sign-in ended.')); });
        });
        return { profile, info: { url, needsCode: true, expiresAt }, status: () => status,
          submit: code => { if (!code || code.length > 8192 || /[\r\n\0]/.test(code)) throw new Error('Paste the code shown by Claude.'); child.stdin.write(`${code}\n`); }, close };
      } catch { close(); await rm(path, { recursive: true, force: true }); throw new Error('Claude sign-in could not start. Retry shortly.'); }
    },
    async reset(profile, key) {
      const connection = await client(profile);
      try {
        const result = record(await connection.request('account/rateLimitResetCredit/consume', { idempotencyKey: key }));
        if (!['reset', 'alreadyRedeemed', 'nothingToReset', 'noCredit'].includes(result.outcome as string)) throw new Error('Reset result unknown. Retry the same reset.');
        return result.outcome as ResetOutcome;
      } finally { connection.close(); }
    },
    async removeProfile(profile) { await rm(profilePath(profile), { recursive: true, force: true }); },
  };
}
