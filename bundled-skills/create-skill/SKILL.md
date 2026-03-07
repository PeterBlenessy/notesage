---
name: create-skill
description: Create a new Agent Skill — scaffolds the directory structure, SKILL.md, and optional scripts
user-invocable: true
---

# Create Skill

Help the user create a new Agent Skill by gathering requirements and scaffolding the skill directory.

## Workflow

1. **Ask what the skill should do.** Get a plain-language description from the user. Ask clarifying questions if the description is vague.

2. **Determine the skill name.** Suggest a name based on the description:
   - Lowercase, 1-64 characters
   - Only alphanumeric characters and hyphens
   - No consecutive hyphens, no leading/trailing hyphens
   - Examples: `web-research`, `code-review`, `daily-summary`

3. **Determine scope.** Ask the user:
   - **Project** — saved to `.notesage/skills/<name>/` (only available in this project)
   - **Global** — saved to `~/.notesage/skills/<name>/` (available in all projects)

4. **Ask about scripts.** Does the skill need executable scripts?
   - If yes, ask which interpreter (bash, python, node)
   - Scripts go in `<skill-dir>/scripts/`

5. **Run the scaffold script** to create the directory structure:
   ```
   execute_skill_script("create-skill", "scripts/scaffold.sh", [name, target_dir])
   ```

6. **Ask about advanced options** (optional — skip if the user wants defaults):
   - **Allowed tools**: Should this skill restrict which tools/skills the AI can use? If yes, list them (e.g., `Read`, `Grep`, `Bash`). Leave empty for no restrictions.
   - **Disable model invocation**: Should the AI be prevented from auto-discovering this skill? Default: no.

7. **Generate the SKILL.md content.** Write the file with:
   - YAML frontmatter: `name`, `description`
   - Optionally `user-invocable: true` if the skill should appear in the `/` command menu
   - Optionally `disable-model-invocation: true` if it should be hidden from auto-discovery
   - Optionally `allowed-tools:` as a YAML list if tool restrictions were requested
   - Markdown body with clear instructions for how the AI should use this skill
   - Reference the SKILL-SPEC.md if you need format guidance

8. **If scripts were requested**, generate starter script files in `scripts/`.

9. **Run the validation script** to verify the skill is well-formed:
   ```
   execute_skill_script("create-skill", "scripts/validate.sh", [skill_dir])
   ```

10. **Report the result.** Tell the user:
   - Where the skill was created
   - How to use it (mention it by name in chat, or type `/name` if user-invocable)
   - That they can edit the SKILL.md to refine behavior
