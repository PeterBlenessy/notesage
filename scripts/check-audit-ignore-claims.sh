#!/usr/bin/env bash
#
# Verify the "never compiled" claims in src-tauri/.cargo/audit.toml.
#
# Some advisories are ignored there because the vulnerable crate sits in
# Cargo.lock as an UNUSED optional feature and no line of its code is ever
# built. That justification is prose — nothing stops a future dependency bump
# from switching the feature on, at which point we would ship the vulnerable
# code while `cargo audit` stays silent because the advisory is ignored.
#
# This turns the prose into an enforced invariant: each crate below must be
# absent from the compiled dependency graph. If one appears, the ignore entry
# is no longer justified and CI fails so the risk gets re-assessed.
#
# Usage: scripts/check-audit-ignore-claims.sh
#
set -uo pipefail

cd "$(dirname "$0")/.."

# crate:advisory — crates whose audit.toml justification is "not compiled".
CLAIMS=(
  "rkyv:RUSTSEC-2026-0235"
)

failed=0

for claim in "${CLAIMS[@]}"; do
  crate="${claim%%:*}"
  advisory="${claim##*:}"

  # `--target all` so a crate that only builds on another platform still counts.
  out="$(cd src-tauri && cargo tree -i "$crate" --target all 2>&1)"
  rc=$?

  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "nothing to print"; then
    echo "OK   ${crate}: in Cargo.lock but not compiled — ${advisory} ignore holds."
    continue
  fi

  if [ "$rc" -eq 0 ]; then
    # cargo printed a real reverse-dependency tree: the crate is now built.
    echo "FAIL ${crate}: now IN the compiled dependency graph."
    echo "     The ${advisory} ignore in src-tauri/.cargo/audit.toml claims this"
    echo "     crate is never compiled. That is no longer true, so the advisory"
    echo "     is being suppressed for code we actually ship."
    echo "     Fix the dependency or remove the ignore — do not silence this."
    echo "     Pulled in by:"
    printf '%s\n' "$out" | head -20 | sed 's/^/       /'
    failed=1
    continue
  fi

  # Exit 101 = the package spec matched nothing, i.e. the crate left the
  # lockfile entirely. Not a failure — but the ignore entry is now dead.
  if printf '%s' "$out" | grep -q "did not match any packages"; then
    echo "NOTE ${crate}: no longer in Cargo.lock at all."
    echo "     The ${advisory} entry in src-tauri/.cargo/audit.toml is now stale"
    echo "     and can be deleted."
    continue
  fi

  # Anything else means cargo itself failed. Never treat that as a pass —
  # an empty result from a command that did not run looks exactly like
  # "crate absent", and that is how a guard silently stops guarding.
  echo "FAIL ${crate}: could not determine status (cargo tree exit ${rc})."
  printf '%s\n' "$out" | head -10 | sed 's/^/       /'
  failed=1
done

# ---------------------------------------------------------------------------
# "Never called" claims.
#
# The zip / zstd-safe advisories are ignored because the old `zip` copies
# under ppt-rs and docx-rs are only ever used to WRITE archives: nothing reads
# or extracts an untrusted archive through them. That is true only while our
# own code never reaches for those libraries' readers or for `extract`, so
# each pattern below must stay absent from src-tauri/src.
# ---------------------------------------------------------------------------
# pattern|what it would mean
NEVER_CALLED=(
  'read_docx[[:space:]]*\(|docx-rs reader (parses a .docx through zip 8.6.0)'
  'ppt_rs::opc|ppt-rs package reader (opens a .pptx through zip 0.6.6)'
  'Package::open[[:space:]]*\(|ppt-rs package reader (opens a .pptx through zip 0.6.6)'
  '\.extract[[:space:]]*\(|archive extraction (the zip advisories are about `extract`)'
  'ZipStreamReader|zip stream extraction'
)

for entry in "${NEVER_CALLED[@]}"; do
  pattern="${entry%%|*}"
  meaning="${entry##*|}"
  hits="$(grep -rnE --include='*.rs' "$pattern" src-tauri/src 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    echo "FAIL never-called claim broken: ${meaning}"
    echo "     src-tauri/.cargo/audit.toml ignores the zip / zstd-safe advisories"
    echo "     on the grounds that this is never called. Either use the patched"
    echo "     direct \`zip\` dependency for it, or remove those ignores."
    printf '%s\n' "$hits" | head -10 | sed 's/^/       /'
    failed=1
  else
    echo "OK   never called: ${meaning}"
  fi
done

exit "$failed"
