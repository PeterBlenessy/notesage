/**
 * Render markdown text to an HTML body fragment via the Rust (comrak) pipeline
 * — the same one the desktop instant-preview uses.
 *
 * Sibling of `renderMarkdownPreview` in `tauri.ts`, which takes a file *path*.
 * This takes the content, for callers that already hold the text and cannot
 * hand over a path the main process can open — notably iOS, where reads are
 * resolved through a security-scoped bookmark in the native layer.
 *
 * Why go through Rust rather than render markdown in JS: it is the renderer the
 * rest of the app already uses, so a note looks the same everywhere (callouts,
 * task lists, tables, syntax highlighting) and there is one implementation to
 * keep correct. It also keeps the mobile bundle free of a second markdown
 * stack.
 *
 * The result is safe to inject as HTML: comrak runs without `unsafe_`, so raw
 * HTML in the source — including `<script>` and event-handler attributes — is
 * stripped rather than passed through. Pinned by tests in
 * `src-tauri/src/commands/preview.rs`.
 */
import { invoke } from "@tauri-apps/api/core";

export function renderMarkdownFragment(
  markdown: string,
  theme: "light" | "dark" = "light",
): Promise<string> {
  return invoke<string>("render_markdown_fragment", { markdown, theme });
}
