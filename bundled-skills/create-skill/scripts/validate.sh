#!/usr/bin/env bash
# validate.sh — Validate a skill directory is well-formed
# Usage: validate.sh <skill-directory>
#
# Checks:
#   1. SKILL.md exists
#   2. Frontmatter has 'name' and 'description'
#   3. Name matches directory name
#   4. Name follows naming rules

set -euo pipefail

SKILL_DIR="${1:?Usage: validate.sh <skill-directory>}"
ERRORS=0

# Check SKILL.md exists
if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
  echo "FAIL: SKILL.md not found in $SKILL_DIR"
  exit 1
fi

SKILL_MD="$SKILL_DIR/SKILL.md"
DIR_NAME=$(basename "$SKILL_DIR")

# Extract frontmatter (between first two --- lines)
FRONTMATTER=$(sed -n '/^---$/,/^---$/p' "$SKILL_MD" | sed '1d;$d')

if [ -z "$FRONTMATTER" ]; then
  echo "FAIL: No YAML frontmatter found (must be between --- delimiters)"
  ERRORS=$((ERRORS + 1))
else
  # Check name field
  NAME=$(echo "$FRONTMATTER" | grep -E '^name:' | sed 's/^name:[[:space:]]*//' | tr -d '"' | tr -d "'")
  if [ -z "$NAME" ]; then
    echo "FAIL: Missing 'name' in frontmatter"
    ERRORS=$((ERRORS + 1))
  else
    # Validate naming rules
    if ! echo "$NAME" | grep -qE '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'; then
      echo "FAIL: Name '$NAME' does not follow naming rules (lowercase alphanumeric + hyphens, 1-64 chars)"
      ERRORS=$((ERRORS + 1))
    fi
    if echo "$NAME" | grep -qE '\-\-'; then
      echo "FAIL: Name '$NAME' contains consecutive hyphens"
      ERRORS=$((ERRORS + 1))
    fi
    # Check name matches directory
    if [ "$NAME" != "$DIR_NAME" ]; then
      echo "WARN: Skill name '$NAME' does not match directory name '$DIR_NAME'"
    fi
  fi

  # Check description field
  DESC=$(echo "$FRONTMATTER" | grep -E '^description:' | sed 's/^description:[[:space:]]*//')
  if [ -z "$DESC" ]; then
    echo "FAIL: Missing 'description' in frontmatter"
    ERRORS=$((ERRORS + 1))
  fi
fi

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "Validation failed with $ERRORS error(s)"
  exit 1
fi

echo "OK: Skill '$DIR_NAME' is valid"

# Show summary
echo "  Name: $NAME"
echo "  Description: $DESC"
[ -d "$SKILL_DIR/scripts" ] && SCRIPT_COUNT=$(find "$SKILL_DIR/scripts" -type f 2>/dev/null | wc -l | tr -d ' ') || SCRIPT_COUNT=0
[ -d "$SKILL_DIR/references" ] && REF_COUNT=$(find "$SKILL_DIR/references" -type f 2>/dev/null | wc -l | tr -d ' ') || REF_COUNT=0
echo "  Scripts: $SCRIPT_COUNT"
echo "  References: $REF_COUNT"
