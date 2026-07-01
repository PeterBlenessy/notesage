# Automation-Builder UX — How the Best Apps Make "Trigger → Action" Intuitive

**Date:** 2026-06-30 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| Research | this doc | Complete |
| PRD | [automations](../prds/2026-06-28-automations.md) | In Progress (Phases 1–4A shipped) |
| Applies to | the "New / Edit automation" dialog (`AutomationForm.tsx`) | — |

How Zapier, IFTTT, Notion, Apple Shortcuts, and Slack Workflow Builder make creating an automation feel obvious — and the concrete changes that would make Notesage's dialog intuitive rather than merely tidy.

---

## Executive Summary

Every successful automation builder converges on the **same five moves**, and our current dialog does almost none of them. It's a *correct form*, not an *intuitive flow*.

1. **It reads as a sentence: "When ⟨trigger⟩, do ⟨steps⟩."** Zapier ("When this happens… Then do this"), IFTTT ("If This Then That"), Notion ("When / Do"), Slack ("trigger → steps"). The mental model is a sentence, and the UI vocabulary matches it. Our dialog says "Trigger" and "Steps" — accurate, but it doesn't *read* like what it does.

2. **You start from a recipe, not a blank canvas.** Zapier's #1 onboarding lever is its template gallery — "each template clearly outlines the trigger and action so you know exactly what it will do before you start." A blank form is the hardest possible starting point. We already have three perfect archetypes (Daily Digest, Inbox Triage, On-save Check) and surface *none* of them at creation time.

3. **Data flows via pickable "magic variable" pills — you never type `{{…}}`.** Apple Shortcuts shows each step's output as a blue pill you tap to insert; Zapier has "Insert Data"; Slack puts an "insert a variable" affordance under every text field. The user picks a *friendly name* ("Yesterday's summary"), and it drops in as a token. We expose raw `{{steps.summary.output}}` syntax and a picker that lists raw tokens — the single least-intuitive thing in the dialog.

4. **One decision at a time (progressive disclosure).** Pick the trigger *type*, then configure only that type. Pick a step *kind*, then its fields. Advanced settings stay hidden. We do this partway (Advanced is collapsed) but still show the trigger config inline as a field stack.

5. **Plain-English summaries + test-before-arm.** A configured trigger/step reads back as a sentence ("When a file is added to Inbox"); Zapier makes you "Test trigger" before turning on. We have "Save & run" (good), but no plain-English read-back.

**Recommendation:** rework the dialog around **(a) a recipe-first entry**, **(b) "When / Do this" sentence framing**, and **(c) magic-variable pills**. These three are the high-leverage, on-brand changes. The rest of the form (scope, guardrails, arming) stays as progressive-disclosure detail.

---

## What each app does

### Zapier — the canonical "When this happens… Then do this"
A Zap is a **trigger + one or more actions**, configured as a **vertical list of cards** you expand one at a time (search app → pick event → configure → **Test**). Its template gallery is the primary onboarding path: ready-made Zaps "come with both a trigger and an action to kickstart your automation," fully customizable after. Takeaway: **sentence framing + card-per-step + templates + test step.**

### IFTTT — radical simplicity
"**If This Then That**." Two blocks. Choose a service, choose a trigger, fill a couple of fields. The whole product *is* the sentence. Takeaway: **the simpler the framing, the more obvious the flow** — beginners never see a wall of fields.

### Notion automations — "When / Do" in a side panel
Under **When** you pick the event (Page added, Property edited); under **Do** you pick actions (edit property, create page, send notification, **define a variable**). Clean two-zone panel. Takeaway: **literally label the zones "When" and "Do."**

### Apple Shortcuts — Magic Variables (the gold standard for data-passing)
"Each action's output is available as a **Magic Variable** — simply select the output of any action to use it in a subsequent action." Variables render as **blue pill tokens** that carry the source action's icon; **tap to insert** inline, tap again to change which detail to use. Takeaway: **data passing must be pick-a-pill, never type-a-token.** This is the biggest gap in our dialog.

### Slack Workflow Builder — trigger → steps, variables under every field
Pick a trigger, then **add steps in sequence**; "the builder inserts Handlebars-like `{{variables}}` into any plain-text field," surfaced as an **"insert a variable" option below each text input**. Plain-language step config. Takeaway: **put the variable affordance *in* the field**, not in a separate concept the user has to learn.

---

## Comparison

