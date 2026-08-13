# Privacy Policy — Notesage for iOS

> **Needs hosting.** App Store submission requires this at a public URL.
> GitHub Pages on this repo is the cheapest option. Update the date and the
> contact address before publishing, and keep this file as the source.

**Last updated:** 13 August 2026

## The short version

Notesage does not collect your data. There is no account, no analytics, no
crash reporting, and no server operated by us. Your notes stay in the folder
you choose, on your device and in your own iCloud.

## What Notesage stores, and where

Notesage reads and writes files **only inside the folder you explicitly
grant** it access to — typically your Notesage folder in iCloud Drive, or a
folder under On My iPhone. iOS enforces this: the app cannot see anything
outside that grant.

Kept on your device:

- The grant itself, as a security-scoped bookmark.
- Your recently-read list and your view, sort and grouping preferences.

Kept inside your own library folder, alongside your notes:

- Your notes, folders, and anything you capture with the share sheet.
- Your pinned items (`.notesage/pins.json`), so they match the desktop app.

None of this is transmitted to us. We have no way to read any of it.

## Network requests

Notesage connects to the internet only when you ask it to do something that
needs the network:

- **Saving a shared link.** Notesage fetches that page from its own website to
  build the note. For a video link, it calls the video provider's public
  oEmbed endpoint (for example YouTube's) to get the title, author, and
  thumbnail.
- **Showing images a note points to.** These load from wherever the note
  references them, as in any markdown reader.
- **iCloud.** Syncing between your own devices is handled by Apple, under
  Apple's privacy policy.

These requests go to the site in question, not to us. They carry no identifier
we assign and no information about you beyond what any web request contains.

## What Notesage does not do

- No accounts, sign-in, or profiles.
- No analytics or usage tracking.
- No crash reporting from the iOS app.
- No advertising, and no tracking across other apps or websites.
- No sale or sharing of personal information — there is none to sell.

## Children

Notesage is a note-taking tool with no social features, user-generated content
feeds, or communication between users. It collects nothing from anyone,
children included.

## Deleting your data

Your data is your files. Delete them as you would any files, in Notesage, in
the Files app, or on your Mac. Removing the app's access (Change library
folder) or deleting the app removes the grant and the local preferences;
your notes stay where they are, because they were always yours.

## Changes

If this policy changes, the updated version will be published at the same URL
with a new "last updated" date.

## Contact

ADDABLE AB — peter.blenessy@addable.se
