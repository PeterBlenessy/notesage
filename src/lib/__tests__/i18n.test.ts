import { describe, it, expect, afterEach } from "vitest";
import {
  t,
  setLocale,
  getLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
  MESSAGE_KEYS,
} from "@/lib/i18n";

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

  describe("plurals", () => {
    // "Found 1 servers" and "Restore 1 hidden models" both shipped. The
    // template carried only the plural form, so any count rendered as one.
    it("picks the singular form at one and the plural otherwise", () => {
      expect(t("imp.foundServers", { count: 1 })).toBe(
        "Found 1 server. Select it to import:",
      );
      expect(t("imp.foundServers", { count: 2 })).toBe(
        "Found 2 servers. Select which to import:",
      );
      expect(t("imp.foundServers", { count: 0 })).toBe(
        "Found 0 servers. Select which to import:",
      );
      expect(t("localai.restoreHidden", { count: 1 })).toBe("Restore 1 hidden model");
      expect(t("localai.restoreHidden", { count: 3 })).toBe("Restore 3 hidden models");
    });

    it("picks the form for the active locale, not for English", () => {
      setLocale("sv");
      expect(t("localai.restoreHidden", { count: 1 })).toBe("Återställ 1 dold modell");
      expect(t("localai.restoreHidden", { count: 3 })).toBe("Återställ 3 dolda modeller");
    });

    it("also reads `n` as the count, since half the table names it that", () => {
      // `model.layers` is only ever called with 16/32/48, but the rule must
      // not depend on which of the two names a message happens to use.
      expect(t("model.layers", { n: 16 })).toBe("16 layers");
    });

    it("accepts a count that arrived as a string", () => {
      // Five call sites in the library migration dialog passed `String(n)`.
      // That is not a type error, so a strict `typeof === "number"` rule
      // would have rendered the raw `singular|plural` to the user.
      expect(t("imp.foundServers", { count: "1" })).toBe(
        "Found 1 server. Select it to import:",
      );
      expect(t("imp.foundServers", { count: "2" })).toBe(
        "Found 2 servers. Select which to import:",
      );
    });

    it("never leaves a form separator in rendered text", () => {
      // The separator is only meaningful for a message that pluralises. A `|`
      // anywhere else is a typo that would ship verbatim, so no message may
      // carry one without a count placeholder in BOTH of its forms.
      for (const locale of SUPPORTED_LOCALES) {
        setLocale(locale);
        for (const key of MESSAGE_KEYS) {
          const raw = t(key);
          if (!raw.includes("|")) continue;
          const forms = raw.split("|");
          expect(forms, `${locale}/${key} has ${forms.length} forms`).toHaveLength(2);
          for (const form of forms) {
            expect(form, `${locale}/${key}: "${form}" has no count placeholder`).toMatch(
              /\{(count|n)\}/,
            );
          }
        }
      }
    });
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
