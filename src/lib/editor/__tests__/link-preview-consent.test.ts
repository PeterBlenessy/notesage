import { describe, it, expect, beforeEach } from "vitest";
import {
  markPreviewConsent,
  hasPreviewConsent,
  __resetPreviewConsent,
} from "../link-preview-consent";

describe("link-preview-consent", () => {
  beforeEach(() => {
    __resetPreviewConsent();
  });

  it("returns false for a URL the user never approved (disk/agent content)", () => {
    // The security-relevant default: a bare `> [!link](url)` deserialized from
    // disk has no consent, so the card must NOT zero-click fetch it.
    expect(hasPreviewConsent("https://attacker.example/track?id=1")).toBe(false);
  });

  it("returns true after the user explicitly consents", () => {
    markPreviewConsent("https://example.com/article");
    expect(hasPreviewConsent("https://example.com/article")).toBe(true);
  });

  it("trims whitespace on both write and read", () => {
    markPreviewConsent("  https://example.com/x  ");
    expect(hasPreviewConsent("https://example.com/x")).toBe(true);
    expect(hasPreviewConsent("  https://example.com/x  ")).toBe(true);
  });

  it("ignores empty/whitespace-only URLs", () => {
    markPreviewConsent("   ");
    markPreviewConsent("");
    expect(hasPreviewConsent("")).toBe(false);
    expect(hasPreviewConsent("   ")).toBe(false);
  });

  it("keeps consent per-URL — approving one does not approve another", () => {
    markPreviewConsent("https://example.com/a");
    expect(hasPreviewConsent("https://example.com/a")).toBe(true);
    expect(hasPreviewConsent("https://example.com/b")).toBe(false);
  });

  it("__resetPreviewConsent clears all recorded consent", () => {
    markPreviewConsent("https://example.com/a");
    __resetPreviewConsent();
    expect(hasPreviewConsent("https://example.com/a")).toBe(false);
  });
});
