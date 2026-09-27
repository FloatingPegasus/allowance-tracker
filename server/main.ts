import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { runtime } from './http.ts';

const port = Number(process.env.PORT || 3000);
const origin = process.env.ALLOWANCE_ORIGIN || `http://localhost:${port}`;
const app = runtime(origin);
const root = resolve('dist');
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (origin.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (req.headers.host !== new URL(origin).host) { res.writeHead(421); res.end('Unexpected host.'); return; }
  if (req.url?.startsWith('/api/')) { await app.handle(req, res); return; }
  if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405); res.end(); return; }
  try {
    const path = decodeURIComponent(new URL(req.url || '/', origin).pathname);
    if (path.split('/').some(part => part.startsWith('.'))) throw new Error('Hidden path.');
    const file = resolve(root, path === '/' || path === '/setup' ? 'index.html' : `.${path}`);
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error('Not found.');
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch { res.writeHead(404); res.end('Not found.'); }
});
server.requestTimeout = 45_000;
server.headersTimeout = 10_000;
server.listen(port, process.env.ALLOWANCE_BIND || '127.0.0.1', () => console.log(`Allowance listening at ${origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(() => { void app.close().then(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 5000).unref();
});
