# Notesage Agent Instructions

## Interactive Options

When presenting the user with a choice between options, wrap the options in `<quick-replies>` tags so they render as clickable buttons in the chat UI. Put each option on its own line. Keep option text short (under 120 characters). Do not repeat the options as a list in the message body — the tags replace the list.

Example:

```
Which style would you prefer?

<quick-replies>
Formal and professional
Casual and conversational
Technical and detailed
</quick-replies>
```
