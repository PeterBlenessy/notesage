The shipped pi extensions no longer type-check against the latest published
`@earendil-works/pi-coding-agent` types.

| | |
| --- | --- |
| pinned pi | `__PINNED__` |
| latest pi | `__LATEST__` |

**Why this matters.** `bridges/pi-acp/extensions/permission-gate.ts` is loaded
by pi at runtime and type-checked against nothing. If it stops registering, pi
runs non-read-only tools **with no permission prompt** — the agent keeps
working, it just stops asking. That failure is silent and reads as health, so
this check is the only thing watching for it.

**What this does and does not tell you.** It covers the extension *signature*
surface — hook names and handler signatures. Mutation-tested when written: a
renamed hook is caught; a typo in a handler's return shape is not. It says
nothing about pi's JSONL RPC method names, its config format, or its CLI flags,
all of which the bridge also depends on. Treat it as "the shape we compile
against moved", not "the upgrade is unsafe in exactly this way".

**Do not bump the pin because this is open.** The pin exists precisely for this.
Moving pi forward means cutting a `notesage-acp-pi` release verified against the
newer pi, then moving both pins together — they track one pre-1.0 surface and
have to move as a pair.

Reproduce locally:

```
node scripts/check-pi-compat.mjs
```

The type errors from this run are in the workflow logs.

---

Filed automatically by `.github/workflows/pi-compat-watch.yml`. Notify-only — it
changes no code, touches no pin, and opens no PR.
