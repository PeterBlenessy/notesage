#!/usr/bin/env python3
"""Online smoke test for managed agent installation.

Every managed AI agent (Claude Code, Codex, Copilot CLI/LSP, Gemini) installs
via `npm install <package>` — see `do_npm_install` in
`src-tauri/src/commands/agent_manager.rs`. This script exercises that real
install against the live npm registry, decoupled from the Tauri app:

  1. Parse the (agent_id, package, bin_name) triples straight out of
     `npm_agent_config(...)` in the Rust source, so the smoke test can never
     drift from the actual registry.
  2. For each agent, run `npm install --prefix <tmpdir> <package>` and assert
     the executable lands at `<tmpdir>/node_modules/.bin/<bin_name>` — the same
     path `do_npm_install` symlinks into the bin dir.

This is intentionally NOT part of the blocking PR test suite: it hits the
network, depends on npm/registry availability, and asserts against whatever
version npm serves. Run it on demand (workflow_dispatch) or when provider code
changes, never as a merge gate.

Exit code 0 = all agents installed and exposed their expected binary.
Exit code 1 = at least one agent failed (missing package, wrong bin name, etc.).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
AGENT_MANAGER = REPO_ROOT / "src-tauri" / "src" / "commands" / "agent_manager.rs"

# Matches one NpmAgentConfig arm:
#   "claude-agent-acp" => Some(NpmAgentConfig {
#       package: "@agentclientprotocol/claude-agent-acp",
#       bin_name: "claude-agent-acp",
ARM_RE = re.compile(
    r'"(?P<agent_id>[^"]+)"\s*=>\s*Some\(NpmAgentConfig\s*\{\s*'
    r'package:\s*"(?P<package>[^"]+)"\s*,\s*'
    r'bin_name:\s*"(?P<bin_name>[^"]+)"',
    re.MULTILINE,
)


def parse_agents() -> list[dict[str, str]]:
    """Extract (agent_id, package, bin_name) triples from the Rust source."""
    if not AGENT_MANAGER.exists():
        sys.exit(f"error: {AGENT_MANAGER} not found")
    source = AGENT_MANAGER.read_text()
    agents = [m.groupdict() for m in ARM_RE.finditer(source)]
    if not agents:
        sys.exit(
            "error: parsed 0 npm agents from agent_manager.rs — the source "
            "structure may have changed; update ARM_RE in this script."
        )
    return agents


def install_one(agent: dict[str, str]) -> str | None:
    """Install one agent into a throwaway prefix. Returns an error string or None."""
    package = agent["package"]
    bin_name = agent["bin_name"]
    prefix = Path(tempfile.mkdtemp(prefix=f"notesage-smoke-{agent['agent_id']}-"))
    try:
        proc = subprocess.run(
            ["npm", "install", "--prefix", str(prefix), package],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if proc.returncode != 0:
            return f"npm install failed (exit {proc.returncode}): {proc.stderr.strip()[:500]}"

        bin_path = prefix / "node_modules" / ".bin" / bin_name
        if not bin_path.exists():
            available = []
            bin_dir = prefix / "node_modules" / ".bin"
            if bin_dir.is_dir():
                available = sorted(p.name for p in bin_dir.iterdir())
            return (
                f"expected executable '{bin_name}' not found at {bin_path}. "
                f"Available bins: {available}"
            )

        # Mirror do_npm_install's executable expectation.
        if os.name != "nt" and not os.access(bin_path, os.X_OK):
            return f"'{bin_name}' exists at {bin_path} but is not executable"

        return None
    except subprocess.TimeoutExpired:
        return "npm install timed out after 600s"
    finally:
        shutil.rmtree(prefix, ignore_errors=True)


def main() -> int:
    if shutil.which("npm") is None:
        sys.exit("error: npm not found on PATH")

    agents = parse_agents()
    print(f"Smoke-testing {len(agents)} managed agent(s) against the npm registry:\n")

    failures: list[str] = []
    for agent in agents:
        label = f"{agent['agent_id']} ({agent['package']})"
        print(f"→ installing {label} ...", flush=True)
        err = install_one(agent)
        if err is None:
            print(f"  ✓ {agent['bin_name']} resolved\n")
        else:
            print(f"  ✗ {err}\n")
            failures.append(f"{label}: {err}")

    print("─" * 60)
    if failures:
        print(f"FAILED — {len(failures)}/{len(agents)} agent(s) did not install cleanly:")
        for f in failures:
            print(f"  • {f}")
        return 1
    print(f"PASSED — all {len(agents)} agents installed and exposed their binary.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
