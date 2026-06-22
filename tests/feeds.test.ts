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

  it("blocks SSRF targets hidden in alternate IP encodings", () => {
    const blocked = [
      "http://2852039166/feed", // decimal 169.254.169.254
      "http://0xA9FEA9FE/feed", // hex 169.254.169.254
      "http://0251.0376.0251.0376/feed", // octal 169.254.169.254
      "http://0/feed", // 0.0.0.0
      "http://[::ffff:169.254.169.254]/feed", // IPv4-mapped IPv6
      "http://[::ffff:a9fe:a9fe]/feed", // IPv4-mapped IPv6 (hex)
      "http://[0:0:0:0:0:0:0:1]/feed", // expanded IPv6 loopback
      "http://127.0.0.1.feed", // not an IP — but ensure no crash
    ];
    expect(validateFeed("x", blocked[0]).ok, blocked[0]).toBe(false);
    expect(validateFeed("x", blocked[1]).ok, blocked[1]).toBe(false);
    expect(validateFeed("x", blocked[2]).ok, blocked[2]).toBe(false);
    expect(validateFeed("x", blocked[3]).ok, blocked[3]).toBe(false);
    expect(validateFeed("x", blocked[4]).ok, blocked[4]).toBe(false);
    expect(validateFeed("x", blocked[5]).ok, blocked[5]).toBe(false);
    expect(validateFeed("x", blocked[6]).ok, blocked[6]).toBe(false);
  });

  it("blocks IPv4-embedded IPv6 (compatible + NAT64 forms)", () => {
    const blocked = [
      "http://[::169.254.169.254]/feed", // IPv4-compatible IPv6
      "http://[::a9fe:a9fe]/feed", // same, hex-compressed
      "http://[64:ff9b::169.254.169.254]/feed", // NAT64 wrapping metadata
      "http://[64:ff9b::a9fe:a9fe]/feed", // NAT64, hex
      "http://[::ffff:7f00:1]/feed", // mapped loopback 127.0.0.1
    ];
    for (const url of blocked) {
      expect(validateFeed("x", url).ok, `should block ${url}`).toBe(false);
    }
  });

  it("allows public IPs and hostnames (no false positives)", () => {
    expect(validateFeed("x", "http://203.0.113.10/feed").ok).toBe(true);
    expect(validateFeed("x", "https://feeds.example.org/rss").ok).toBe(true);
    expect(validateFeed("x", "http://[2606:4700::6810:85e5]/feed").ok).toBe(true); // public IPv6 (Cloudflare)
  });
});
