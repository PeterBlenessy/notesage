# App Store / TestFlight materials

Copy and answers for shipping the iOS app. Nothing here is submitted
automatically — these are the source texts to paste into App Store Connect,
kept in the repo so they are reviewable and versioned rather than typed fresh
into a web form.

The build-side work is separate: see [`../ios-testflight.md`](../ios-testflight.md).

## What is actually required, when

Apple asks for very different things at each stage. Do not front-load work
that only the store submission needs.

| | Internal TestFlight | External TestFlight | App Store |
| --- | --- | --- | --- |
| App record (name, bundle ID, SKU, primary language) | ✅ | ✅ | ✅ |
| Export compliance answer | ✅ *(baked in)* | ✅ | ✅ |
| App Privacy answers ("Data Not Collected") | ✅ | ✅ | ✅ |
| Beta App Review | — | ✅ | — |
| Beta description + feedback email | — | ✅ | — |
| "What to Test" notes | optional | ✅ | — |
| Screenshots | — | — | ✅ |
| Description / keywords / subtitle | — | — | ✅ |
| Support URL | — | — | ✅ |
| Privacy policy URL | — | ✅ *(if collecting data — we don't)* | ✅ |
| Age rating questionnaire | — | — | ✅ |
| Category | — | — | ✅ |

**For internal testing — up to 100 devices on your own team, which is what
you want first — there is no review and no marketing material at all.** You
need the app record, a build that passes processing, and testers. Everything
else in this folder is for later.

## Files

| File | For |
| --- | --- |
| [`app-privacy.md`](app-privacy.md) | The App Privacy questionnaire, answered, with the evidence for each answer |
| [`privacy-policy.md`](privacy-policy.md) | The policy itself — needs hosting at a public URL before store submission |
| [`testflight.md`](testflight.md) | Beta description, feedback email, "What to Test" |
| [`listing.md`](listing.md) | Name, subtitle, description, keywords, category, URLs |
| [`screenshots.md`](screenshots.md) | Required sizes and the shot list |
| [`age-rating.md`](age-rating.md) | Age-rating questionnaire answers, including the one genuine judgement call |

## Open decisions (Peter)

These need a human answer before the store submission — flagged in the
individual files too:

1. **Where the privacy policy is hosted.** GitHub Pages on this repo is the
   cheapest option; anything stable and public works.
2. **Support URL.** A GitHub Issues link is acceptable to Apple and is honest;
   a support page is nicer.
3. **App name in the store** — "Notesage" may or may not be free. Check in App
   Store Connect early; the name is claimed at app-record creation.
