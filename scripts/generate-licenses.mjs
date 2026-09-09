#!/usr/bin/env node
/**
 * Generate the third-party notice list both apps show.
 *
 * Notesage ships other people's code — npm packages in the frontend bundle,
 * Rust crates compiled into the binary, a vendored EPUB renderer, fonts, and
 * the llama-server sidecar. Most of those licences require the notice to
 * travel with the distributed copy, so this list is an obligation, not a
 * courtesy (#949).
 *
 * It is GENERATED, because a hand-maintained list is wrong by the second
 * release. Run it when dependencies change:
 *
 *     pnpm licenses:generate
 *
 * Sources, in order of trustworthiness:
 *   - `pnpm list --prod` for the npm closure that actually ships (dev
 *     dependencies do not reach a user's machine, so they are excluded),
 *     minus packages that are in the graph but not unpacked here — the
 *     per-platform binaries of a native package. Run this on the platform
 *     you ship for; on macOS it lists what a macOS build contains.
 *   - `cargo metadata --offline` for the Rust closure. Deliberately NOT
 *     filtered by target: over-including a Windows-only crate costs a line in
 *     a list, under-including one is a missing notice.
 *   - `EXTRAS` below for everything that is in the bundle without being in a
 *     manifest — the vendored renderer, the fonts, the sidecar binary.
 *
 * Licence TEXT is read off disk from each package's own LICENSE file, so the
 * notice we show is the one the author shipped rather than a template. Texts
 * are pooled by content hash: a thousand copies of MIT are one string here.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src/generated/third-party-licenses.json");

/** A licence file, by the names the ecosystem actually uses. */
const LICENCE_FILE = /^(LICENSE|LICENCE|COPYING|NOTICE|LICENSE-MIT|LICENSE-APACHE)([.-].*)?$/i;

/** Longest licence text found in a package directory, or null. Longest
 *  because a dual-licensed crate ships LICENSE-MIT and LICENSE-APACHE and the
 *  Apache one carries the terms that actually need reproducing. */
function licenceTextIn(dir) {
  if (!dir || !existsSync(dir)) return null;
  let best = null;
  for (const name of readdirSync(dir)) {
    if (!LICENCE_FILE.test(name)) continue;
    const path = join(dir, name);
    try {
      if (!statSync(path).isFile()) continue;
      const text = readFileSync(path, "utf8").trim();
      if (text && (!best || text.length > best.length)) best = text;
    } catch {
      // Unreadable is the same as absent for our purposes.
    }
  }
  return best;
}

function firstString(...candidates) {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object" && typeof c.url === "string" && c.url.trim()) return c.url.trim();
    if (c && typeof c === "object" && typeof c.name === "string" && c.name.trim()) return c.name.trim();
  }
  return null;
}

