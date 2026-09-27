import type { IncomingMessage, ServerResponse } from 'node:http';
import { PrivateStore } from './privateStore.ts';
import { createCliProvider } from './cliProvider.ts';
import { createPrivateApi } from './privateApi.ts';
import { resolve } from 'node:path';

export function runtime(origin: string, directory = resolve(process.env.ALLOWANCE_DATA_DIR || '.allowance')) {
  process.umask(0o077);
  const store = new PrivateStore(directory);
  const api = createPrivateApi(store, createCliProvider(directory), origin);
  return {
    async close() { await api.close(); store.close(); },
    async handle(req: IncomingMessage, res: ServerResponse) {
      try {
        if (req.headers.host !== new URL(origin).host) { res.writeHead(421); res.end('Unexpected host.'); return; }
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        const chunks: Buffer[] = []; let size = 0;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) { res.writeHead(413); res.end('Request too large.'); return; } chunks.push(chunk); }
        }
        const response = await api.handle(new Request(new URL(req.url || '/', origin), { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }));
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch { if (!res.headersSent) res.writeHead(500, { 'Cache-Control': 'no-store' }); res.end('Request failed.'); }
    },
  };
}
