import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Integration tests hit a live Supabase project and need network + creds;
    // they run via `npm run test:integration`, never in the hermetic suite/CI.
    exclude: ["tests/integration/**", "node_modules/**"],
  },
});
