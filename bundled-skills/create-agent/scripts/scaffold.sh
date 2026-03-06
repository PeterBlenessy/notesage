#!/usr/bin/env bash
# scaffold.sh — Create or prepare an agent instruction file
# Usage: scaffold.sh <scope> <action> [project-dir]
#
# scope:  "project" or "global"
# action: "create" or "append"
# project-dir: required when scope is "project"

set -euo pipefail

SCOPE="${1:?Usage: scaffold.sh <scope> <action> [project-dir]}"
ACTION="${2:?Usage: scaffold.sh <scope> <action> [project-dir]}"

case "$SCOPE" in
  project)
    PROJECT_DIR="${3:?Project directory required for project scope}"
    TARGET_DIR="$PROJECT_DIR/.notesage"
    TARGET_FILE="$TARGET_DIR/agents.md"
    ;;
  global)
    TARGET_DIR="$HOME/.notesage"
    TARGET_FILE="$TARGET_DIR/agents.md"
    ;;
  *)
    echo "Error: scope must be 'project' or 'global', got '$SCOPE'" >&2
    exit 1
    ;;
esac

mkdir -p "$TARGET_DIR"

case "$ACTION" in
  create)
    if [ -f "$TARGET_FILE" ]; then
      echo "WARN: File already exists: $TARGET_FILE"
      echo "Use action 'append' to add to existing file."
      exit 1
    fi
    cat > "$TARGET_FILE" << 'TEMPLATE'
# Agent Instructions

<!-- Add your instructions below. These will be injected into all AI conversations. -->

TEMPLATE
    echo "Created: $TARGET_FILE"
    ;;
  append)
    if [ ! -f "$TARGET_FILE" ]; then
      # Create if missing
      touch "$TARGET_FILE"
    fi
    echo "" >> "$TARGET_FILE"
    echo "Ready to append to: $TARGET_FILE"
    ;;
  *)
    echo "Error: action must be 'create' or 'append', got '$ACTION'" >&2
    exit 1
    ;;
esac

echo "Path: $TARGET_FILE"