| Pattern | Zapier | IFTTT | Notion | Shortcuts | Slack | **Notesage today** |
| --- | --- | --- | --- | --- | --- | --- |
| Reads as "When → Do" sentence | ✅ | ✅ | ✅ | ➖ (linear) | ✅ | ❌ ("Trigger"/"Steps") |
| Recipe/template starter | ✅ (core) | ✅ | ✅ | ✅ (gallery) | ✅ | ❌ (blank form) |
| Pickable variable pills | ✅ Insert Data | — | ✅ | ✅✅ Magic Var | ✅ | ❌ (raw `{{…}}`) |
| One decision at a time | ✅ | ✅ | ✅ | ✅ | ✅ | ◑ (partial) |
| Plain-English read-back | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Test before turning on | ✅ | ➖ | ➖ | ✅ (run) | ➖ | ◑ ("Save & run") |

---

## Recommendation — make Notesage's dialog intuitive

Three changes, in priority order. Each is independently shippable.

### 1. Recipe-first entry (highest impact, lowest effort)
"New automation" opens to a **small gallery of starter recipes**, not a blank form:

- 🌅 **Daily Digest** — *"Every morning, summarize yesterday's notes into a daily note."*
- 📥 **Inbox Triage** — *"When a file lands in Inbox, classify it and file it."*
- ✅ **On-save Check** — *"When I save a note, scan it for TODOs and missing tags."*
- ➕ **Start from scratch**

Each card shows its plain-English "When → Do" so the user knows what it builds. Picking one **pre-fills the entire form** (trigger + steps + sensible guardrails) and drops them into the editor to tweak. This is exactly Zapier's blank-canvas fix, and we already have the archetypes specified in the PRD.

### 2. "When / Do this" sentence framing
Rename the two core zones to the universal vocabulary and make them read back in plain English:

- **When** — the trigger, shown as a sentence (*"When a file is added to ~/Notesage/Inbox"*) with the controls beneath/inside.
- **Do this** — the numbered step pipeline (keep the current numbered cards).

Scope, guardrails, and arming become secondary/advanced detail (already collapsed).

### 3. Magic-variable pills (the data-passing fix)
Replace raw `{{steps.summary.output}}` authoring with Shortcuts-style pills:

- The variable picker lists **friendly names** ("Yesterday's summary", "The triggering file", "Today's date") grouped by source step/trigger.
- Inserting one drops a **visual pill** into the field (rendered token), not literal mustache text; serialization still writes `{{…}}` underneath (no format change).
- Put the **"+ insert"** affordance directly on each text field (Slack pattern), so the concept is discovered in place.

### Smaller wins
- **Auto-suggest the name** from the chosen recipe/trigger so "Name" is never a blank stare.
- **Plain-English read-back** of each collapsed step ("Append to `Daily/{{today}}.md`").

## Open questions
- **Pills depth:** full inline rendered-token editing (Shortcuts-grade, more work) vs. a friendly picker that inserts styled-but-plain tokens (80% of the value, far less work)? Recommend the latter first.
- **Template source:** hard-code the three archetypes in the dialog, or load them from bundled YAML recipe files (more extensible, a bit more plumbing)?
- **Entry surface:** a distinct first "pick a recipe" screen inside the dialog, vs. a recipe row at the top of the existing form?

## Sources
- [Zapier — Learn key concepts in Zaps](https://help.zapier.com/hc/en-us/articles/8496181725453-Learn-key-concepts-in-Zaps) · [Set up your Zap trigger](https://help.zapier.com/hc/en-us/articles/8496288188429-Set-up-your-Zap-trigger) · [Set up your Zap action](https://help.zapier.com/hc/en-us/articles/8496257774221-Set-up-your-Zap-action) · [Workflow Automation Templates](https://zapier.com/templates)
- [Notion — Database automations](https://www.notion.com/help/database-automations)
- [Apple — Use variables (Magic Variables) in Shortcuts](https://support.apple.com/guide/shortcuts/use-variables-apdd02c2780c/ios) · [Intro to variables](https://support.apple.com/guide/shortcuts/intro-to-variables-apdb5506f698/ios)
- [Slack — Workflow automation](https://slack.com/features/workflow-automation) · [Workflow steps](https://docs.slack.dev/workflows/workflow-steps/)
- [DelightChat automation-rules UI/UX case study](https://shrutichaturvedi98.medium.com/designing-automation-rules-in-delightchat-892a03b2e9e0) · [ActiveCampaign automation builder walkthrough](https://help.activecampaign.com/hc/en-us/articles/222921988-Walkthrough-How-to-use-ActiveCampaign-s-automation-builder)
