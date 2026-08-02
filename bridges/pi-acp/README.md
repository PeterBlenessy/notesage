# `bridges/pi-acp/extensions` — vendored pi extensions

These two TypeScript files are **vendored copies** from
[`PeterBlenessy/notesage-acp-pi`](https://github.com/PeterBlenessy/notesage-acp-pi),
which is where the `notesage-acp-pi` bridge lives and is developed. That
repository is upstream; do not fix bugs here.

Only the extensions remain in this repo, because Rust embeds them at compile
time — `src-tauri/src/commands/local_agent.rs` does:

```rust
include_str!("../../../bridges/pi-acp/extensions/permission-gate.ts")
include_str!("../../../bridges/pi-acp/extensions/mcp-tools.ts")
```

`local_agent_write_config` writes them into `~/.notesage/agents/pi/extensions/`
on every config generation, so extension updates ride app updates and a user's
own pi installation is never touched.

## Why the bridge source is no longer here

The bridge started in-tree and was extracted to its own repository once it
earned an independent version line — which is what makes the exact version pin
in `agent_manager.rs` possible at all. Keeping a full second copy of `src/`,
`test/` and `types/` here bought nothing: the copy was not built by Notesage,
its tests were excluded from the root vitest run, and it silently drifted from
upstream the first time the bridge changed.

The binary is installed from the upstream repository's releases, checksum-
verified, at the version pinned in `agent_manager.rs`.

## Keeping these in sync

The extensions and the bridge are two halves of one wire protocol that live in
different repositories, so nothing can diff them at build time:

- The bridge sends `__NOTESAGE_PERMISSION__` + a JSON envelope as a UI-request
  title; the gate parses it.
- The bridge settles an answer with `__NOTESAGE_BLOCK__` + text; the gate
  strips the prefix and uses the text as the block reason.
- The bridge settles an approval with the literal `Allow`; the gate compares
  against it.

Drift is silent and severe — change the permission marker and the bridge stops
recognising the gate's request, so every tool call blocks with no prompt ever
reaching the user. `local_agent.rs`'s tests pin these literals on this side;
`test/protocol-constants.test.ts` upstream pins them on the other.

**When updating these files:** change them upstream first, release a bridge
version, copy the files here, and move the pin in `agent_manager.rs` in the
same commit.
