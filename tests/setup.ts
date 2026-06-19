import { vi, beforeEach } from "vitest";

// Keep test output readable — the pipeline emits structured trace logs we don't
// want printed during runs. (Assertions never depend on console output.)
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// Ensure tests run hermetically: no external API keys -> deterministic
// fallback paths (sample data + rule-based reasoning).
delete process.env.FMP_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.NEWSLETTER_FEEDS;
