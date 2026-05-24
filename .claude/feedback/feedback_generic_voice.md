---
name: Write instructions and feedback rules in a generic, portable voice
description: Never name the operator, contributors, or individuals when writing rules, READMEs, skill prompts, or commit messages intended to live in the repo. The text must be copy-pasteable to another repo without rewording.
type: feedback
originSessionId: 074dd909-6197-4c37-88e9-ba032b9663c6
aw_applies: yes
aw_applies_to: [all]
---

# Write generically — the corpus must travel

**Rule:** When writing any text that lives in the repo (skill prompts, feedback rule bodies, READMEs, INDEX files, the AW pipeline docs, commit messages), do not name the operator, contributors, or individual people. Use neutral language so the text is copy-paste-portable to another repo without rewording.

**Why:** The whole point of `.claude/feedback/` + the AW skill corpus is that it should be reusable infrastructure. A skill prompt that says "when peter asks for X" is welded to one project; the same rule rewritten as "when the operator asks for X" works anywhere. The same applies to project/product names in infrastructure files — they fence the corpus to one repo. Project-specific *rule content* (a codebase convention that references the local stack) is fine, but state the dependency explicitly so the rule can be adapted, not assumed.

**How to apply:**
- Substitute "the operator", "the agent", "the reviewer", "the user" for individual names. Or rephrase to avoid the subject entirely ("when X is requested" instead of "when peter requests X").
- In infrastructure files (READMEs, generator scripts, skill loaders): zero individual names, zero project names. Reference paths via convention (`<project-slug>`, `the repo's history directory`), not via the current value.
- In rule bodies that genuinely reference a project-specific dependency (a UI library, a state-management convention, a CI pipeline), state the dependency explicitly: "Notesage uses Zustand with…" → reader of another repo immediately sees what they need to adapt.
- In commit messages: same constraint. "Phase 1 of #336" or "the macos-26 pin from #334" — issue numbers are project-specific but they're stable references, not personal ones. Avoid "peter asked for…" / "the user wanted…" framing.
- Anti-pattern: "When peter says X, do Y." Generic: "When the operator requests X, do Y."
- Anti-pattern (infrastructure): "peter's local memory at ~/.claude/projects/-Users-peter-Development-…/memory/". Generic: "the operator's local memory at `~/.claude/projects/<project-slug>/memory/`."

**Out of scope:** Project-state memory files (`project_*.md` in `~/.claude/.../memory/`) — those are intentionally local and never travel; they can be as project-specific as needed. This rule only applies to text intended for the repo.
