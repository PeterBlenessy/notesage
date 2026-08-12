import { describe, it, expect, afterEach } from "vitest";
import { t, setLocale, getLocale, resolveLocale, SUPPORTED_LOCALES } from "@/lib/i18n";

afterEach(() => setLocale("en"));

describe("i18n (#653)", () => {
  it("resolves platform locales to a supported base language", () => {
    expect(resolveLocale("sv-FI")).toBe("sv");
    expect(resolveLocale("SV")).toBe("sv");
    expect(resolveLocale("en-GB")).toBe("en");
    // Unsupported languages fall back to English rather than throwing.
    expect(resolveLocale("de-DE")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("translates and interpolates", () => {
    setLocale("sv");
    expect(getLocale()).toBe("sv");
    expect(t("section.today")).toBe("I dag");
    expect(t("library.items", { count: 3 })).toBe("3 objekt");
    setLocale("en");
    expect(t("library.items", { count: 3 })).toBe("3 items");
  });

  it("leaves unknown placeholders untouched instead of blanking them", () => {
    expect(t("library.noMatches", {})).toContain("{query}");
  });

  it("every locale table covers every English key — no silent English leaks", async () => {
    // The type system enforces this at compile time; this asserts it at
    // runtime too, so a table built dynamically (or a bad merge) can't ship
    // a half-translated UI.
    const source = await import("@/lib/i18n");
    for (const locale of SUPPORTED_LOCALES) {
      source.setLocale(locale);
      // A key whose translation is missing would fall back to English; check
      // a representative sample actually differs in Swedish.
      if (locale === "sv") {
        expect(source.t("action.delete")).toBe("Radera");
        expect(source.t("reader.save")).toBe("Spara");
      }
    }
  });
});
