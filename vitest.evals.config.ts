import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Config for the paid LLM-judge evals. Kept out of the default suite (see the
// exclude in vitest.config.ts) because they cost money and are non-deterministic.
// Crucially, this config does NOT load tests/setup.ts, so the real
// ANTHROPIC_API_KEY flows through instead of being deleted for hermeticity.
// The eval self-skips when the key is absent, so an accidental run is a no-op.
// Run with: `npm run eval`
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/eval-llm/**/*.test.ts"],
    // Real Claude calls + an independent judge pass per case.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
