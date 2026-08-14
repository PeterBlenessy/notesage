# TestFlight copy

## Internal testing (what you want first)

Up to 100 devices on your own team, **no Beta App Review**, available minutes
after the build finishes processing. Needs none of the copy below — add
yourself as an internal tester and install.

The "What to Test" note is optional even here, but it is what your future self
reads when a build is three weeks old and you cannot remember what changed.

## What to Test — first build

```
First TestFlight build of the Notesage iOS companion.

Please check:

• Granting the library folder — pick your Notesage folder in iCloud Drive
  (or any folder under On My iPhone) and confirm your notes appear.
• Reading — markdown, PDFs, images, code files, mermaid diagrams; both
  light and dark appearance.
• Writing — create a note, edit it, rename it; confirm the changes reach
  your Mac.
• Share sheet — share a link from Safari, an image from Photos, and a video
  link; each should land in Inbox with a sensible filename.
• Long press a note or folder for the preview menu; swipe a row left for
  Share and Delete.
• Anything that feels slow, jumps, or flashes on launch.

Known: EPUB, DOCX and PPTX show an "open on your Mac" placeholder in this
build.
```

## External testing (only if you add testers outside the team)

Requires **Beta App Review** — a lighter review than the store, but a real
one — plus these fields.

### Beta App Description

```
Notesage is a markdown note-taking app. This companion app reads and edits
the notes in your own Notesage folder — in iCloud Drive or on your device —
and captures links, images and documents from the iOS share sheet into an
Inbox folder for you to file later.

There is no account and no sign-up. On first launch the app asks you to
pick your Notesage folder; everything it can see is inside that folder.
```

### Feedback email

`peter.blenessy@addable.se` — or a dedicated address if you would rather keep
beta feedback separate.

### Beta App Review notes

```
No account is required. On first launch, tap "Select your Notesage folder"
and choose any folder — an empty folder is fine, and the app will show its
empty state. To see content, add any .md file to the chosen folder from the
Files app first.

The app reads and writes only inside the folder the user grants via the
system folder picker. It collects no data and contains no analytics or
crash reporting.
```

That last paragraph matters: a reviewer who grants an empty folder and sees an
empty list may otherwise report the app as non-functional.
