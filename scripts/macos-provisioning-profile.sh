#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# macos-provisioning-profile.sh — regenerate the Mac app's Developer ID profile
#
# The Mac app embeds `Contents/embedded.provisionprofile` so macOS will honour
# its iCloud entitlements. Without it the app can SEE
# `~/Library/Mobile Documents/iCloud~com~notesage~app` and cannot read a byte —
# the container is TCC-protected and opened only to an app that can prove it
# owns it. The only alternative was asking every user for Full Disk Access.
#
# WHEN TO RUN THIS
#
#   The profile itself is long-lived — Developer ID profiles run about 18 years
#   — so this is not a routine chore. It has to be re-run when:
#
#     * the Developer ID Application CERTIFICATE is rotated (the profile names
#       the certificates it covers; a signature from one it does not name is
#       not honoured), or
#     * the App ID's capabilities change in the developer portal.
#
#   A stale profile does not fail loudly at build time. It fails at runtime,
#   for the user, as "cannot read the library" — which is why
#   `macos-release-embed.sh` verifies the profile grants what the signature
#   claims on every release.
#
# CREDENTIALS
#
#   The same App Store Connect key the iOS pipeline uses, discovered the same
#   way — never passed in, never asked for:
#     ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8   (key id = filename)
#     ~/.appstoreconnect/private_keys/issuer_id
# ==============================================================================

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO/src-tauri/macos/Notesage_macOS_DeveloperID.provisionprofile"
BUNDLE_ID="com.notesage.app"

KEY="$(ls "$HOME"/.appstoreconnect/private_keys/AuthKey_*.p8 2>/dev/null | head -1)"
[ -n "$KEY" ] || { echo "No App Store Connect key in ~/.appstoreconnect/private_keys/" >&2; exit 1; }
ISSUER_FILE="$HOME/.appstoreconnect/private_keys/issuer_id"
[ -f "$ISSUER_FILE" ] || { echo "No issuer id at $ISSUER_FILE" >&2; exit 1; }

KEY="$KEY" ISSUER="$(cat "$ISSUER_FILE")" OUT="$OUT" BUNDLE_ID="$BUNDLE_ID" python3 <<'PY'
import base64, json, os, re, subprocess, time, urllib.request, plistlib

key, issuer, out, bundle_id = (os.environ[k] for k in ("KEY", "ISSUER", "OUT", "BUNDLE_ID"))
kid = os.path.basename(key)[8:-3]

def b64u(d): return base64.urlsafe_b64encode(d).rstrip(b"=")
si = (b64u(json.dumps({"alg": "ES256", "kid": kid, "typ": "JWT"}).encode()) + b"." +
      b64u(json.dumps({"iss": issuer, "exp": int(time.time()) + 900,
                       "aud": "appstoreconnect-v1"}).encode()))
der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key],
                     input=si, capture_output=True, check=True).stdout

def der_to_raw(d):
    # JWS wants r||s, OpenSSL emits DER.
    i = 2 if d[1] < 0x80 else 3
    i += 1; rl = d[i]; i += 1; r = d[i:i + rl]; i += rl
    i += 1; sl = d[i]; i += 1; s = d[i:i + sl]
    return r.lstrip(b"\x00").rjust(32, b"\x00") + s.lstrip(b"\x00").rjust(32, b"\x00")

tok = (si + b"." + b64u(der_to_raw(der))).decode()

def call(path, method="GET", body=None):
    req = urllib.request.Request(
        "https://api.appstoreconnect.apple.com/v1/" + path,
        data=json.dumps(body).encode() if body else None, method=method,
        headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        r = urllib.request.urlopen(req)
        return r.status, (json.load(r) if r.status != 204 else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

st, ids = call("bundleIds?limit=200")
if st >= 400:
    raise SystemExit(f"could not list bundle ids: {json.dumps(ids)[:300]}")
app = next((d for d in ids["data"] if d["attributes"]["identifier"] == bundle_id), None)
if not app:
    raise SystemExit(f"no App ID {bundle_id} on this account")

st, certs = call("certificates?limit=200")
devid = [c for c in certs["data"]
         if c["attributes"]["certificateType"] == "DEVELOPER_ID_APPLICATION"]
if not devid:
    raise SystemExit("no Developer ID Application certificate on this account")
# Newest first, and ONE of them: the API returns a 500 when several are
# attached at once. The profile therefore covers the certificate the release
# signs with, which is the newest — rotate the cert, re-run this.
devid.sort(key=lambda c: c["attributes"]["expirationDate"], reverse=True)
cert = devid[0]

name = "Notesage macOS Developer ID"
# A profile of this name may already exist; Apple will not replace it, so the
# old one goes first. Deleting a profile invalidates nothing already shipped —
# the copy inside a released app keeps working.
st, existing = call("profiles?limit=200&fields[profiles]=name")
for p in existing.get("data", []):
    if p["attributes"]["name"] == name:
        call(f"profiles/{p['id']}", "DELETE")

st, res = call("profiles", "POST", {"data": {
    "type": "profiles",
    "attributes": {"name": name, "profileType": "MAC_APP_DIRECT"},
    "relationships": {
        "bundleId": {"data": {"id": app["id"], "type": "bundleIds"}},
        "certificates": {"data": [{"id": cert["id"], "type": "certificates"}]}}}})
if st >= 400:
    raise SystemExit(f"could not create the profile: {json.dumps(res)[:400]}")

content = base64.b64decode(res["data"]["attributes"]["profileContent"])
with open(out, "wb") as f:
    f.write(content)

pl = plistlib.loads(re.search(rb"<\?xml.*?</plist>", content, re.S).group(0))
ents = pl.get("Entitlements", {})
icloud = ents.get("com.apple.developer.icloud-container-identifiers")
print(f"wrote {out} ({len(content)} bytes)")
print(f"  certificate : {cert['attributes']['displayName']} "
      f"(expires {cert['attributes']['expirationDate'][:10]})")
print(f"  profile     : expires {str(pl.get('ExpirationDate'))[:10]}")
print(f"  iCloud      : {icloud}")
if not icloud:
    raise SystemExit("the profile granted no iCloud container — check the App ID's capabilities")
PY

echo
echo "Commit the regenerated profile; the release pipeline embeds it."
