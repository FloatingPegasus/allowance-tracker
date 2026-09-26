import { defineConfig } from "vite";
export default defineConfig({
  build: { ssr: "server/hosted.ts", outDir: "dist-server", rolldownOptions: { external: ["playwright-core"], output: { entryFileNames: "hosted.mjs" } } },
});
