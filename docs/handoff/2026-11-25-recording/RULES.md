# Rules for every fix agent in this batch (read fully before starting)

You are fixing review findings and building new capabilities for the voice-recording feature (all described in `BRIEF.md` next to this file, which also holds the binding CONTRACT; the audit report mentioned below is background only) in **Notesage** (Tauri v2 desktop app: React/TypeScript frontend in `src/`, Rust backend in `src-tauri/`, Tiptap/ProseMirror editor, Zustand stores). You are in an isolated git worktree of the repo, based on the released `main`.

## Read first
- `CLAUDE.md` in the repo root: conventions (English only, functional React, no `any`, Tauri commands return `Result<T, String>`, the typecheck gate, how to read vitest's exit status, how to compile Rust headless).
- The audit report: `docs/audits/2026-11-22-full.md` (in the repo). Each finding is a `### HIGH|MEDIUM|LOW: <title>` heading with a `**File:**` line, a description and a `**Fix:**`. Your prompt names findings by section number and title; find and read each one before touching code.

## How to work
1. **Verify each finding by reading the code first.** They are a reviewer's claims, and line numbers may have shifted (several high-severity fixes landed after the audit; check `git log --oneline -15`). If a finding is wrong, already fixed, or no longer applies, change nothing for it and say why.
2. **You may decline a fix.** If it cannot be done safely here (needs a real Mac, needs a design decision, would be a large refactor, risks breaking a working path you cannot test), do not force it: skip it and explain. A skipped item with a clear reason is a good outcome; a risky guess is not.
3. **Every behavioural fix gets a regression test** that fails without the fix (vitest for TS, `#[test]`/`#[tokio::test]` for Rust). Pure styling/aria/doc changes do not need a new test, but must not break existing ones.
4. **Keep changes minimal and focused.** No drive-by refactors, no renames, no reformatting. Update any comment or doc line your change makes false.
5. **Stay in your lane.** Other agents are fixing other findings in parallel in other worktrees. Touch only the files your prompt gives you (plus their tests). Your prompt lists files you must NOT touch. Shared files with special rules:
   - `src/lib/i18n.ts`: only ADD keys (English and Swedish), next to related keys. Never reorder or edit existing ones.
   - `src/lib/tauri.ts` and `src/test/tauri-mock.ts`: only if your prompt says you own them.
   - `package.json`, `pnpm-lock.yaml`, `.github/**`, `docs/**`: only if your prompt says so.
6. User-facing strings go through `t(...)` from `src/lib/i18n.ts`. UI follows `docs/design-system.md` (shadcn/ui first; every Radix `<Tooltip>` needs a `<TooltipProvider>` ancestor).

## Setup and checks
- `pnpm install --frozen-lockfile`
- Frontend: run the targeted vitest files for what you touched plus the existing tests of every file you changed, and `pnpm typecheck`. Check **exit codes**; a vitest run that prints an `Errors` line has FAILED even if all tests pass. Do NOT run the full vitest suite, Playwright, or `pnpm test:perf` (the coordinator runs the full gates after merging).
- Rust (only if you change Rust): `src-tauri/scripts/generate-pkg-config-stubs.sh` once, then `cd src-tauri && PKG_CONFIG_PATH="$(pwd)/.pkg-config-stubs" cargo check` and the same with `cargo check --tests`. `cargo build` / `cargo test` cannot link here; CI runs `cargo test` on macOS. Do not change `Cargo.toml` / `Cargo.lock` unless your prompt says so. Keep Rust and npm halves of any Tauri plugin on matching versions (do not bump either).
- Scratch files: use ONLY your own directory, `/tmp/claude-0/-home-user-notesage/cd4314aa-c329-5ae6-b17f-f8993da7623e/scratchpad/rec/<your-agent-name>/` (create it). Another agent's scratch files were overwritten last time by sharing a directory.

## Committing
- Do NOT commit, stash, push, open PRs or issues, comment on GitHub, edit `CLAUDE.md` or settings, or create scheduled tasks. Leave your work as uncommitted changes in your worktree (new files included); the coordinator collects it as a patch and commits after the full gates.

## Report back (concise)
A table with one row per finding in your list: status (`fixed` / `partly fixed` / `skipped` / `not a bug`), files changed, how it is tested, and for anything not fully fixed, what remains and why. Then: worktree path, branch name, commit hashes, the final exit codes of `pnpm typecheck` (and `cargo check`, `cargo check --tests` if you touched Rust), and anything you could not verify here.

## Rules for this batch
- Your worktree is created from the repository's main branch. Run `git log --oneline -1` first: it must show the v0.64.0 merge (`45f0b1a` "fix(mcp): make MCP work end to end…") or a descendant. If it does not, stop and say so.
- Findings carry `file:line` references from reviewers; verify each by reading the code. If a finding is wrong or already fixed, change nothing for it and say why.
- Nothing can be run against audio hardware here, and `cargo test` cannot link. Separate pure logic (unit-tested, and where feasible actually RUN in a throwaway crate built from copies/symlinks of the real source files, as earlier agents did; report what ran) from thin `#[cfg(target_os = "macos")]` system code. The app must still compile and behave on non-macOS targets and on iOS (recording on iOS is a separate Swift plugin; `src-tauri/src/commands/transcription_stub.rs` is what iOS compiles: keep the command set in step with it so `generate_handler![]` builds on every target).
- Never lose audio: no change may make a recording more likely to be lost than today. When in doubt keep the raw file.
- A new crate may be added only where your prompt says so; if you add one, update `Cargo.lock` minimally (`cargo update -p <crate> --precise` is not needed for a new crate; just let `cargo check` resolve it), check its licence is compatible (MIT/Apache/BSD/MPL) and say so, and run `cargo deny`/`cargo audit` only if already installed.
- Report: per finding/capability: status, files, tests and which of them actually RAN, behaviour changes the user will notice, deviations from the CONTRACT, anything not done and why, and a precise list of checks that only a real Mac can perform for your part.
