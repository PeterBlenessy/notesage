---
name: prd
description: Create a Product Requirements Document for a new feature
user-invocable: true
argument-hint: "<feature-name>"
---

# Create PRD

Write a Product Requirements Document for the given feature or initiative and save it to `docs/prds/`.

## Process

1. **Read project context** to understand what already exists:
   - `docs/architecture.md` — current tech stack, project structure, data flow
   - `docs/product-description.md` — current features, roadmap, and architectural considerations
   - `CLAUDE.md` — conventions, quality gates, anti-patterns

2. **Ask clarifying questions** if the feature scope is ambiguous. Use AskUserQuestion to confirm:
   - Target users and use cases
   - Must-have vs nice-to-have requirements
   - Any constraints or preferences

3. **Write the PRD** with these sections:

   ### Header table (immediately after the `# PRD: ...` title)

   ```markdown
   |  |  |
   | --- | --- |
   | **Date** | YYYY-MM-DD |
   | **Status** | Draft |
   | **Priority** | High / Medium / Low |
   | **Impact** | One-line summary of user impact |
   | **Phase** | Phase name if applicable, or omit row |
   ```

   ### Problem
   What user pain or gap does this feature address? Why now?

   ### Goals / Non-Goals
   - **Goals:** 3-5 measurable outcomes
   - **Non-Goals:** Explicitly out of scope items to prevent creep

   ### User Stories
   Key workflows in `As a <user>, I want <action>, so that <outcome>` format.

   ### Technical Approach
   Architecture decisions, new components/commands, state management, data flow. Reference existing patterns from `docs/architecture.md`.

   ### UI/UX
   Describe interactions, layout, states (loading, empty, error). Reference design system from `docs/design-system.md`. Include rough wireframe descriptions if helpful.

   ### Data Model
   New TypeScript interfaces, Zustand stores, Tauri command signatures, or Rust structs.

   ### Dependencies
   New libraries, APIs, or prerequisite work.

   ### Quality Gates
   Specific, testable criteria for "done". Include both functional and design requirements per project standards.

   ### Out of Scope
   Features or enhancements explicitly deferred to future work.

4. **Save the file** as `docs/prds/YYYY-MM-DD-<slug>.md` where:
   - Date is today's date
   - Slug is a lowercase-kebab-case summary (e.g., `git-integration`, `pdf-export`)

5. **Update the source research doc** if this PRD was informed by a research file in `docs/research/`:
   - Find the research file that motivated this PRD
   - Add or update the pipeline table in the research doc's header to include the new PRD link
   - Research docs use this standardized format after the title:

     ```markdown
     **Date:** YYYY-MM-DD **Status:** Research complete

     | Stage | Link | Status |
     | --- | --- | --- |
     | PRD | [slug](../prds/YYYY-MM-DD-slug.md) | Draft |
     | Tasks | — | Not planned |
     ```

   - Valid statuses: `Draft`, `In Progress`, `Complete`, `Abandoned`, `Not planned`
   - A research doc can have multiple PRD and Tasks rows
   - If no research doc exists for this PRD, skip this step

6. **Present a summary** to the user with the file path and key decisions made.

7. **Log observations** to `.claude/skill-feedback.md` if anything about PRD drafting fell short (audit/research inputs that didn't translate cleanly, missing sections, wrong level of detail, ambiguities the skill should have caught). Format per `/retrospect-skills`. Both user and agent contribute.

## Output Format

The PRD should be well-structured markdown, concise but thorough. Aim for completeness without padding — every section should add value.
