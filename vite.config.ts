import type { IncomingMessage } from "node:http";
import react from "@vitejs/plugin-react";
import type { Plugin, ProxyOptions } from "vite";
import { defineConfig } from "vitest/config";
import { attachAuthRoutes } from "./server/authProxy.ts";
import { createBillingRoutes } from "./server/billingBrowser.ts";
import { cloudBrowser } from "./server/cloudBrowser.ts";
import { loadEnv } from "vite";
import { resolve } from "node:path";

function authApi(env: Record<string, string>): Plugin {
  const launch = env.BROWSERBASE_API_KEY ? cloudBrowser({ apiKey: env.BROWSERBASE_API_KEY, projectId: env.BROWSERBASE_PROJECT_ID, directory: resolve(env.ALLOWANCE_DATA_DIR || ".allowance", "profiles") }) : undefined;
  const launchError = launch ? "Could not start the cloud billing browser. Check the server credentials, service allowance and saved profile storage." : undefined;
  return {
    name: "allowance-auth",
    configureServer(server) {
      const cleanup = attachAuthRoutes(server.middlewares);
      const billing = createBillingRoutes(launch, undefined, launchError);
      server.middlewares.use(billing.middleware);
      server.httpServer?.once("close", billing.cleanup);
      server.httpServer?.once("close", cleanup);
    },
    configurePreviewServer(server) {
      const cleanup = attachAuthRoutes(server.middlewares);
      const billing = createBillingRoutes(launch, undefined, launchError);
      server.middlewares.use(billing.middleware);
      server.httpServer?.once("close", billing.cleanup);
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

export default defineConfig(({ mode }) => ({
  plugins: [react(), authApi(loadEnv(mode, process.cwd(), ""))],
  server: { proxy: { "/api/opencode/usage": opencodeUsageProxy() } },
  preview: { proxy: { "/api/opencode/usage": opencodeUsageProxy() } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
}));
