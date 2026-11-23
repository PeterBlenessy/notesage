/**
 * The npm half of the third-party notice: flatten `pnpm list --json` into the
 * set of `name@version` packages it describes.
 *
 * Its own module so the walk can be tested without running the generator
 * (importing `generate-licenses.mjs` writes the notice file).
 */

/**
 * Every package in a `pnpm list --prod --depth Infinity --json` result,
 * deduplicated by `name@version`.
 *
 * pnpm does not always print a package's subtree where the package first
 * appears. Depending on its version it can emit a stub for a repeated package
 * — the same `name@version` with no `dependencies` — and print the full
 * subtree at only one of the occurrences. A walk that marks a key as done the
 * first time it meets it, and never looks at that key again, therefore drops
 * the whole subtree whenever the stub happens to come first. That is how about
 * 185 shipped packages (the ProseMirror core, d3, katex, …) went missing from
 * a notice whose direct dependencies were all present.
 *
 * So a key is only finished once an occurrence WITH children has been walked;
 * until then every further occurrence is given the chance to supply them, and
 * a missing `path` is filled in the same way.
 *
 * @param {Array<{ dependencies?: Record<string, unknown> }>} roots
 * @returns {Array<{ name: string, version: string, path: string | null }>}
 */
export function collectNpmPackages(roots) {
  const seen = new Map();
  const expanded = new Set();
  const walk = (deps) => {
    for (const [name, dep] of Object.entries(deps ?? {})) {
      if (!dep?.version) continue;
      const key = `${name}@${dep.version}`;
      const known = seen.get(key);
      if (!known) {
        seen.set(key, { name, version: dep.version, path: dep.path ?? null });
      } else if (!known.path && dep.path) {
        known.path = dep.path;
      }
      const children = dep.dependencies;
      if (expanded.has(key) || !children || Object.keys(children).length === 0) continue;
      // Marked before descending, so a dependency cycle terminates.
      expanded.add(key);
      walk(children);
    }
  };
  for (const root of roots ?? []) walk(root?.dependencies);
  return [...seen.values()];
}
