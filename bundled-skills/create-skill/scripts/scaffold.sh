#!/usr/bin/env bash
# scaffold.sh — Create a new skill directory structure
# Usage: scaffold.sh <skill-name> <target-directory>
#
# Example: scaffold.sh web-research /Users/me/.notesage/skills

set -euo pipefail

SKILL_NAME="${1:?Usage: scaffold.sh <skill-name> <target-directory>}"
TARGET_DIR="${2:?Usage: scaffold.sh <skill-name> <target-directory>}"

# Validate skill name
if ! echo "$SKILL_NAME" | grep -qE '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'; then
  echo "Error: Invalid skill name '$SKILL_NAME'." >&2
  echo "Name must be 1-64 chars, lowercase alphanumeric + hyphens, no consecutive/leading/trailing hyphens." >&2
  exit 1
fi

if echo "$SKILL_NAME" | grep -qE '\-\-'; then
  echo "Error: Skill name cannot contain consecutive hyphens." >&2
  exit 1
fi

SKILL_DIR="$TARGET_DIR/$SKILL_NAME"

if [ -d "$SKILL_DIR" ]; then
  echo "Error: Directory already exists: $SKILL_DIR" >&2
  exit 1
fi

# Create directory structure
mkdir -p "$SKILL_DIR/scripts"
mkdir -p "$SKILL_DIR/references"

# Create template SKILL.md
cat > "$SKILL_DIR/SKILL.md" << 'TEMPLATE'
---
name: SKILL_NAME_PLACEHOLDER
description: TODO — describe what this skill does
user-invocable: true
---

# SKILL_NAME_PLACEHOLDER

TODO — write instructions for how the AI should use this skill.
TEMPLATE

# Replace placeholder with actual name
sed -i '' "s/SKILL_NAME_PLACEHOLDER/$SKILL_NAME/g" "$SKILL_DIR/SKILL.md" 2>/dev/null || \
  sed -i "s/SKILL_NAME_PLACEHOLDER/$SKILL_NAME/g" "$SKILL_DIR/SKILL.md"

echo "Created skill directory: $SKILL_DIR"
echo "Files:"
echo "  $SKILL_DIR/SKILL.md"
echo "  $SKILL_DIR/scripts/"
echo "  $SKILL_DIR/references/"
