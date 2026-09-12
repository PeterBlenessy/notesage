---
name: verify-behaviour-not-metadata
description: "A chain of correct descriptions can describe something that does not work — the last gate must exercise the artefact"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-tdd, aw-review]
---

Verifying that something is DESCRIBED correctly is not verifying that it WORKS.

**Why:** a release shipped an application that would not open while every check
written for it passed — profile embedded, signature claiming the container,
profile granting it, signature valid, notarised, gatekeeper accepting. All of
it metadata. Nothing ever started the application, so nothing noticed the
kernel killing it at exec. The operator discovered it by installing.

**How to apply:** for anything shipped, make the final gate behavioural —
launch the binary, run the migration, open the screen, press the control. If a
check only reads a description of the artefact, it is not the gate. Say plainly
which checks are metadata and which exercised the thing.
