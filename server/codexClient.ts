import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { record } from './cliUsage.ts';

const methods = new Set(['initialize', 'account/read', 'account/rateLimits/read', 'account/login/start', 'account/login/cancel', 'account/rateLimitResetCredit/consume']);
export class CodexClient {
  readonly child: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  onLogin: (success: boolean) => void = () => {};
  onClose: () => void = () => {};
  constructor(binary: string, profile: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(binary, ['app-server'], { cwd: profile, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume();
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', line => {
      let message: Record<string, unknown>;
      try { message = record(JSON.parse(line)); } catch { return; }
      if (message.method) {
        if (message.method === 'account/login/completed') this.onLogin(record(message.params).success === true);
        if (message.id !== undefined) this.child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unsupported by usage tracker' } }) + '\n');
        return;
      }
      const pending = this.pending.get(message.id as number);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id as number);
      if (message.error) pending.reject(new Error('Codex request failed. Retry or reconnect.'));
      else pending.resolve(message.result);
    });
    const ended = () => {
      lines.close();
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codex connection closed. Retry or reconnect.')); }
      this.pending.clear(); this.onClose();
    };
    this.child.once('exit', ended);
    this.child.once('error', ended);
    this.child.stdin.on('error', () => {});
  }
  request(method: string, params: unknown = null): Promise<unknown> {
    if (!methods.has(method)) throw new Error('Unsupported Codex method.');
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex timed out. Retry shortly.')); }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'allowance', title: 'Allowance', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  }
  close() {
    this.child.stdin.end();
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => { if (this.child.exitCode === null) this.child.kill('SIGKILL'); }, 2000);
    timer.unref();
  }
}
