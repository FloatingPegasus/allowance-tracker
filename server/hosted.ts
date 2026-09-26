import { resolve } from "node:path";
import { createHostedServer } from "./hostedServer.ts";

const required = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`Configure ${name} before starting the hosted server.`); return value; };
const origin = required("ALLOWANCE_ORIGIN");
const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
const server = createHostedServer({ origin, directory: resolve(required("ALLOWANCE_DATA_DIR")), encryptionKey: required("ALLOWANCE_ENCRYPTION_KEY"), passwordHash: required("ALLOWANCE_PASSWORD_HASH"), apiKey: required("BROWSERBASE_API_KEY"), projectId: process.env.BROWSERBASE_PROJECT_ID });
server.listen(Number(process.env.PORT || 8080), local ? "127.0.0.1" : "0.0.0.0", () => console.log("Allowance owner server is ready."));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { server.close(); setTimeout(() => process.exit(0), 10_000).unref(); });
