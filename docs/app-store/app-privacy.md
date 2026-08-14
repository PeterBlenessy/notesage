# App Privacy questionnaire — answers

App Store Connect → App Privacy. Required for **every** submission, including
the first TestFlight build.

## The answer

> **Data Not Collected.**
>
> "We do not collect data from this app."

## Why that is true, and how to defend it

This is not a claim about intent — the iOS binary has no telemetry in it.
`docs/features/mobile.md` §"Telemetry-free by construction" records the
mechanism; the short version:

- The Sentry (crash) and Aptabase (usage) crates are gated **off** the iOS
  target in `Cargo.toml`, so no telemetry client is compiled into the app.
- The frontend telemetry module is unreachable from `MobileApp` — the mobile
  shell never imports it.
- Both facts are regression-locked by tests, so a future change that adds
  telemetry to iOS fails CI rather than silently invalidating this answer.

Everything the app touches stays on the device or in the user's own iCloud
folder:

| What | Where it goes |
| --- | --- |
| Notes, folders, everything read or written | The user's granted library folder (their iCloud Drive or On My iPhone) |
| The library grant itself | A security-scoped bookmark in the app's own App Group storage |
| Recently-read list, view/sort/group preferences | Local app storage |
| Pins | `.notesage/pins.json` inside the user's own library |

## Network activity — disclose accurately if asked

The app makes network requests, but none of them send user data to us, and we
operate no server:

- **Share-sheet capture** fetches the page the user chose to share, from that
  page's own site, to build the note. Nothing is sent anywhere else.
- **Video capture** calls the provider's public oEmbed endpoint
  (`youtube.com/oembed`, `vimeo.com/api/oembed.json`) with the URL the user
  shared, to get the title, author and poster.
- **Remote images** in a note load from wherever the note points, exactly as
  they would in any markdown viewer.
- **iCloud sync** is Apple's, between the user's own devices.

Requests carry no identifier of ours, and there is no analytics, attribution,
advertising, or tracking SDK in the app. **App Tracking Transparency does not
apply** — nothing is tracked across apps or websites.

## If Apple asks about the third-party SDK list

There is none on iOS. The dependency tree is compiled Rust and Swift the app
ships itself; no SDK phones home.
