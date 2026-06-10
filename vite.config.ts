import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

// https://vite.dev/config/
export default defineConfig(async () => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Excalidraw checks this at runtime
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  plugins: [react(), tailwindcss()],

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
