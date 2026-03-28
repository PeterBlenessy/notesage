# Soft Contrast Slider Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-28 |
| **Status** | Complete |
| **PRD** | Enhancement to existing soft contrast (design-system.md) |
| **Total** | 5 tasks: 2S, 2M, 1L |
| **Suggested order** | Store (#1) → CSS (#2) → Theme provider (#3) → Settings UI (#4) → Docs (#5) |

**Risks:**

- CSS custom properties are set via static `.soft` / `.dark.soft` classes in `globals.css`. A slider needs **dynamic** values — either inline CSS variables on `<html>` via JS, or a set of discrete CSS classes (e.g., `.contrast-25`, `.contrast-50`, `.contrast-75`, `.contrast-100`). Inline CSS variables are more flexible; discrete classes are simpler but limit granularity.
- The oklch lightness values for ~20 CSS variables must interpolate smoothly between base and soft endpoints. Getting the interpolation wrong could produce unreadable text or invisible borders at intermediate values.
- The current binary `softMode: boolean` is persisted — migration needed to `contrastLevel: number` without breaking existing settings.

**Recommended approach:** Replace the `.soft` / `.dark.soft` CSS classes with inline CSS variables set on `<html>` from the `ThemeProvider`. Interpolate each color's oklch lightness between its base value and soft value using the slider percentage. This gives continuous control without dozens of CSS classes.

---

### #1 — Replace softMode boolean with contrastLevel number in settings-store ✅

**Description:** In `settings-store.ts`, replace `softMode: boolean` with `contrastLevel: number` (range 0–100, default 0). 0 = full contrast (current base), 100 = maximum softness (current `.soft` values). Add `setContrastLevel(level: number)`. Keep `setSoftMode` as a deprecated compat shim: `setSoftMode(true)` → `setContrastLevel(100)`, `setSoftMode(false)` → `setContrastLevel(0)`. Add migration in the persist config: if `softMode === true`, set `contrastLevel: 100`; if `false`, set `contrastLevel: 0`. Update existing tests.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/stores/settings-store.ts`, `src/stores/__tests__/settings-store.test.ts`

---

### #2 — Create contrast interpolation utility and CSS variable map ✅

**Description:** Create `src/lib/contrast.ts` with: (a) `LIGHT_BASE` and `LIGHT_SOFT` objects mapping CSS variable names to their oklch lightness values (extracted from `globals.css`). Same for `DARK_BASE` and `DARK_SOFT`. (b) `getContrastVariables(theme: 'light' | 'dark', level: number): Record<string, string>` — for each variable, interpolate the lightness between base (level=0) and soft (level=100) using linear interpolation. Returns a map of CSS variable names to `oklch(L% 0 0)` values. Only interpolate lightness-based variables (skip highlight colors, diff colors, and other chromatic values that don't change between base and soft). Keep the existing `.soft` / `.dark.soft` classes in `globals.css` as fallback documentation but they'll no longer be applied dynamically.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/lib/contrast.ts`, reference: `src/styles/globals.css`

---

### #3 — Update ThemeProvider to apply contrast variables ✅

**Description:** In `ThemeProvider.tsx`, replace the current `.soft` class toggle with inline CSS variable injection. Read `contrastLevel` from `settings-store`. When `contrastLevel > 0`, call `getContrastVariables(theme, contrastLevel)` and set each variable on `document.documentElement.style`. When `contrastLevel === 0`, remove the inline overrides (let base CSS apply). Remove the `.soft` class logic (`classList.add/remove`). Add cleanup in the effect to remove inline styles when the component unmounts or level returns to 0.

**Complexity:** M | **Category:** frontend | **Dependencies:** #1, #2

**Files:** `src/components/ThemeProvider.tsx`

---

### #4 — Replace soft contrast toggle with slider in Settings ✅

**Description:** In `SettingsDialog.tsx`, replace the "Soft contrast" `Switch` with a slider. Use the existing shadcn/ui `Slider` component (install if not present: `pnpm dlx shadcn@latest add slider`). Label: "Contrast". Slider range 0–100, step 1. Show the current value as a percentage label. At 0: "Full" label. At 100: "Soft" label. Apply changes immediately (live preview as the user drags). Follow the existing typography slider pattern from `TypographyPopover.tsx` for consistent styling.

**Complexity:** S | **Category:** frontend | **Dependencies:** #1, #3

**Files:** `src/components/settings/SettingsDialog.tsx`

---

### #5 — Update documentation ✅

**Description:** Update `docs/design-system.md` Soft Contrast section — document the slider replacing the toggle, the interpolation approach, and the 0–100 range. Update `docs/features/editor.md` if it mentions the soft contrast toggle.

**Complexity:** S | **Category:** docs | **Dependencies:** #4

**Files:** `docs/design-system.md`
