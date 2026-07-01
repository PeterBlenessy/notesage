import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync, cpSync, existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from "fs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

// Excalidraw's small Latin / hand-drawn font families. The 12 MB Xiaolai CJK
// font is intentionally excluded — Notesage doesn't need CJK, and bundling it
// would dwarf the app. (See `EXCALIDRAW_ASSET_PATH` in src/main.tsx.)
const EXCALIDRAW_LATIN_FONTS = [
  "Excalifont", "Virgil", "Nunito", "ComicShanns",
  "Lilita", "Cascadia", "Liberation", "Assistant",
];

/** The smallest `.woff2` in the bundled Latin families — a tiny valid font used
 *  to stub the unwanted CJK font (see below). */
function smallestLatinWoff2(srcBase: string): Buffer | null {
  let best: { size: number; file: string } | null = null;
  for (const family of EXCALIDRAW_LATIN_FONTS) {
    const dir = path.join(srcBase, family);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".woff2")) continue;
      const size = statSync(path.join(dir, f)).size;
      if (!best || size < best.size) best = { size, file: path.join(dir, f) };
    }
  }
  return best ? readFileSync(best.file) : null;
}

/**
 * Make Excalidraw load all its fonts from the app origin (`font-src 'self'`)
 * instead of the `esm.sh` CDN, which the app CSP blocks. Runs in both `vite dev`
 * and the `tauri build` Vite pass via `buildStart`. Two parts:
 *
 *  1. Copy the small Latin / hand-drawn families verbatim, so they load locally.
 *  2. STUB the 12 MB Xiaolai CJK font. Excalidraw loads Xiaolai as a blind
 *     fallback for EVERY text element — even pure-ASCII drawings, with no
 *     content gate — so without this it fetches ~209 Xiaolai chunks from the
 *     CDN and floods the console with CSP-refused errors. Notesage never needs
 *     CJK, so we write a tiny VALID woff2 (the package's own smallest font) at
 *     each Xiaolai path: the browser loads it (200) and never falls through to
 *     the CDN. The stub has no CJK glyphs, but no CJK is ever rendered, so it's
 *     harmless. ~170 KB total instead of 12 MB.
 *
 * Excalidraw always lists the CDN URL as an extra `@font-face src`, so a missing
 * or wrong local path is a harmless no-op fallback — never a hard failure.
 */
function excalidrawLocalFonts(): Plugin {
  return {
    name: "excalidraw-local-fonts",
    buildStart() {
      const srcBase = path.resolve(__dirname, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
      const destBase = path.resolve(__dirname, "public/excalidraw-assets/fonts");
      if (!existsSync(srcBase)) return;
      mkdirSync(destBase, { recursive: true });

      // 1. Latin / hand-drawn families — copied verbatim.
      for (const family of EXCALIDRAW_LATIN_FONTS) {
        const from = path.join(srcBase, family);
        if (existsSync(from)) cpSync(from, path.join(destBase, family), { recursive: true });
      }

      // 2. Xiaolai (CJK) — stubbed with a tiny valid woff2 at each expected path.
      const xiaolaiSrc = path.join(srcBase, "Xiaolai");
      const stub = smallestLatinWoff2(srcBase);
      if (existsSync(xiaolaiSrc) && stub) {
        const xiaolaiDest = path.join(destBase, "Xiaolai");
        mkdirSync(xiaolaiDest, { recursive: true });
        for (const name of readdirSync(xiaolaiSrc)) {
          if (name.endsWith(".woff2")) writeFileSync(path.join(xiaolaiDest, name), stub);
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Excalidraw checks this at runtime
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  plugins: [react(), tailwindcss(), excalidrawLocalFonts()],

  build: {
    // Tauri's WebKit/WebView2 targets support native ES module preloading, so
    // Vite's modulepreload polyfill (injected as an INLINE <script>) is
    // unnecessary — dropping it lets the hardened CSP use a strict
    // `script-src 'self'` without an inline-script allowance. See
    // tauri.conf.json `app.security.csp` (security audit MEDIUM).
    modulePreload: { polyfill: false },
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Pre-bundle Excalidraw for dev server (large dep with many sub-chunks)
  optimizeDeps: {
    include: ["@excalidraw/excalidraw"],
    exclude: [],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore non-source files that trigger unnecessary reloads
      ignored: ["**/src-tauri/**", "**/docs/**", "**/.notesage/**", "**/.claude/**", "**/bundled-skills/**", "**/bundled-agents/**"],
    },
  },
}));
