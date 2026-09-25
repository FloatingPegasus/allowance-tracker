import { it, expect } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { trustedRequest } from './authProxy';
it('accepts only same-origin JSON requests on a loopback host', () => {
  const req = (headers: Record<string,string>) => ({headers}) as IncomingMessage;
  const headers={host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json'};
  expect(trustedRequest(req(headers))).toBe(true);
  expect(trustedRequest(req({...headers,origin:'https://attacker.example'}))).toBe(false);
  expect(trustedRequest(req({...headers,'content-type':'text/plain'}))).toBe(false);
  expect(trustedRequest(req({...headers,host:'attacker.example',origin:'http://attacker.example'}))).toBe(false);
});

import { createServer } from 'node:http';
import { beforeAll, afterAll, vi } from 'vitest';
import { attachAuthRoutes } from './authProxy';
const nativeFetch = globalThis.fetch;
const localServer = createServer();
let origin: string;
let cleanup: () => void;
beforeAll(async () => {
  cleanup = attachAuthRoutes({use(handler) { localServer.on('request',(req,res)=>handler(req,res,()=>{res.writeHead(404);res.end();})); }});
  await new Promise<void>((resolve,reject)=> { localServer.once('error',reject); localServer.listen(0,'127.0.0.1',resolve); });
  const address=localServer.address();
  if (!address || typeof address==='string') throw new Error('No test port');
  origin=`http://127.0.0.1:${address.port}`;
});
afterAll(async()=> { cleanup(); vi.unstubAllGlobals(); localServer.closeAllConnections(); await new Promise<void>(resolve=>localServer.close(()=>resolve())); });
const post = (route:string, body:unknown, from=origin) => nativeFetch(`${origin}/api/auth/${route}`,{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(body)});

it('keeps a pending callback alive after wrong or missing state', async () => {
  expect((await post('listen',{provider:'claude',appOrigin:origin,state:'a'.repeat(22)},'https://external.example')).status).toBe(403);
  const opened=await post('listen',{provider:'claude',appOrigin:origin,state:'a'.repeat(22)});
  expect(opened.status).toBe(200);
  const {redirectUri}=await opened.json() as {redirectUri:string};
  const callback=redirectUri.replace('localhost','127.0.0.1');
  expect((await nativeFetch(`${callback}?code=test`,{redirect:'manual'})).status).toBe(400);
  const accepted=await nativeFetch(`${callback}?code=test&state=${'a'.repeat(22)}`,{redirect:'manual'});
  expect(accepted.status).toBe(302);
  const target=new URL(accepted.headers.get('location')!);
  expect(target.origin).toBe(origin);
  expect(target.searchParams.get('state')).toBe('a'.repeat(22));
  expect(target.searchParams.get('provider')).toBe('claude');
});

it('reads usage even when optional profile metadata is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url:string) => {
    if (url.endsWith('/profile')) throw new Error('profile unavailable');
    return new Response(JSON.stringify({five_hour:{utilization:25}}),{status:200});
  }));
  try {
    const response=await post('usage',{provider:'claude',accessToken:'synthetic-token'});
    expect(response.status).toBe(200);
    const body=await response.json() as {usage:unknown;profile:unknown};
    expect(body.usage).toEqual({five_hour:{utilization:25}});
    expect(body.profile).toBeNull();
  } finally { vi.unstubAllGlobals(); }
});
