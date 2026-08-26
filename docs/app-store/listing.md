# App Store listing copy

Only needed for the **store submission** — not for TestFlight. Drafted here so
it is reviewable; every field is editable in App Store Connect afterwards.

## Name and subtitle

| Field | Value | Limit |
| --- | --- | --- |
| Name | `Notesage` | 30 |
| Subtitle | `Your markdown notes, on iPhone` | 30 |

> **Check the name is free** in App Store Connect before anything else — it is
> claimed when the app record is created, and a taken name forces a rethink of
> the whole listing.

## Promotional text (170, changeable without a new build)

```
Read and write your Notesage notes on the go, and capture links, images and
documents straight from the share sheet into your Inbox.
```

## Description

```
Notesage is a markdown note-taking app for people who want their notes to
stay their own files.

This is the iPhone companion to Notesage for Mac. It opens the Notesage
folder you already have — in iCloud Drive, or on your device — and gives you
your notes wherever you are.

READ ANYTHING IN YOUR LIBRARY
• Markdown, rendered exactly as on the Mac — callouts, tables, code
• PDFs, images, and code files with syntax highlighting
• Mermaid diagrams
• Follows your system light and dark appearance

WRITE AND ORGANISE
• Create and edit notes; the title becomes the filename
• New folders, rename, delete
• Pin what matters — pins are shared with the Mac app
• List or gallery view, sorted and grouped how you like

CAPTURE FROM ANYWHERE
• Share a link from Safari and save it as a readable article, a link note,
  or the page itself
• Share images, videos and documents straight into your Inbox
• Video links are saved with their real title, author and thumbnail

YOUR FILES, YOUR FOLDER
• No account, no sign-up, no subscription
• No analytics, no tracking, no crash reporting
• Notesage reads and writes only inside the folder you choose
• Plain markdown files — readable by any editor, on any system, forever

Notesage for Mac is available separately.
```

> Trim before submitting if any claim outruns the shipped build — a listing
> that promises more than the binary does is a rejection, and a fair one.

## Keywords (100 chars, comma-separated, no spaces after commas)

```
notetaking,icloud,plain text,writing,editor,obsidian,capture,inbox
```

Do not repeat the app name or the subtitle words — Apple indexes those
already, so repeating them wastes the budget.

> `markdown` and `notes` were removed on 2026-08-26: both appear in the
> subtitle (*Your markdown notes, on iPhone*), so they were bought twice —
> against the rule stated directly above them. Caught by
> `src/lib/__tests__/app-store-listing.test.ts`, which is why that check
> exists rather than trusting the prose.
>
> **~34 characters of budget are now free** (66/100). Deliberately left unspent
> rather than padded: which terms are worth buying is a marketing judgement,
> not something to guess. Candidates worth considering — `zettelkasten`,
> `wiki`, `backlinks`, `research`, `pdf`, `offline`.

## Category

- **Primary:** Productivity
- **Secondary:** Utilities

## URLs

| Field | Value | Status |
| --- | --- | --- |
| Support URL | *(decide)* — `https://github.com/PeterBlenessy/notesage/issues` is acceptable and honest | **needs a decision** |
| Marketing URL | optional — omit unless there is a real page | — |
| Privacy Policy URL | wherever [`privacy-policy.md`](privacy-policy.md) ends up hosted | **needs hosting** |

## Copyright

`© 2026 ADDABLE AB`
