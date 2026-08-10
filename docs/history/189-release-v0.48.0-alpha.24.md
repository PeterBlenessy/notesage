# Release v0.48.0-alpha.24

**Date:** 2026-08-10
**Previous version:** 0.48.0-alpha.23
**Channel:** Alpha

Auto-cut by `aw-alpha-cut`. Sections below are auto-classified from merged PRs; refine the prose before promoting to stable.

## Changes

### Fixes
- fix(html-viewer): render iframe paths from blob: URL so document styles survive the CSP (#447)

## Under the hood

Auto-generated from merged PRs + commits since `v0.48.0-alpha.23`. Alpha builds list commit-level detail for technical users.

- Bump rollup from 4.57.1 to 4.59.0 in the npm_and_yarn group across 1 directory (#1)
- Fix Copilot LSP sign-in: handle server→client signIn request for device code (#2)
- Refactor Copilot LSP sign-in flow to handle three-phase auth (#3)
- Add configurable debug logging and fix Copilot LSP issues (#4)
- Bump @mozilla/readability from 0.5.0 to 0.6.0 in /bundled-skills/download-webpage/scripts in the npm_and_yarn group across 1 directory (#5)
- Add hardcoded values audit research (#6)
- Bump quinn-proto from 0.11.13 to 0.11.14 in /src-tauri in the cargo group across 1 directory (#7)
- Add 6 PRDs for local AI agentic features and productivity enhancements (#8)
- Add PRD for always-on memory agent (ported from Google Cloud Platform) (#9)
- Add CLI/ACP vs Agent SDK analysis document (#10)
- Add App Store launch readiness research document (#11)
- Add sandbox-runtime comparison research with identified gaps (#12)
- iOS mobile app — on-device reader, island chrome, share capture (#521)
- fix(mobile): code-review round — load races, share lifecycle, injection safety
- feat(mobile): keyboard-aware islands, PDF island chrome, HTML search, share
- fix(editor): PDF text search was dead on WebKit — polyfill stream iteration
- fix(mobile): islands are chrome, not page — portal, fixed, zoom-proofed
- fix(mobile): keep chrome islands anchored when the keyboard appears
- feat(mobile): search islands + platform island metrics and glass
- feat(mobile): corner button islands — Apple Notes / Files chrome (#581 round 2)
- docs(mobile): mark bottom-navigation task done
- perf(mobile): raw IPC bytes for binary reads — big-PDF spinner freeze, part 2
- feat(mobile): iOS-style floating bottom navigation (#581)
- docs(mobile): add bottom-navigation adoption (issue #581) to the MVP tasks
- test(mobile): lock the review findings
- chore(mobile): drop dead surface and fix doc drift
- fix: iOS registers only the mobile reader's command surface
- fix: give pdf.js a blob: worker — custom-scheme URLs can't spawn workers
- fix(mobile): HIG touch targets, spinning refresh, JS hidden filter
- fix(mobile): link handling, theme-flip re-reads, mermaid doc leak
- fix(mobile): friendly picker cancel, hidden entries excluded, stale headers
- docs(mobile): PRD + tasks for the App Store launch MVP
- docs(mobile): mark the remaining v1 tasks done in the ledger
- docs(mobile): bring the feature description up to shipped reality
- ci: make the tauri-webdriver install idempotent
- chore(deps): bump pdfjs-dist and nanoid past new high-severity advisories
- fix(test): stop the tree-install test from racing the suite via $HOME
- fix(mobile): re-render markdown when the theme flips
- fix(mobile): mermaid via sandboxed iframe — WebKit refuses foreignObject in SVG images
- fix(mobile): serve mermaid SVGs from the htmlpreview scheme — data: images break on device
- fix(mobile): survive the embedded build's CSP — htmlpreview scheme, img-based mermaid, themed code blocks
- fix: follow the OS appearance while the app is running
- feat(mobile): render mermaid diagrams in the reader
- test(mobile): follow the HTML iframe to the data: URL contract
- fix(mobile): render HTML reports from a data: URL — blob: is blank on device
- fix(mobile): real app icon on iOS — edge-bled full-bleed set from the master
- chore(mobile): sync extension version keys with the app; doc the plugin/script layout
- feat(mobile): wire the Share Extension with a script, not Xcode clicks
- fix(mobile): key the PDF byte-cache cleanup on the path, not state identity
- perf(mobile): base64 binary reads — 10 MB PDF from ~10 s frozen to ~0.5 s
- build(ios): set the ADDABLE AB development team for device signing
- build: force cargo to re-embed the frontend, drop the inert ios build overlay
- fix: install the rustls CryptoProvider before anything builds a reqwest client
- fix(mobile): stop comrak's pretty-printed newlines rendering as line breaks
- fix(mobile): single typography system, and stop shipping stale frontends
- fix(mobile): reader was using desktop-sized margins on a phone
- fix(mobile): drop 100vh from the shell root
- fix(mobile): name the action after what it does, and stop silent cancels
- ci(mobile): stop grep -q from SIGPIPE-ing the symbol check
- feat(mobile): port library access onto the plugin crate — the bridge is live
- feat(mobile): iOS native bridge as a plugin crate — the Swift now links
- ci(mobile): tolerate nm's exit code when verifying the capture C ABI
- build(mobile): integrate the iOS native sources into the Xcode project
- fix(mobile): drop whisper.cpp from the iOS build — the app now launches
- fix(mobile): make the Rust crate actually compile for iOS
- ci(mobile): type-check the iOS Swift and build the capture staticlib
- feat(mobile): render HTML reports, share the desktop renderer, one capture format
- docs(mobile): note the missing iOS CI build path as a follow-up
- feat(mobile): stage more iOS native layer (plugin bridge, entitlements, plists)
- docs(mobile): update PRD + tasks status (in-app PDF, per-task ledger)
- feat(mobile): render PDFs in-app via the desktop PdfViewer
- feat(mobile): scaffold iOS reader + share-capture app
- docs: add task breakdown for iOS mobile app PRD
- docs: clarify iOS iCloud access rationale in mobile PRD
- docs: add PRD for Notesage iOS mobile app (reader + share capture)
