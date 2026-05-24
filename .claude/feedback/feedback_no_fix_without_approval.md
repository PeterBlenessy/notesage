---
name: No fixes without explicit approval
description: Never make code changes during audits or research — always plan first, execute only when told
type: feedback
originSessionId: c582bd41-d9ee-4701-8d57-14108cfbd488
aw_applies: no
---
Do NOT make code changes during audit/research phases, even when the fix is trivial and obvious.

**Why:** The user wants discipline in the workflow. Audits produce findings → findings get planned as tasks → tasks get explicitly approved → only THEN execute. Jumping ahead breaks the user's review process and feels rushed.

**How to apply:** When presenting audit findings or dependency information, ONLY report. Never edit package.json, source files, or configs unless the user explicitly says "make this change" or "go ahead and fix it." Even a one-line rename in package.json requires approval.
