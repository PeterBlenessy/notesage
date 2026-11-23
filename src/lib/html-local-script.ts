/**
 * Resolve the `src` of a `<script src="./…">` tag in an HTML file being
 * previewed with "allow scripts" on, to the absolute path the viewer may
 * read and inline.
 *
 * The setting is described as "local scripts only", and the viewer inlines
 * the file's text into a framed page whose own JavaScript can read it and
 * send it anywhere. So the path must stay inside the HTML file's directory:
 * `./../../.ssh/id_rsa` matches the same `./` pattern and used to be read
 * (audit 2026-11-22 §6).
 *
 * Returns null for anything that is not a plain path below `dir`.
 *
 * This is a lexical check. A symlink inside the directory that points out of
 * it is still followed by `read_file`; closing that needs canonicalisation in
 * the backend.
 */
export function resolveLocalScriptPath(dir: string, src: string): string | null {
  if (!dir.startsWith("/")) return null;
  if (!src.startsWith("./")) return null;
  // A query or fragment is not part of a file name, and NUL never is.
  if (/[?#\0\\]/.test(src)) return null;

  const segments: string[] = [];
  for (const segment of src.split("/")) {
    if (segment === "" || segment === ".") continue;
    // No climbing at all — not even `./a/../b.js`, which stays inside
    // lexically but would escape through a symlinked `a`.
    if (segment === "..") return null;
    segments.push(segment);
  }
  if (segments.length === 0) return null;

  const base = dir.replace(/\/+$/, "");
  return `${base}/${segments.join("/")}`;
}
