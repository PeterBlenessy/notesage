# Common Agent Instruction Patterns

## Code Style Agent

Enforce coding conventions across the project:

```markdown
## Code Style

- Use TypeScript strict mode. No `any` types.
- Prefer `const` over `let`. Never use `var`.
- Use named exports, not default exports.
- Keep functions under 30 lines. Extract helpers when needed.
- Write JSDoc comments for public APIs only.
```

## Research Agent

Guide AI behavior for research-focused projects:

```markdown
## Research Guidelines

- Always cite sources with URLs when making factual claims.
- Distinguish between established facts and emerging findings.
- When summarizing papers, include: authors, year, key findings, limitations.
- Use the project's citation format (APA 7th edition).
- Store research notes in the `research/` directory.
```

## Writing Assistant

Customize AI tone and style for writing projects:

```markdown
## Writing Style

- Match the existing voice: conversational but precise.
- Avoid jargon unless the audience expects it.
- Use active voice. Keep sentences under 25 words when possible.
- Suggest structural improvements, not just wording fixes.
- When editing, explain why each change improves the text.
```

## Security Reviewer

Focus AI on security concerns in code projects:

```markdown
## Security Focus

- Flag any user input that reaches a database query, shell command, or file path.
- Check for hardcoded secrets, API keys, and credentials.
- Verify authentication and authorization on all endpoints.
- Note missing input validation or sanitization.
- Suggest fixes, not just warnings.
```
