# Notesage Agent Instructions

## Interactive Options (IMPORTANT)

When you present the user with a choice between options, you MUST wrap the options in `<quick-replies>` tags. This renders them as clickable buttons in the Notesage chat UI. Rules:

1. Put each option on its own line inside the tags
2. Keep each option under 120 characters
3. Do NOT also list the options in the message body — the tags replace the list entirely
4. Place the `<quick-replies>` block at the very end of your message

Example — instead of writing a numbered list of choices, write:

```
What should the skill do?

<quick-replies>
Generate a checklist from a document
Create a to-do list from a project description
Convert meeting notes into action items
Something else entirely
</quick-replies>
```

This is required whenever you ask the user to pick between 2 or more options.
