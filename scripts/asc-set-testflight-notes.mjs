#!/usr/bin/env node
/**
 * Set the "What to Test" notes on a TestFlight build.
 *
 *   node scripts/asc-set-testflight-notes.mjs 0.50.0.1 [notes-file]
 *
 * Reads `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` and `ASC_BUNDLE_ID`
 * from the environment; the notes default to
 * `docs/app-store/testflight-whats-new.md`.
 *
 * Apple calls this a `betaBuildLocalization` — one per locale per build. The
 * script creates it, or updates it if one already exists, so re-running is
 * safe and is how you fix a typo without a new upload.
 *
 * A build only becomes addressable once Apple has processed it, which takes a
 * few minutes after upload. Hence the wait loop: without it, this runs
 * immediately after the upload and finds nothing, which looks like a failure
 * and is only impatience.
 */

import { createSign } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY, ASC_BUNDLE_ID } = process.env;
const [, , BUILD_VERSION, NOTES_DIR = "docs/app-store"] = process.argv;

for (const [name, value] of Object.entries({ ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY, ASC_BUNDLE_ID })) {
  if (!value) {
    console.error(`${name} is not set.`);
    process.exit(2);
  }
}
if (!BUILD_VERSION) {
  console.error("usage: asc-set-testflight-notes.mjs <build-version> [notes-file]");
  process.exit(2);
}

/**
 * Collect one note per locale.
 *
 * `testflight-whats-new.md` is en-US; `testflight-whats-new.<locale>.md` is
 * that locale — `.sv.md`, `.de.md`, and so on. TestFlight shows the note
 * matching the device's language, which is why a Swedish phone showed English
 * until Swedish existed: there was only one localization on the build.
 *
 * Adding a language is adding a file. Nothing here needs changing.
 */
function collectNotes() {
  const SCREENFUL = 350; // a phone screen; Apple's own limit is 4000
  const found = [];
  for (const file of readdirSync(NOTES_DIR).sort()) {
    const m = /^testflight-whats-new(?:\.([a-zA-Z-]+))?\.md$/.exec(file);
    if (!m) continue;
    const locale = m[1] ?? "en-US";
    const text = readFileSync(join(NOTES_DIR, file), "utf8")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
    if (!text) {
      console.error(`${file} has no content once comments are stripped.`);
      process.exit(2);
    }
    if (text.length > 4000) {
      console.error(`${file} is ${text.length} characters; Apple's limit is 4000.`);
      process.exit(2);
    }
    // A tester reads this in a notification, standing up. Past the fold is not
    // read, so a long note is a skipped one rather than a thorough one. Warn
    // rather than refuse — the judgement is the author's, but it should be a
    // decision rather than an accident.
    if (text.length > SCREENFUL) {
      console.warn(
        `    ${locale}: ${text.length} characters — more than a phone screen (~${SCREENFUL}).`,
      );
    }
    found.push({ locale, text, file });
  }
  if (found.length === 0) {
    console.error(`No testflight-whats-new*.md in ${NOTES_DIR}.`);
    process.exit(2);
  }
  return found;
}

const localized = collectNotes();

const b64url = (i) =>
  Buffer.from(i).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 20 * 60, aud: "appstoreconnect-v1" }),
  );
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  // Raw r‖s, not the DER OpenSSL emits by default — a DER signature is
  // well-formed and verifies nowhere, and Apple answers 401 without saying why.
  const sig = signer
    .sign({ key: ASC_PRIVATE_KEY, dsaEncoding: "ieee-p1363" }, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.${sig}`;
}

async function api(path, options = {}) {
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`App Store Connect ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  return res.status === 204 ? null : res.json();
}

const apps = await api(`apps?filter[bundleId]=${encodeURIComponent(ASC_BUNDLE_ID)}&limit=1`);
const appId = apps.data?.[0]?.id;
if (!appId) throw new Error(`No app for bundle id ${ASC_BUNDLE_ID}.`);

/** Wait for Apple to finish processing; the build is not addressable before then. */
async function findBuild() {
  const deadline = Date.now() + 15 * 60 * 1000;
  let announced = false;
  for (;;) {
    const builds = await api(
      `builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(BUILD_VERSION)}&limit=1`,
    );
    const build = builds.data?.[0];
    if (build) return build;
    if (Date.now() > deadline) {
      throw new Error(`Build ${BUILD_VERSION} never appeared. Set the notes later by re-running this.`);
    }
    if (!announced) {
      console.log("    waiting for Apple to finish processing…");
      announced = true;
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

const build = await findBuild();

// One localization per locale. Update where one exists rather than failing,
// so re-running fixes a typo without needing another upload.
const existing = await api(`builds/${build.id}/betaBuildLocalizations?limit=50`);
let failed = 0;

for (const { locale, text, file } of localized) {
  const match = existing.data?.find((l) => l.attributes?.locale === locale);
  try {
    if (match) {
      await api(`betaBuildLocalizations/${match.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          data: { type: "betaBuildLocalizations", id: match.id, attributes: { whatsNew: text } },
        }),
      });
      console.log(`    ${locale}: updated`);
    } else {
      await api("betaBuildLocalizations", {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "betaBuildLocalizations",
            attributes: { locale, whatsNew: text },
            relationships: { build: { data: { type: "builds", id: build.id } } },
          },
        }),
      });
      console.log(`    ${locale}: added`);
    }
  } catch (e) {
    // One rejected locale must not cost the others. Apple refuses locales the
    // app does not declare, and that is worth reporting rather than aborting
    // a release over — the English note is already in place by then.
    console.warn(`    ${locale}: FAILED (${file}) — ${String(e.message).slice(0, 160)}`);
    failed += 1;
  }
}

// Exit non-zero if ANY locale failed, so the caller's recovery message fires.
// Warning and exiting 0 meant a systemic failure — a key without
// betaBuildLocalizations permission, an Apple outage, a wrong bundle scope —
// failed every locale and still took the success branch, printing "Released"
// while no notes existed. Reporting a failure as success is the one outcome
// worse than failing.
if (failed > 0) {
  console.error(`${failed} of ${localized.length} locale(s) failed. Notes are incomplete.`);
  process.exitCode = 1;
}
