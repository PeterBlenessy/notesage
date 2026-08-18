// @vitest-environment jsdom
/**
 * The Settings language choice (#705, phase 1).
 *
 * Two modules hold locale state and they must not drift: `settings-store` is
 * the persisted copy, `i18n` is the live one that `t()` and the formatting
 * helpers actually read. Everything below is really one question — does
 * choosing a language in Settings reach the code that renders strings?
 */

import { describe, it, expect, beforeEach } from "vitest";
import "@/test/tauri-mock";
import { useSettingsStore } from "@/stores/settings-store";
import { getLocale, getFormatLocale, setLocale as setI18nLocale, t } from "@/lib/i18n";

describe("settings-store locale", () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: null });
    setI18nLocale(null);
  });

  it("follows the OS by default", () => {
    // `null`, not "en" — the app has no opinion until the user expresses one.
    expect(useSettingsStore.getState().locale).toBeNull();
    expect(getFormatLocale()).toBeUndefined();
  });

  it("makes the choice live immediately, not on next launch", () => {
    useSettingsStore.getState().setLocale("sv");

    expect(useSettingsStore.getState().locale).toBe("sv");
    // The store wrote through to i18n — without this the UI would keep
    // rendering English until restart.
    expect(getLocale()).toBe("sv");
    expect(getFormatLocale()).toBe("sv");
  });

  it("translates through the same switch", () => {
    useSettingsStore.getState().setLocale("sv");
    expect(t("common.cancel")).toBe("Avbryt");
    useSettingsStore.getState().setLocale("en");
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("returns to following the OS when cleared", () => {
    useSettingsStore.getState().setLocale("sv");
    useSettingsStore.getState().setLocale(null);

    expect(useSettingsStore.getState().locale).toBeNull();
    expect(getFormatLocale()).toBeUndefined();
  });

  it("keeps a Swedish choice out of English formatting", () => {
    useSettingsStore.getState().setLocale("sv");
    const d = new Date(Date.UTC(2026, 7, 18));
    const label = d.toLocaleDateString(getFormatLocale(), { month: "long", timeZone: "UTC" });
    // The bug this phase exists to prevent: Swedish labels beside a US date.
    expect(label.toLowerCase()).toContain("augusti");
  });
});
