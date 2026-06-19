import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Config for live integration smoke tests. These talk to a real Supabase
// project, so they're kept out of the default suite (see vitest.config.ts) and
// run on demand with `npm run test:integration`. They self-skip when the
// required env vars aren't present, so an accidental run is a no-op.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    // A real auth round-trip + DB writes can be slower than unit tests.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