/** Every production npm package, deduplicated by name@version. */
function npmComponents() {
  const raw = execFileSync("pnpm", ["list", "--prod", "--depth", "Infinity", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const roots = JSON.parse(raw);
  const seen = new Map();
  const walk = (deps) => {
    for (const [name, dep] of Object.entries(deps ?? {})) {
      if (!dep?.version) continue;
      const key = `${name}@${dep.version}`;
      if (!seen.has(key)) {
        seen.set(key, { name, version: dep.version, path: dep.path ?? null });
        walk(dep.dependencies);
      }
    }
  };
  for (const root of roots) walk(root.dependencies);

  return [...seen.values()]
    // Not installed on this machine, so not in this build: the optional
    // per-platform binaries of a native package (`@napi-rs/canvas-win32-*`
    // and friends) are in the dependency graph on every OS and unpacked on
    // one. Listing a Windows binary's notice in a macOS app would be a claim
    // about something that is not in the bundle. The list is therefore
    // generated on the platform it ships for — see the header.
    .filter(({ path }) => path && existsSync(join(path, "package.json")))
    .map(({ name, version, path }) => {
    let manifest = {};
    {
      try {
        manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
      } catch {
        // A package we cannot parse still gets a row, without the extras.
      }
    }
    return {
      kind: "npm",
      name,
      version,
      license: firstString(manifest.license, manifest.licenses?.[0]?.type) ?? "UNKNOWN",
      publisher: firstString(manifest.author),
      url: firstString(manifest.homepage, manifest.repository),
      text: licenceTextIn(path),
    };
  });
}

/** Every Rust crate in the resolved graph, minus our own workspace members. */
function cargoComponents() {
  const raw = execFileSync("cargo", ["metadata", "--format-version", "1", "--offline"], {
    cwd: join(ROOT, "src-tauri"),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const meta = JSON.parse(raw);
  const ours = new Set(meta.workspace_members ?? []);
  return meta.packages
    .filter((p) => !ours.has(p.id))
    .map((p) => ({
      kind: "cargo",
      name: p.name,
      version: p.version,
      license: p.license ?? (p.license_file ? "see licence text" : "UNKNOWN"),
      publisher: Array.isArray(p.authors) && p.authors.length ? p.authors.join(", ") : null,
      url: firstString(p.repository, p.homepage),
      text: licenceTextIn(dirname(p.manifest_path)),
    }));
}

/**
 * Things we ship that no manifest knows about. Each reads its notice from the
 * copy in this repo, so a stale entry here fails loudly at generation rather
 * than quietly showing the wrong terms.
 */
const EXTRAS = [
  {
    kind: "bundled",
    name: "foliate-js",
    version: readFileSync(join(ROOT, "public/foliate-js/VERSION"), "utf8").match(/Commit: (\w{7})/)?.[1] ?? "vendored",
    license: "MIT",
    publisher: "John Factotum",
    url: "https://github.com/johnfactotum/foliate-js",
    textPath: "public/foliate-js/LICENSE",
  },
  {
    kind: "bundled",
    name: "zip.js",
    version: "vendored with foliate-js",
    license: "BSD-3-Clause",
    publisher: "Gildas Lormeau",
    url: "https://github.com/gildas-lormeau/zip.js",
    textPath: "public/foliate-js/vendor/LICENSE",
  },
  {
    kind: "bundled",
    name: "llama.cpp (llama-server)",
    version: readFileSync(join(ROOT, "src-tauri/binaries/LLAMA_CPP_VERSION"), "utf8").trim(),
    license: "MIT",
    publisher: "The ggml authors",
    url: "https://github.com/ggml-org/llama.cpp",
    textPath: "src-tauri/binaries/LICENSE",
  },
  {
    kind: "bundled",
    name: "Inter, Source Serif 4, JetBrains Mono",
    version: "bundled",
    license: "OFL-1.1",
    publisher: "The Inter, Source Serif and JetBrains Mono project authors",
    url: "https://openfontlicense.org",
    textPath: "src-tauri/fonts/LICENSE",
  },
];

function extraComponents() {
  return EXTRAS.map((e) => {
    const path = join(ROOT, e.textPath);
    if (!existsSync(path)) {
      throw new Error(
        `Missing notice for ${e.name}: ${e.textPath}. It ships with the app, so its licence has to ship too.`,
      );
    }
    const { textPath, ...rest } = e;
    return { ...rest, text: readFileSync(path, "utf8").trim() };
  });
}

function build() {
  const components = [...extraComponents(), ...npmComponents(), ...cargoComponents()];

  // Pool the texts: MIT appears a thousand times and differs only in a
  // copyright line, so hashing collapses the file from megabytes to a
  // fraction of that without losing a single distinct notice.
  const texts = {};
  const rows = components.map(({ text, ...rest }) => {
    let textId = null;
    if (text) {
      textId = createHash("sha256").update(text).digest("hex").slice(0, 12);
      texts[textId] = text;
    }
    return { ...rest, textId };
  });

  rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  return {
    // No timestamp on purpose: it would make every regeneration a diff even
    // when nothing about the dependencies changed.
    components: rows,
    texts,
  };
}

const data = build();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(data, null, 0)}\n`);

const missing = data.components.filter((c) => !c.textId).length;
console.log(
  `Wrote ${OUT}\n  ${data.components.length} components, ${Object.keys(data.texts).length} distinct notices, ` +
    `${missing} without a licence file on disk\n  ${(statSync(OUT).size / 1024).toFixed(0)} KB`,
);
