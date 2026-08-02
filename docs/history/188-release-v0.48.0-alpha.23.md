# Release v0.48.0-alpha.23

**Date:** 2026-08-02
**Previous version:** 0.48.0-alpha.22
**Channel:** Alpha

Cut by hand while `WORKFLOW_PAT` is being renewed — `aw-alpha-cut` could not run. Same steps as the automated cut; the notes below are written rather than auto-classified.

## Changes

### Features

- **A second engine for the Local Agent: pi (beta).** "Add" in AI Providers now offers *Local agent using Goose* and *Local agent using pi*, so you can pick the engine when you create the connection. Goose remains the default and the more thoroughly tested of the two; pi is marked Beta. An engine you have already set up is shown as configured rather than offered again, and connections are labelled with their engine so two local agents are tellable apart.
- **Permission modes for the Local Agent.** The mode picker now works for local agents as it does for the other agents, with three levels: *Read Only* (reads and searches, refuses writes and commands), *Agent* (asks before writing files or running commands — the default), and *Full Access* (no prompts). Refusals in Read Only explain that the restriction applies to the whole session, so the agent proposes an alternative instead of retrying the same blocked action.

### Fixes

- **Updating an agent could leave it unable to start.** On Apple Silicon, updating an already-installed agent replaced the file in a way macOS treats as tampering, so the next launch was killed by the system with no error message. Affected every managed agent after an update; fresh installs were fine.

## Under the hood

- The ACP↔pi bridge moved to its own repository (`PeterBlenessy/notesage-acp-pi`) with an independent version line, and is installed from its releases at an exact pin (`0.1.1`) with checksum verification. The in-repo copy is gone; only the two pi extensions Notesage embeds at compile time remain, vendored, with the wire constants they share with the bridge pinned by tests on both sides.
- Session modes are enforced in the bridge rather than in the pi extension, so switching mode takes effect on the next tool call without respawning the agent. Forks inherit their parent's mode instead of widening to the default, and `session/load` re-advertises a session's own mode.
- Auto-approved and auto-blocked tool calls are now logged with the mode that decided them — previously a Full Access session left no record of what ran on the user's behalf.
- Agent binaries are installed by staging and renaming rather than overwriting in place; the regression test asserts the inode changed, since asserting file contents passes against the broken behaviour.
- First direct tests for the shipped permission gate, which runs inside pi and had never been exercised by the suite, and for `backfillAcpCapabilities`, which was mocked at every call site.
- Removed the CI jobs that published bridge binaries as Notesage release assets; nothing installs those now that the binary is resolved from the bridge's own repository.
