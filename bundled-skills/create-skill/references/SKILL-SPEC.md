# Agent Skills Specification (Summary)

## Directory Structure

```
skill-name/
  SKILL.md          # Required — skill definition
  scripts/          # Optional — executable scripts
  references/       # Optional — reference documents
  assets/           # Optional — images, data files
```

## SKILL.md Format

```markdown
---
name: skill-name
description: One-line description of what this skill does
user-invocable: true           # Optional — show in / command menu
disable-model-invocation: false # Optional — hide from AI auto-discovery
license: MIT                    # Optional
---

# Skill Name

Markdown body with instructions for the AI.
```

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Lowercase, 1-64 chars, alphanumeric + hyphens |
| `description` | Yes | One-line summary (~100 tokens max) |
| `user-invocable` | No | If true, appears in `/` command menu |
| `disable-model-invocation` | No | If true, AI won't auto-discover this skill |
| `license` | No | License identifier |
| `allowed-tools` | No | List of tools this skill may use |

## Naming Rules

- 1-64 characters
- Lowercase letters, digits, and hyphens only
- No consecutive hyphens (`--`)
- No leading or trailing hyphens
- Must match the directory name

## Body Guidelines

- Write clear, actionable instructions
- Tell the AI what to do, not how to think
- Reference scripts by relative path: `scripts/my-script.sh`
- Reference documents by relative path: `references/my-doc.md`
- Keep the body concise — it's loaded into AI context on demand

## Scripts

- Place in `scripts/` subdirectory
- Must have a shebang line (`#!/usr/bin/env bash`) or recognized extension
- Supported interpreters: bash, python3, node, npx tsx
- Scripts receive arguments as positional parameters
- stdout and stderr are captured and returned to the AI
- Scripts have a default 30-second timeout (max 300s)

## Hierarchy (Notesage)

Skills are discovered from multiple locations with priority:

1. **Project** (`.notesage/skills/`) — highest priority
2. **Global** (`~/.notesage/skills/`)
3. **Built-in** (`~/.notesage/bundled-skills/`)
4. **External** (`~/.claude/skills/`, `~/.codex/skills/`, etc.) — lowest priority

Same-name skills: higher priority overrides lower priority.
