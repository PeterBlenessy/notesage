---
name: create-agent
description: Create or update agent instruction files that customize AI behavior for your project
user-invocable: true
---

# Create Agent Instructions

Help the user create or update an agent instruction file (`.notesage/agents.md`) that customizes how the AI behaves in their project.

## Workflow

1. **Ask what the agent should do.** Get a description of the desired AI behavior. Examples:
   - "Always write tests for new code"
   - "Use formal academic tone"
   - "Follow our team's code style guide"
   - "Focus on security when reviewing code"

2. **Determine scope.** Ask the user:
   - **Project** — saved to `.notesage/agents.md` (only this project)
   - **Global** — saved to `~/.notesage/agents.md` (all projects)

3. **Check if the file already exists.** If it does, ask:
   - **Append** — add the new instructions to the existing file
   - **Replace** — overwrite with new instructions

4. **Generate the instructions.** Write clear, actionable markdown. Consult `references/AGENT-PATTERNS.md` for common patterns.

5. **Run the scaffold script** to create or update the file:
   ```
   execute_skill_script("create-agent", "scripts/scaffold.sh", [scope, action])
   ```
   Where `scope` is "project" or "global" and `action` is "create" or "append".

6. **Write the content** to the file.

7. **Confirm.** Tell the user:
   - Where the file was saved
   - That the instructions will be injected into all AI conversations
   - That they can edit the file directly to refine behavior
