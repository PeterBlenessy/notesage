# llama-server sidecar — how it's sourced (dev vs prod)

NoteSage runs inference in llama.cpp's `llama-server`, bundled as a Tauri
sidecar (`bundle.externalBin: ["binaries/llama-server"]` in
`src-tauri/tauri.conf.json`). The binary is **git-ignored** — only
`src-tauri/binaries/LLAMA_CPP_VERSION` is committed — and it is produced **two
different ways** depending on whether you're developing or shipping. That split
is the thing to understand; getting it wrong wastes hours.

## If you remember one thing

**Dev downloads a pre-built binary; a release _builds it from source,
statically._** They are not interchangeable, and the reason is code signing.

## The split

| | Dev | Release / prod |
|---|---|---|
| script | `scripts/download-llama-server.sh` | the "Build llama-server from source (static)" step in `.github/workflows/release.yml` |
| source | pre-built GitHub release asset | `git clone` + `cmake` build of llama.cpp |
| linking | **dynamic** — ships a `lib/` of dylibs | **static** (`-DBUILD_SHARED_LIBS=OFF -DGGML_STATIC=ON`) |
| Metal | external `.metal` | **embedded** (`-DGGML_METAL_EMBED_LIBRARY=ON`) |
| result | binary + `src-tauri/binaries/lib/*.dylib` | one self-contained binary, no `lib/` |
| speed | seconds | a few minutes |

Both write to `src-tauri/binaries/llama-server-<triple>`; the release step
overwrites whatever dev left there.

## Why prod builds from source (the trap)

The pre-built release binary is **dynamically linked** — `otool -L` shows
`@rpath/libllama.…dylib` and friends. Those non-system dynamic dependencies
**break macOS code signing / notarization**, so a shipped `.app` cannot use it.
`release.yml` builds a **static** binary instead and explicitly fails if any
`@rpath` or `homebrew` dependency remains:

```sh
if otool -L …/llama-server-… | grep -qE "homebrew|@rpath"; then
  echo "::error::llama-server has non-system dynamic dependencies that will break code signing"
  exit 1
fi
```

A static binary is one signable file with **no `lib/` to stage** — which is why
`tauri.conf.json` has `externalBin` but **no `resources` entry for `lib/`**, and
why there is no post-bundle dylib-copy or re-sign step. If you ever see the dev
download's dylibs and think "prod needs to bundle these into the `.app`" — it
doesn't. Prod has no dylibs.

**Do not** try to make the dev-download binary work in a signed release, and
**do not** add `lib/` staging/resources for prod. The fix for "sidecar won't
load its libs in the packaged app" is *build static*, not *bundle the dylibs*.

## Binary resolution (dev vs prod)

`src-tauri/src/commands/model_providers/binary_resolution.rs`
(`resolve_llama_server_binary`) checks, in order:

1. **bundled sidecar** next to the app executable (`resolve_bundled_sidecar`) —
   the release path; a dev build under `target/` is only accepted if a `lib/`
   sits beside it.
2. **dev source** `src-tauri/binaries/llama-server-<triple>`
   (`resolve_dev_binary`) — so `tauri dev` finds the downloaded binary.
3. **`$PATH`** (`resolve_system_path`).

## Cheat sheet

```sh
# Dev: stage a pre-built binary once, then run.
scripts/download-llama-server.sh
pnpm tauri dev

# Release: the workflow builds static from source; to reproduce locally,
# mirror release.yml's cmake flags (BUILD_SHARED_LIBS=OFF, GGML_STATIC=ON,
# GGML_METAL_EMBED_LIBRARY=ON, LLAMA_CURL=OFF, …).
```

To bump the llama.cpp version, edit `src-tauri/binaries/LLAMA_CPP_VERSION`
(both scripts and the release workflow read it) and re-run the dev download /
release build.

---

*This doc was written from an outside project (TraceLoupe) that adopted this
same sidecar pattern and initially got it wrong — assuming the dev download was
also the prod mechanism and trying to bundle `lib/` for a signed build. The
split is correct; it just wasn't written down. Cross-check against `release.yml`
and `download-llama-server.sh` if either changes.*
