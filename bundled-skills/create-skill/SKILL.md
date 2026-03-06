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

6. **Generate the SKILL.md content.** Write the file with:
   - YAML frontmatter: `name`, `description`, optionally `user-invocable: true`
   - Markdown body with clear instructions for how the AI should use this skill
   - Reference the SKILL-SPEC.md if you need format guidance

7. **If scripts were requested**, generate starter script files in `scripts/`.

8. **Run the validation script** to verify the skill is well-formed:
   ```
   execute_skill_script("create-skill", "scripts/validate.sh", [skill_dir])
   ```

9. **Report the result.** Tell the user:
   - Where the skill was created
   - How to use it (mention it by name in chat, or type `/name` if user-invocable)
   - That they can edit the SKILL.md to refine behavior
