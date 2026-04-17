---
name: test-rust
description: Run Rust backend tests (cargo test in src-tauri)
user-invocable: true
---

# Rust Backend Tests

Runs all `#[test]` functions in the Tauri crate.

## Commands

```bash
cd src-tauri && cargo test                      # Full Rust test suite
cd src-tauri && cargo test -- --nocapture       # Verbose output
cd src-tauri && cargo test <test_name>          # Single test or module
```

## What's Covered

- Unit tests across `src-tauri/src/**/*.rs`
- Integration tests for Tauri commands
- Parser tests (GGUF headers, markdown-to-typst, frontmatter, ACP JSON-RPC, etc.)

## When Tests Fail

1. Rerun with `-- --nocapture` for full panic/print output
2. If Tauri command signatures changed: check `generate_handler![]` in `src-tauri/src/lib.rs`
3. If Cargo deps changed: `cd src-tauri && cargo clean && cargo build`
4. `unwrap`/`expect` panics often reveal logic bugs — investigate before replacing with `?`

## Related

- `/tauri-command` — command signature conventions
- `/audit-rust-backend` — mutex, panics, process management audit
- `/test` — umbrella
