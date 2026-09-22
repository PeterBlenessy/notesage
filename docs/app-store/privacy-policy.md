# Privacy Policy — superseded by the published page

The policy now lives at **<https://notesage.io/privacy/>**, which is the URL
given to App Store Connect. It covers **both** apps — iPhone and Mac — because
they are built from one codebase and users read one policy, not two.

Its source is `privacy/index.html` in the
[notesage.io site repo](https://github.com/PeterBlenessy/notesage.github.io),
not this file. Editing this file changes nothing that anyone reads.

This file used to be the source, back when the policy was unhosted and
iOS-only. It is kept as a pointer rather than deleted so that the stale copy
cannot be found and edited by mistake — which is exactly what happened once,
when a review went to `content/pages/privacy.md` (a third, also-stale page)
instead of the live document.

**If the app's data handling changes, the published page is what must change**,
and the regression tests named in `docs/architecture.md` §"Telemetry — removed"
are deliberately written to fail first, so the decision surfaces in code review
before it reaches users.
