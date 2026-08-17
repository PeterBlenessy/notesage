#!/usr/bin/env node
/**
 * Print the next TestFlight build number: App Store Connect's highest build
 * for this app, plus one.
 *
 *   node scripts/asc-next-build-number.mjs
 *
 * Reads `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` (the `.p8` contents)
 * and `ASC_BUNDLE_ID` from the environment.
 *
 * ---------------------------------------------------------------------------
 * Why ask Apple rather than count something locally
 * ---------------------------------------------------------------------------
 *
 * App Store Connect rejects an upload whose `CFBundleVersion` is not strictly
 * greater than the last one it accepted for that marketing version. Any
 * locally-derived number — a CI run counter, a commit count — only knows about
 * builds that went through the same path. Upload once by hand from a laptop
 * and the local counter is behind, silently, until the next CI run is
 * rejected. Asking the service that enforces the rule is the only answer that
 * cannot drift, which is why fastlane does the same thing.
 *
 * ---------------------------------------------------------------------------
 * The JWT
 * ---------------------------------------------------------------------------
 *
 * ES256, signed with the `.p8` EC key. The signature must be the raw r‖s pair
 * (IEEE P1363), NOT the DER-wrapped form OpenSSL emits by default — a DER
 * signature is well-formed and verifies nowhere, so Apple answers 401 with no
 * hint as to why. Node's `dsaEncoding: "ieee-p1363"` produces the right shape
 * directly, which is the reason this is a Node script rather than shell.
 */

import { createSign } from "node:crypto";

import { readFileSync } from "node:fs";

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER_ID = process.env.ASC_ISSUER_ID;
const PRIVATE_KEY = process.env.ASC_PRIVATE_KEY;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
/** The app's marketing version, which the build series is anchored to. */
const MARKETING_VERSION =
  process.env.ASC_MARKETING_VERSION ||
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

for (const [name, value] of Object.entries({
  ASC_KEY_ID: KEY_ID,
  ASC_ISSUER_ID: ISSUER_ID,
  ASC_PRIVATE_KEY: PRIVATE_KEY,
  ASC_BUNDLE_ID: BUNDLE_ID,
})) {
  if (!value) {
    console.error(`${name} is not set.`);
    process.exit(2);
  }
}

const b64url = (input) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  // 20 minutes; Apple refuses anything beyond 20 for team keys.
  const payload = b64url(
    JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 20 * 60, aud: "appstoreconnect-v1" }),
  );
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(
    { key: PRIVATE_KEY, dsaEncoding: "ieee-p1363" },
    "base64",
  );
  const sig = signature.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${header}.${payload}.${sig}`;
}

async function api(path) {
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) {
    throw new Error(`App Store Connect ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  return res.json();
}

const apps = await api(`apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
const appId = apps.data?.[0]?.id;
if (!appId) {
  throw new Error(`No app found for bundle id ${BUNDLE_ID}.`);
}

// `limit=200` because the sort is server-side; one page is plenty to find the
// maximum.
const builds = await api(`builds?filter[app]=${appId}&sort=-version&limit=200`);
const versions = builds.data.map((b) => String(b.attributes?.version ?? "")).filter(Boolean);

/**
 * Compare two build numbers the way Apple does: as dot-separated integers,
 * component by component, shorter padded with zeros.
 *
 * Build numbers here are not always plain integers. Tauri used to fold the
 * prerelease counter into a fourth component, so the history contains values
 * like `0.48.0.34`. An earlier version of this script ran `parseInt` over
 * those, which yields **0** — it reported "next = 1" against a real build of
 * 0.48.0.34 and looked entirely plausible doing it. That the answer happened
 * to be acceptable to Apple was luck, not correctness.
 */
function compare(a, b) {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Refuse anything that is not a dotted integer rather than coercing it to
// zero. A build number we cannot read is a reason to stop, not to guess: the
// cost of guessing low is a rejected upload after a full build.
const malformed = versions.filter((v) => !/^\d+(\.\d+)*$/.test(v));
if (malformed.length > 0) {
  throw new Error(
    `Build numbers that are not dotted integers: ${malformed.slice(0, 5).join(", ")}. ` +
      `Refusing to guess the next one.`,
  );
}

// Build numbers are anchored to the marketing version: `0.50.0.1`, `0.50.0.2`,
// and so on. Without the anchor they inherit whatever series came before — the
// history here runs to `0.48.0.34`, from the days when Tauri folded the alpha
// counter into a fourth component, and continuing it would have shipped 0.50.0
// builds labelled 0.48. Correct, since Apple only requires the number to grow,
// but unreadable in App Store Connect.
const marketing = MARKETING_VERSION.split("-")[0]; // 0.50.0-beta.1 → 0.50.0
const inSeries = versions.filter((v) => v === marketing || v.startsWith(`${marketing}.`));

if (inSeries.length === 0) {
  // First build of this marketing version. Check it actually clears the older
  // series rather than assuming: a lower marketing version than something
  // already uploaded would be rejected after a full build, and the reason
  // would not be obvious.
  const first = `${marketing}.1`;
  const highestOverall = versions.length
    ? versions.reduce((a, b) => (compare(a, b) >= 0 ? a : b))
    : null;
  if (highestOverall && compare(first, highestOverall) <= 0) {
    throw new Error(
      `${first} is not above the highest existing build (${highestOverall}). ` +
        `App Store Connect would reject it.`,
    );
  }
  console.log(first);
} else {
  const highest = inSeries.reduce((a, b) => (compare(a, b) >= 0 ? a : b));
  const parts = highest.split(".").map((n) => Number.parseInt(n, 10));
  parts[parts.length - 1] += 1;
  console.log(parts.join("."));
}
