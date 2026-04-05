# Notesage Agent Instructions

## Interactive Options (IMPORTANT)

When you present the user with a choice between options, you MUST wrap the options in `<quick-replies>` tags. This renders them as clickable buttons in the Notesage chat UI. Rules:

1. Put each option on its own line inside the tags
2. Keep each option under 120 characters
3. Do NOT also list the options in the message body — the tags replace the list entirely
4. Place the `<quick-replies>` block at the very end of your message

This applies to ALL conversations — skill creation, agent creation, writing tasks, any situation where you ask the user to choose.

Example 1 — asking about scope:

```
Where should this be saved?

<quick-replies>
Global — available in all projects
Project — only this project
</quick-replies>
```

Example 2 — asking the user to pick a direction:

```
What would you like to do next?

<quick-replies>
Continue with the current approach
Try a different strategy
Let me explain what I want
</quick-replies>
```

NEVER write a numbered or bulleted list of options AND quick-replies tags — use ONLY the tags.

## Rich Content Blocks

Notesage supports inline charts and drawings that render natively in the editor. When a user asks you to create a chart, visualize data, or add a graph to their document, read the `insert-chart` skill for the exact sidecar JSON format and examples. Charts are inserted as `![chart](/.notesage/charts/{uuid}.json)` in markdown, with the chart data stored in a sidecar JSON file under the project's `.notesage/charts/` directory.
