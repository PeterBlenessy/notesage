# System Font Enumeration Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-28 |
| **Status** | Complete |
| **PRD** | [editor-typography](../prds/2026-02-26-editor-typography.md) (Future section) |
| **Total** | 7 tasks: 2S, 3M, 2L |
| **Suggested order** | Backend (#1-#2) → Store (#3) → UI (#4-#5) → Persistence (#6) → Docs (#7) |

**Risks:**

- `font-kit` (or `font-enumeration`) Rust crate returns OS-internal font names (e.g., `".SF NS"`, `"SFProText-Regular"`) that don't match CSS `font-family` values — need to map PostScript/family names to CSS-compatible names
- WKWebView on macOS may not render all system fonts via CSS `font-family` — some fonts only work with their PostScript name, others only with family name. Need to test both and prefer whichever works.
- Large font lists (macOS ships \~300+ fonts) need filtering/search to be usable — the current 14-preset dropdown won't scale
- Adding `font-kit` to `Cargo.toml` increases compile time and binary size — verify the crate is lightweight enough

---

### #1 — Add `font-kit` dependency and `list_system_fonts` Tauri command ✅

**Description:** Add the `font-kit` crate to `src-tauri/Cargo.toml`. Create a `list_system_fonts` Tauri command in a new `src-tauri/src/commands/fonts.rs` module. Use `font_kit::source::SystemSource::all_families()` to enumerate installed font families. Return a `Vec<SystemFont>` where `SystemFont` has `{ family: String, category: String }`. Determine category by loading one font from the family and checking `font.properties().style` and whether it's monospace (check `font.glyph_for_char('m')` width vs `font.glyph_for_char('i')` width, or use the `is_monospace` property if available). Categories: `"sans"`, `"serif"`, `"mono"`, `"other"`. Filter out hidden fonts (names starting with `.` or `#`). Sort alphabetically. Register the command in `lib.rs`.

**Complexity:** L | **Category:** backend | **Dependencies:** None

**Files:** `src-tauri/Cargo.toml`, new: `src-tauri/src/commands/fonts.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

---

### #2 — Add Rust tests for font enumeration ✅

**Description:** Write `#[test]` tests in `fonts.rs` that verify: (a) `list_system_fonts` returns a non-empty list on macOS, (b) results contain known system fonts like "Helvetica", "Times New Roman", "Courier New", (c) hidden fonts (starting with `.`) are excluded, (d) each result has a non-empty family name and a valid category. These tests run in CI via `cargo test`.

**Complexity:** S | **Category:** backend | **Dependencies:** #1

**Files:** `src-tauri/src/commands/fonts.rs`

---

### #3 — Extend editor-styles-store with system fonts ✅

**Description:** Add `systemFonts: SystemFont[]` and `loadSystemFonts()` async action to `editor-styles-store.ts`. `loadSystemFonts()` calls the `list_system_fonts` Tauri command and caches the result. Called once on app startup (from `App.tsx` or `useAppLifecycle`). The `fontFamilyCSS()` function needs updating: if the font key is not in `FONT_CSS_MAP` (i.e., it's a system font), return the key directly as the CSS `font-family` value (system fonts use their family name as CSS value). Update the `EditorFontFamily` type — it remains `string` but document that it can now be either a preset key or a system font family name.

**Complexity:** M | **Category:** frontend | **Dependencies:** #1

**Files:** `src/stores/editor-styles-store.ts`, `src/App.tsx` or `src/hooks/useAppLifecycle.ts`

---

### #4 — Redesign font picker with search and system fonts ✅

**Description:** Redesign the font family selector in `TypographyPopover.tsx`. Replace the current `<Select>` dropdown (14 items) with a searchable combobox pattern. Layout: text input at top for filtering, then a scrollable list. Sections: "Presets" (existing 14 curated fonts, always shown first), then "System Fonts" (from store, grouped by category). Each font item rendered in its own typeface (existing pattern: `style={{ fontFamily: f.css }}`). For system fonts, use the family name directly as `font-family`. Keyboard navigation: arrow keys, Enter to select, Escape to close. Filter is case-insensitive substring match on font name. Use shadcn/ui `Command` (cmdk) component for the searchable list — matches design system mandate. Limit visible system fonts to prevent lag (virtualize or cap at 50 matches).

**Complexity:** L | **Category:** frontend | **Dependencies:** #3

**Files:** `src/components/editor/toolbar/TypographyPopover.tsx`

---

### #5 — Add font preview in picker ✅

**Description:** Each font item in the picker should show the font name rendered in that font, plus a small preview sentence ("The quick brown fox...") in muted text beneath it, also in that font. This helps users identify fonts they don't know by name. Keep the preview compact (text-xs, single line, truncated). For system fonts that fail to render in the WebView (fallback to default), show a subtle warning indicator. Test by setting `font-family` on a hidden element and comparing its computed width with a known default — if identical, the font likely didn't load.

**Complexity:** M | **Category:** frontend | **Dependencies:** #4

**Files:** `src/components/editor/toolbar/TypographyPopover.tsx`

---

### #6 — Handle persistence and migration for system fonts ✅

**Description:** When a user selects a system font, it's stored in `editor-styles.json` as the font family name string (e.g., `"Fira Sans"`). The `fontFamilyCSS()` function already handles this via the fallback path from #3. Verify that: (a) selecting a system font persists correctly, (b) restarting the app with a system font selected works (even before `loadSystemFonts()` completes — the CSS value is the family name, so it works immediately), (c) if the user opens the file on a device without that font, the editor falls back gracefully (CSS font stack behavior). No migration needed — existing preset keys continue to work unchanged.

**Complexity:** M | **Category:** frontend | **Dependencies:** #3, #4

**Files:** `src/stores/editor-styles-store.ts` (verification + edge case handling)

---

### #7 — Update documentation ✅

**Description:** Update `docs/prds/2026-02-26-editor-typography.md` Future section to mark system font enumeration as implemented. Update `docs/features/editor.md` to document the expanded font picker (searchable, system fonts). Update `docs/architecture.md` project structure if `fonts.rs` is a new module worth noting.

**Complexity:** S | **Category:** docs | **Dependencies:** #4

**Files:** `docs/prds/2026-02-26-editor-typography.md`, `docs/features/editor.md`