# Rust integration tests (src-tauri/tests/)

This directory holds `cargo test`-discoverable integration tests that exercise
the library crate from the outside — the same way a downstream consumer would.
Unit tests live next to the code in `src/` (`#[cfg(test)] mod tests`).

## Sandbox isolation harness

`sandbox_isolation.rs` verifies that the macOS Seatbelt profile the app
generates for ACP agents actually blocks out-of-scope writes at the kernel
level. Every Track 1 leak in the [project-data-isolation
PRD](../../docs/prds/2026-04-18-project-data-isolation.md) gets at least one
test authored here before its fix lands — that's the red-team TDD loop the
tasks file describes.

### Why a dedicated harness

Frontend-level tests can only assert the *shape* of the calls we make into
Rust ("Rust received these writable paths"). They can't assert that the
kernel denies anything. Without an OS-level check, a regression in
`generate_seatbelt_profile` — a missing subpath rule, a broader
`(allow file-write*)` than intended, an accidentally kept
`(allow default)` — would pass every existing unit test and ship.

### Running

```bash
cd src-tauri
cargo test --test sandbox_isolation -- --ignored
```

* macOS only — the entire file is `#[cfg(target_os = "macos")]`. Linux / CI
  compile it to nothing.
* `#[ignore]` on every test — a plain `cargo test` doesn't run them. This is
  intentional: the harness shells out to `sandbox-exec` and `log show`, and
  the unified log sometimes lags the spawning process by a few hundred ms
  under load.
* Requires `/usr/bin/sandbox-exec` and `log` on PATH — both are macOS
  defaults.

### What the sentinel proves

`sentinel_seatbelt_denies_writes_outside_writable_paths` is a plumbing check:

1. Build a profile with `writable_paths = [project_a]`.
2. `echo inside > project_a/ok.txt` → must succeed.
3. `echo pwnd > project_b/evil.txt` → must be denied by Seatbelt and the
   file must not exist on disk.

If step 3 ever starts succeeding, the profile generator has regressed and
the app is shipping a sandbox that doesn't sandbox. The log-stream check is
best-effort (macOS sometimes delays the entry); the authoritative signals
are the EPERM exit and the absent file.

### Authoring new attack tests (red-team TDD)

Follow the same four-step loop the tasks file mandates:

1. **Red (attack).** Write a test with `writable_paths` set to the *current*
   (leaky) production scope — e.g. every workspace path. Assert that the
   out-of-scope write **succeeds** (`result.is_success()`, target exists).
   Run the test. It passes. You've just reproduced the leak at the kernel
   layer.
2. **Flip.** Change the assertions to require denial:
   `assert!(result.looks_sandbox_denied())` and `assert!(!target.exists())`.
   Run the test. It fails — because the profile you handed it still allows
   the write.
3. **Green (fix).** Narrow `writable_paths` in the test to match the fixed
   production scope (e.g. the selected project only). Run the test. It
   passes — because Seatbelt now has no rule allowing that write.
4. **Regression lock.** Leave the test in the suite. Any future change that
   widens the sandbox scope back to the leaky shape will trip it.

A skeleton:

```rust
#[test]
#[ignore = "requires macOS Seatbelt"]
fn leak_N_attack_description() {
    let scratch = ScratchRoot::new();
    let in_scope = scratch.subdir("selected-project");
    let out_of_scope = scratch.subdir("other-project");

    // Step 3 scope — narrow. During step 1 you'd instead pass both paths
    // (the leaky shape).
    let agent = spawn_test_acp_agent_with_sandbox(&[&in_scope.to_string_lossy()]);

    let target = out_of_scope.join("evidence.txt");
    let result = run_bash(&agent, &format!("echo x > '{}'", target.display()))
        .expect("bash should spawn");

    assert!(result.looks_sandbox_denied(), "stderr: {}", result.stderr);
    assert!(!target.exists());
}
```

### What to test here vs elsewhere

| Concern | Where it belongs |
|---|---|
| "The profile string contains this rule" | `sandbox.rs` unit tests |
| "Rust received these writable paths from the frontend" | Frontend Vitest |
| "Kernel denies writes outside configured scope" | **This harness** |
| "`isToolCallAllowed` rejects this input" | `path-filter.ts` Vitest |
| "Permission store persists the scoped approval" | `permission-store.ts` Vitest |

The harness is the only place that answers "does the OS actually refuse?"
and therefore the only place where `#[ignore]` on macOS is the right move.
