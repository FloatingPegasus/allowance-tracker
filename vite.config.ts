import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { runtime } from "./server/http.ts";

function authApi(): Plugin {
  return {
    name: "allowance-auth",
    configureServer(server) {
      const app = runtime(process.env.ALLOWANCE_ORIGIN || "http://localhost:5173");
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/')) void app.handle(req, res);
        else next();
      });
      server.httpServer?.once("close", () => { void app.close(); });
    },
  };
}

export default defineConfig({
  plugins: [react(), authApi()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
