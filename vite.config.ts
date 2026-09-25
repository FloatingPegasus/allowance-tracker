import type { IncomingMessage } from "node:http";
import react from "@vitejs/plugin-react";
import type { Plugin, ProxyOptions } from "vite";
import { defineConfig } from "vitest/config";
import { attachAuthRoutes } from "./server/authProxy.ts";

function authApi(): Plugin {
  return {
    name: "allowance-auth",
    configureServer(server) {
      const cleanup = attachAuthRoutes(server.middlewares);
      server.httpServer?.once("close", cleanup);
    },
    configurePreviewServer(server) {
      const cleanup = attachAuthRoutes(server.middlewares);
      server.httpServer?.once("close", cleanup);
    },
  };
}

function headerValue(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** Same-origin proxy. OpenCode's usage route answers GET but its OPTIONS preflight is a 404, so the browser cannot call it directly. */
function opencodeUsageProxy(): ProxyOptions {
  return {
    target: "https://opencode.ai",
    changeOrigin: true,
    rewrite: () => "/zen/go/v1/usage",
    configure(proxy) {
      proxy.on("proxyReq", (proxyReq, req) => {
        const key = headerValue(req, "x-allowance-key").trim();
        if (key) proxyReq.setHeader("Authorization", `Bearer ${key}`);
        proxyReq.removeHeader("x-allowance-key");
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), authApi()],
  server: { proxy: { "/api/opencode/usage": opencodeUsageProxy() } },
  preview: { proxy: { "/api/opencode/usage": opencodeUsageProxy() } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
