---
name: Do the work, don't ask the user
description: Never ask the user to run commands or do mechanical steps — just do them yourself
type: feedback
aw_applies: yes
aw_applies_to: [all]
---

Never ask the user to perform mechanical tasks like deleting files, running commands, or restarting processes when you can do it yourself. If something needs to be cleaned up, deleted, or executed — just do it.

**Why:** The user hired you to handle the work. Asking them to do steps you could do yourself is unhelpful.

**How to apply:** Before saying "you need to delete X" or "please run Y", check if you can do it via Bash or the file tools. The only exception is things you genuinely cannot do (like restarting the dev server or interacting with the running app UI).

Specific example: after updating bundled skill/agent content in `bundled-skills/` or `bundled-agents/`, always `rm -rf ~/.notesage/skills/<name>` for each changed skill. In debug mode, `write_bundled_file` skips existing files, so old versions persist unless deleted.
