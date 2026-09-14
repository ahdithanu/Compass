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
    // the LLM-judge evals cost money + hit the Anthropic API. Both run via their
    // own scripts (`test:integration` / `eval`), never in the hermetic suite/CI.
    exclude: ["tests/integration/**", "tests/eval-llm/**", "node_modules/**"],
  },
});
