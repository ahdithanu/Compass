import { describe, it, expect } from "vitest";
import { validateFeed } from "@/lib/feeds";

describe("validateFeed", () => {
  it("accepts a normal https feed and derives a name from the host", () => {
    const v = validateFeed(undefined, "https://www.example.com/feed.xml");
    expect(v.ok).toBe(true);
    expect(v.feed?.name).toBe("example.com");
    expect(v.feed?.url).toBe("https://www.example.com/feed.xml");
  });

  it("keeps a provided name (trimmed + capped)", () => {
    const v = validateFeed("  My Letter  ", "https://ex.com/rss");
    expect(v.feed?.name).toBe("My Letter");
  });

  it("rejects a missing or malformed URL", () => {
    expect(validateFeed("x", "").ok).toBe(false);
    expect(validateFeed("x", "not a url").ok).toBe(false);
  });

  it("rejects an absurdly long URL before parsing", () => {
    const long = "https://ex.com/" + "a".repeat(3000);
    expect(validateFeed("x", long).ok).toBe(false);
  });

  it("rejects non-http(s) protocols", () => {
    expect(validateFeed("x", "ftp://ex.com/feed").ok).toBe(false);
    expect(validateFeed("x", "file:///etc/passwd").ok).toBe(false);
  });

  it("blocks SSRF targets (loopback, private, link-local, metadata)", () => {
    const blocked = [
      "http://localhost/feed",
      "http://127.0.0.1/feed",
      "http://10.1.2.3/feed",
      "http://192.168.0.1/feed",
      "http://172.16.5.4/feed",
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "http://metadata.google.internal/x",
      "http://[::1]/feed",
    ];
    for (const url of blocked) {
      expect(validateFeed("x", url).ok, `should block ${url}`).toBe(false);
    }
  });

  it("allows public IPs and hostnames", () => {
    expect(validateFeed("x", "http://203.0.113.10/feed").ok).toBe(true);
    expect(validateFeed("x", "https://feeds.example.org/rss").ok).toBe(true);
  });
});
