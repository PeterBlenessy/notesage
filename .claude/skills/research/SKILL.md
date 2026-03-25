---
name: research
description: Research a topic — technologies, patterns, competitors, or approaches — and produce a structured analysis
user-invocable: true
argument-hint: "<topic>"
---

# Research Topic

Investigate a topic and produce a structured research document in `docs/research/`.

## Process

1. **Read project context** to understand what already exists and how the topic relates:
   - `docs/architecture.md` — current tech stack, project structure
   - `docs/product-description.md` — current features, roadmap
   - `CLAUDE.md` — conventions and constraints
   - Existing research docs in `docs/research/` — avoid duplicating prior work

2. **Clarify scope** if the topic is broad. Use AskUserQuestion to confirm:
   - What specific questions need answering?
   - Is this evaluating alternatives, exploring feasibility, or surveying the landscape?
   - Any known constraints (e.g., must be MIT-licensed, must work offline, macOS-only)?

3. **Research the topic** using web search, documentation reading, and codebase exploration as needed:
   - Search for current options, libraries, crates, frameworks
   - Read official docs and changelogs for version accuracy
   - Look at GitHub stars, maintenance activity, last release date
   - Find real-world usage examples and benchmarks
   - Check compatibility with the existing stack (Tauri v2, Rust, React, TypeScript)

4. **Write the research document** following the structure below.

5. **Save to** `docs/research/<slug>.md` where slug is a lowercase-kebab-case topic name.

6. **Present a brief summary** to the user with the file path and key findings.

## Document Structure

```markdown
# <Topic Title>

**Date:** YYYY-MM-DD **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | — | Not yet planned |

<1-2 sentence context: why this topic matters for Notesage.>

---

## Executive Summary

<3-5 paragraphs with the key findings and recommendation. A reader who only reads this section should understand what was found, what the options are, and what the recommended path is.>

---

## <Numbered sections for each option, approach, or area investigated>

### <Option/approach name>

| Attribute | Details |
| --- | --- |
| **Key fact** | ... |
| ... | ... |

<Prose analysis: strengths, weaknesses, how it fits Notesage.>

---

## Comparison

<Table or matrix comparing the options across key dimensions relevant to the decision.>

| Criterion | Option A | Option B | Option C |
| --- | --- | --- | --- |
| ... | ... | ... | ... |

## Recommendation

<Clear recommendation with rationale. If phased, describe the phases.>

## Open Questions

<Bullet list of things that need further investigation or user input before proceeding.>
```

## Guidelines

- **Be specific**: Include version numbers, crate names, GitHub URLs, and concrete metrics where available
- **Be current**: Verify that libraries are actively maintained (check last release date, open issues)
- **Be honest about trade-offs**: Every option has downsides — document them
- **Consider the stack**: Notesage is Tauri v2 (Rust backend) + React + TypeScript. Prefer Rust crates over Node packages for backend work, and evaluate Tauri compatibility
- **Include code snippets** where they help illustrate integration complexity
- **Reference prior research**: If a related topic was already researched in `docs/research/`, link to it and build on it rather than repeating
- **Pipeline table**: Always include the pipeline table after the header. Set PRD status to "Not yet planned" unless the user indicates otherwise. If the research was triggered by an existing PRD, link to it.

ARGUMENTS: The topic to research. Can be a technology ("CRDT collaborative editing"), a pattern ("plugin architecture for desktop apps"), a competitive survey ("AI writing assistants 2026"), or a feasibility study ("can we do X").
