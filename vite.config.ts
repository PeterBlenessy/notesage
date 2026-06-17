import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync, cpSync, existsSync, mkdirSync } from "fs";

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

/**
 * Copy Excalidraw's Latin font families to a served, gitignored public path so
 * the editor loads them from the app origin (`font-src 'self'`) instead of the
 * `esm.sh` CDN, which the app CSP blocks. Excalidraw always also lists the CDN
 * URL as an extra `@font-face src`, so a missing local font is a harmless
 * no-op fallback — never a hard failure. Runs in both `vite dev` and the
 * `tauri build` Vite pass via the `buildStart` hook.
 */
function excalidrawLocalFonts(): Plugin {
  return {
    name: "excalidraw-local-fonts",
    buildStart() {
      const srcBase = path.resolve(__dirname, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
      const destBase = path.resolve(__dirname, "public/excalidraw-assets/fonts");
      if (!existsSync(srcBase)) return;
      mkdirSync(destBase, { recursive: true });
      for (const family of EXCALIDRAW_LATIN_FONTS) {
        const from = path.join(srcBase, family);
        if (existsSync(from)) cpSync(from, path.join(destBase, family), { recursive: true });
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
