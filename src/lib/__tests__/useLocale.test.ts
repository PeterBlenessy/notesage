// @vitest-environment jsdom
/**
 * Unit tests for `useFormattingLocale` (#705) — the hook the audited
 * date/number formatting call sites read instead of calling
 * `toLocaleDateString()`/`Intl.*` with no locale argument.
 *
 * `settings-store` is mocked to a minimal selector shape (mirrors the
 * pattern in `useQuietChrome.test.ts`) so this stays a fast, isolated unit
 * test rather than dragging in the full persist/localStorage machinery.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Locale } from "@/lib/i18n";

interface MockSettings {
  locale: Locale | null;
}

const state: MockSettings = { locale: null };

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: <T,>(selector: (s: MockSettings) => T): T => selector(state),
}));

import { useFormattingLocale } from "@/lib/useLocale";

describe("useFormattingLocale (#705)", () => {
  it("returns undefined with no override — callers fall back to the runtime's default (OS) locale", () => {
    state.locale = null;
    const { result } = renderHook(() => useFormattingLocale());
    expect(result.current).toBeUndefined();
  });

  it("returns the BCP-47 tag for a Swedish override", () => {
    state.locale = "sv";
    const { result } = renderHook(() => useFormattingLocale());
    expect(result.current).toBe("sv-SE");
  });

  it("returns the BCP-47 tag for an English override", () => {
    state.locale = "en";
    const { result } = renderHook(() => useFormattingLocale());
    expect(result.current).toBe("en-US");
  });
});
