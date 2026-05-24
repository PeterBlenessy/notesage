---
name: Manage branches yourself, don't delegate
description: When the work belongs on a specific branch, the agent must check / switch / create the branch via git, not tell the user to do it
type: feedback
originSessionId: cb9d7fdd-6f0d-4b76-bfc0-a551c95a238b
aw_applies: yes
aw_applies_to: [aw-tdd]
---
The agent is the dev tool expert in this collaboration. Branch management is part of that role.

**Why:** The user (Peter) explicitly said "I am using you as a developer and dev tool expert, I want you to take care of stuff such as making sure that the app is on the correct branch, not just mention it to me to do it." Mentioning "switch the dev process to this branch first" pushes plumbing back onto the user that they hired the agent to handle.

**How to apply:**
- At the start of a task that targets a specific branch, run `git branch --show-current` and verify before assuming.
- If the wrong branch is checked out, switch via `git checkout <branch>` (or create with `-b` if it doesn't exist) without asking — branch hygiene is mechanical, not a judgment call.
- After branch changes, if `pnpm tauri dev` is running on the old branch and the new branch has Rust changes, advise the user that hot-reload may need a restart. But the *branch swap itself* is the agent's job.
- Never write "switch to branch X first" in a test plan or instructions — that's pushing manual work back to the user.
- Exception: don't run destructive operations (`git reset --hard`, `git checkout .`, force-push) without explicit approval — those are the always-confirm category.
