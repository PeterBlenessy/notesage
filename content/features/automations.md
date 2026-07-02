---
feature: automations
title: Automations
status: shipped
category: automate
summary: "Let Notesage run routine work for you — on a schedule, or when a file changes."
order: 10
---

## [web]

**Put the routine on autopilot.** Build an automation from simple steps — summarise a note, file it away, send a notification, or hand a task to an AI agent — and have it run on a schedule or whenever a file changes. The repetitive parts of your day quietly take care of themselves.

## [deep]

### What it does

An automation is a small, saved workflow: a trigger plus a short list of steps. When the trigger fires, Notesage runs the steps in order — no supervision needed. It's the difference between remembering to do the routine thing and having it already done.

### Triggers and steps

- **Triggers** — a time (a daily or weekly schedule), or a change (a file added or edited in a folder).
- **Steps** — three kinds: hand a task to an AI agent, create or append to a note, or send a notification. Steps pass results to each other through plain-English variables, so one step's output feeds the next — ask an agent step to summarise, and a later step files the result.

### Safe by default

Anything that writes to your files asks for a one-time approval before it can run, and re-asks if you change it. Guardrails cap how often an automation can fire, and unattended AI steps stay inside the project's scope — so an automation can help without surprising you.

### Example

A "Daily digest" automation runs each morning: it gathers the notes you edited yesterday, asks an AI agent to summarise them, writes the summary to a dated note, and sends you a notification that it's ready — before you've had coffee.

### When to use it

Any recurring chore built from steps you already do by hand: daily summaries, triaging an inbox folder, checking a document on save, or filing recordings.

### Tips

- Build them in **Settings → Automations** — pick a trigger, add steps, connect variables.
- Watch each run in the activity panel to see exactly what happened.
- Automations run while Notesage is open or in the menu bar; missed scheduled runs are offered to you on next launch, never fired silently.

## [in-app]

Open **Settings → Automations** to build one: pick a trigger (a time, or a file event), add steps from the menu, and connect them with plain-English variables. Automations that write files ask for a one-time approval before they run, and you can watch each run in the activity panel.

## [social]

Automations run the routine for you — summarise, file, notify, or hand off to an AI agent, on a schedule or when a file changes. Set it once, forget it.
