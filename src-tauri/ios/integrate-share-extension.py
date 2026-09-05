#!/usr/bin/env python3
"""Wire the Share Extension into the generated iOS Xcode project.

`tauri ios init` cannot create extension targets, and clicking one together in
the Xcode GUI is unrepeatable — the generated project (`src-tauri/gen/apple/`)
is gitignored, so any hand-made target dies with the checkout. This script is
the durable version of the README's "Still manual" section: run it after
`tauri ios init` (idempotent — safe to re-run any time) and the next build
produces the app with the Share Extension embedded.

What it does:
  1. Adds a `NotesageShare` app-extension target to `gen/apple/project.yml`
     (sources from `src-tauri/ios/` + the plugin package's LibraryAccess.swift,
     bridging header to the Rust capture staticlib, a cargo build phase for
     the right target triple, App Group entitlements, activation rule for
     web URLs + text).
  2. Adds the App Group entitlement to the MAIN app's entitlements — the app
     writes the library mode (and, for a chosen folder, the security-scoped
     bookmark) into the shared `group.com.notesage.app` UserDefaults suite,
     which is what the extension resolves to write captures.
  3. Adds the iCloud Documents entitlements for container
     `iCloud.com.notesage.app` to BOTH targets, and the `NSUbiquitousContainers`
     declaration to the app's Info.plist — the library IS that container's
     `Documents/` folder (PRD 2026-09-05-icloud-container-library), and
     `url(forUbiquityContainerIdentifier:)` returns nil in any process that is
     not entitled for it, extension included.
  4. Registers the extension as a dependency of the app target (xcodegen
     embeds app-extension dependencies into PlugIns/ automatically).
  5. Re-runs `xcodegen generate`.

Usage:  python3 src-tauri/ios/integrate-share-extension.py
"""

import json
import plistlib
import subprocess
import shutil
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent.parent
GEN = REPO / "src-tauri" / "gen" / "apple"
PROJECT_YML = GEN / "project.yml"
# Mirrors `BackgroundRefresh.identifier` in the plugin's Swift.
BG_REFRESH_IDENTIFIER = "com.notesage.app.inbox-refresh"
SHARE_INFO_PLIST = GEN / "NotesageShare/Info.plist"
APP_ENTITLEMENTS = GEN / "notesage_iOS" / "notesage_iOS.entitlements"
SHARE_ENTITLEMENTS = GEN / "NotesageShare" / "NotesageShare.entitlements"

APP_GROUP = "group.com.notesage.app"
# The app's own iCloud container. Its `Documents/` folder is the Notesage
# library (PRD 2026-09-05-icloud-container-library, Decision 1). Mirrors
# `LibraryAccess.CONTAINER_ID` in the plugin's Swift.
ICLOUD_CONTAINER = "iCloud.com.notesage.app"
TEAM_ID = "M39TDQ2D7L"

# The three iCloud Documents entitlement keys, identical on both targets.
# The extension needs them too: App Group alone does not make
# `url(forUbiquityContainerIdentifier:)` return anything in its process, and
# a share before the app has ever launched must still find `Inbox/`.
ICLOUD_ENTITLEMENTS = {
    "com.apple.developer.icloud-container-identifiers": [ICLOUD_CONTAINER],
    "com.apple.developer.icloud-services": ["CloudDocuments"],
    "com.apple.developer.ubiquity-container-identifiers": [ICLOUD_CONTAINER],
}

# What makes the container appear as "Notesage" under iCloud Drive in the
# Files app and in Finder. Apple latches these keys at the container's first
# use and only re-reads them with a HIGHER CFBundleVersion (PRD Decision 11)
# — `ios-testflight.sh` stamps a fresh build number every run, which covers
# it, but a local build that changes them needs its own bump.
UBIQUITOUS_CONTAINERS = {
    ICLOUD_CONTAINER: {
        "NSUbiquitousContainerIsDocumentScopePublic": True,
        "NSUbiquitousContainerName": "Notesage",
        "NSUbiquitousContainerSupportedFolderLevels": "Any",
    }
}

# Builds libnotesage_capture.a for the SDK being built. PLATFORM_NAME is
# iphoneos on device, iphonesimulator on sim; Notesage only ships arm64.
CARGO_SCRIPT = """\
set -e
case "$PLATFORM_NAME" in
  iphoneos) TRIPLE=aarch64-apple-ios ;;
  *) TRIPLE=aarch64-apple-ios-sim ;;
esac
export PATH="$HOME/.cargo/bin:$PATH"
cargo build --release --target "$TRIPLE" \
  --manifest-path "$SRCROOT/../../crates/notesage-capture/Cargo.toml"
"""

SHARE_TARGET = {
    "type": "app-extension",
    "platform": "iOS",
    "deploymentTarget": "16.0",
    "sources": [
        # Paths are relative to gen/apple (SRCROOT).
        {"path": "../../ios/ShareViewController.swift"},
        {"path": "../../ios/LibraryCapture.swift"},
        {"path": "../../ios/PageRenderer.swift"},
        {"path": "../../crates/tauri-plugin-notesage-ios/ios/Sources/LibraryAccess.swift"},
        # The Inbox's disk truth (badge count, seen set) — the extension
        # updates the badge after a capture with the same rule the app uses.
        {"path": "../../crates/tauri-plugin-notesage-ios/ios/Sources/InboxState.swift"},
        # Localizations (#653). The .lproj folders must land as RESOURCES of
        # the extension bundle — `buildPhase: resources` — or NSLocalizedString
        # falls back to the key at runtime. Also drives the "Languages" list
        # App Store Connect derives from the bundle.
        # Safari reads this at share time; it must be IN the bundle, so it is a
        # resource rather than a source. If it is missing, preprocessing simply
        # never runs and the extension silently falls back to fetching the URL
        # — the failure is invisible, which is why it is listed here rather
        # than left to be added by hand.
        {"path": "../../ios/share-preprocess.js", "buildPhase": "resources"},
        {"path": "../../ios/ShareResources/en.lproj", "buildPhase": "resources", "type": "folder"},
        {"path": "../../ios/ShareResources/sv.lproj", "buildPhase": "resources", "type": "folder"},
    ],
    # NO "info" key on purpose.
    #
    # Declaring `info:` makes xcodegen SYNTHESISE the plist, which is why the
    # extension's activation rule used to live here as a Python dict while
    # `src-tauri/ios/ShareExtension-Info.plist` sat beside it as a mirror that
    # was never built. Editing the mirror changed nothing and looked correct in
    # review — the failure mode that hides a fix in plain sight.
    #
    # Without the key, xcodegen leaves the plist alone and Xcode uses whatever
    # INFOPLIST_FILE points at (see `settings` below). `copy_share_info_plist`
    # puts the tracked file there. One source of truth, and it is a plist.
    "entitlements": {
        # Mirrors src-tauri/ios/ShareExtension.entitlements (App Group + the
        # iCloud container the library lives in).
        "path": "NotesageShare/NotesageShare.entitlements",
        "properties": {
            "com.apple.security.application-groups": [APP_GROUP],
            **ICLOUD_ENTITLEMENTS,
        },
    },
    "settings": {
        "base": {
            "PRODUCT_BUNDLE_IDENTIFIER": "com.notesage.app.ShareExtension",
            # The copy `copy_share_info_plist` writes, NOT the tracked original:
            # release-time version stamping must land on a gitignored file.
            "INFOPLIST_FILE": "NotesageShare/Info.plist",
            "CODE_SIGN_STYLE": "Automatic",
            "DEVELOPMENT_TEAM": TEAM_ID,
            "SWIFT_OBJC_BRIDGING_HEADER": "$(SRCROOT)/../../ios/NotesageCapture.h",
            "LIBRARY_SEARCH_PATHS[sdk=iphoneos*]": "$(SRCROOT)/../../target/aarch64-apple-ios/release",
            "LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]": "$(SRCROOT)/../../target/aarch64-apple-ios-sim/release",
            "OTHER_LDFLAGS": "-lnotesage_capture",
            "ARCHS": ["arm64"],
        }
    },
    "preBuildScripts": [
        {
            "script": CARGO_SCRIPT,
            "name": "Build capture staticlib",
            "basedOnDependencyAnalysis": False,
        }
    ],
}


def ios_marketing_version() -> str:
    """The iOS marketing version, from the config Tauri actually reads.

    `tauri.ios.conf.json` is the iOS version's own line (issue #721) — it moves
    when iOS ships something, independently of the desktop. Everything that
    needs the iOS version must read it from here, or drift back in.
    """
    conf = json.loads((REPO / "src-tauri/tauri.ios.conf.json").read_text())
    version = conf.get("version")
    if not version:
        sys.exit("tauri.ios.conf.json has no `version` — cannot version the extension")
    return str(version)


def patch_project_yml() -> None:
    data = yaml.safe_load(PROJECT_YML.read_text())
    targets = data.setdefault("targets", {})
    targets["NotesageShare"] = SHARE_TARGET  # idempotent: full overwrite

    app = targets["notesage_iOS"]
    deps = app.setdefault("dependencies", [])
    if not any(d.get("target") == "NotesageShare" for d in deps):
        deps.append({"target": "NotesageShare"})

    # Xcode warns when an extension's CFBundleShortVersionString differs from
    # its containing app's, and App Store Connect rejects the pair outright.
    #
    # Take the version from `tauri.ios.conf.json`, NOT from this file's app
    # target. Tauri reads that config directly and writes the resulting version
    # into the app's generated Info.plist at BUILD time, without ever writing it
    # back here — so the app target below stays at whatever it was when the
    # project was first generated. Mirroring it produced an extension pinned to
    # a long-dead version (0.48.0 against an app at 0.50.1).
    app_info = app.get("info", {}).get("properties", {})
    # The extension's plist is no longer declared here — it is the tracked file
    # copied by `copy_share_info_plist`, which writes the versions in after
    # xcodegen has run. Only the APP target's properties are patched below.
    # Set BOTH from the config. Tauri overwrites the app's generated plist at
    # build time anyway, but a plain `xcodegen generate` + Xcode build does not
    # go through Tauri — leaving the app target stale there would just move the
    # mismatch, with the extension ahead of the app instead of behind it.
    marketing = ios_marketing_version()
    app_info["CFBundleShortVersionString"] = marketing
    # The build number is stamped onto the archive after it exists
    # (`scripts/ios-testflight.sh`), so the value here is a placeholder for
    # local builds only — mirror the app's so the two agree in Xcode.

    # Export-compliance answer, baked in (TestFlight/App Store): Notesage
    # uses only standard HTTPS/TLS, which is exempt. Declaring it here stops
    # App Store Connect asking on EVERY upload and prevents a build sitting
    # in "Missing Compliance" limbo. Both targets get it — the extension is
    # a separate binary and is asked separately.
    app_info.setdefault("ITSAppUsesNonExemptEncryption", False)

    # The microphone (recordings PRD): declared here on purpose, with copy
    # written for the phone, rather than arriving by accident from the
    # macOS-oriented src-tauri/Info.plist that Tauri merges.
    app_info["NSMicrophoneUsageDescription"] = (
        "Notesage records meetings and voice notes you start yourself. Recordings stay in your library."
    )

    # Background audio (#833) — WITHOUT this the read-aloud player is silently
    # broken in exactly the case it exists for.
    #
    # `AVAudioSession(.playback)` alone is not enough: with no `audio` entry in
    # UIBackgroundModes, iOS gives a backgrounded app the ordinary ~30 s grace
    # period and then SUSPENDS it, so playback dies shortly after the screen
    # locks. The category and the background mode are two halves of one thing.
    #
    # Declared here rather than in `src-tauri/Info.plist` because that file is
    # merged for macOS; the iOS app's plist is the one xcodegen writes from
    # this target's properties.
    modes = app_info.setdefault("UIBackgroundModes", [])
    if "audio" not in modes:
        modes.append("audio")
    # `audio` covers playback (read-aloud) AND an in-progress recording:
    # `.playAndRecord` with this mode is what keeps the recorder alive with
    # the screen locked.
    # Background App Refresh (notifications PRD): the refresh task must be
    # both a permitted identifier and a declared background mode, or iOS
    # silently never schedules it — there is no runtime error to see.
    if "fetch" not in modes:
        modes.append("fetch")
    permitted = app_info.setdefault("BGTaskSchedulerPermittedIdentifiers", [])
    if BG_REFRESH_IDENTIFIER not in permitted:
        permitted.append(BG_REFRESH_IDENTIFIER)
    # The library is the app's own iCloud container; this is what shows it as
    # "Notesage" under iCloud Drive in Files. Same seam as
    # LSSupportsOpeningDocumentsInPlace: the app's Info.plist is written from
    # these properties, never edited by hand in gen/.
    app_info["NSUbiquitousContainers"] = UBIQUITOUS_CONTAINERS
    app.setdefault("info", {}).setdefault("properties", app_info)
    # The extension's copy of this answer lives in the tracked plist.

    # The App Group MUST go through the yml's entitlements `properties`, not a
    # direct plist edit: xcodegen REGENERATES the entitlements file on every
    # `xcodegen generate` (empty when no properties are declared), so a plist
    # patched beforehand is silently clobbered back to `{}` — the app then
    # ships unentitled and the extension can't see the shared bookmark.
    ent = app.setdefault("entitlements", {"path": "notesage_iOS/notesage_iOS.entitlements"})
    props = ent.setdefault("properties", {})
    groups = props.setdefault("com.apple.security.application-groups", [])
    if APP_GROUP not in groups:
        groups.append(APP_GROUP)
    # The iCloud container, through the same seam and for the same reason. A
    # build without these installs and launches — and then cannot see its
    # library, which reads as a bug in the app rather than in provisioning.
    for key, value in ICLOUD_ENTITLEMENTS.items():
        props[key] = list(value)

    exclude_static_lib_from_bundle(data)
    declare_document_handling(data)
    PROJECT_YML.write_text(yaml.safe_dump(data, sort_keys=False, width=1000))
    print(f"patched {PROJECT_YML.relative_to(REPO)}")


def declare_document_handling(data: dict) -> None:
    """Answer App Store validation's document-configuration question.

        WARN ITMS-90737: Missing Document Configuration. By declaring the
        CFBundleDocumentTypes key ... set LSSupportsOpeningDocumentsInPlace.

    We declare document types (`.md` and friends) so Notesage appears in
    "Open with". `false` is the truthful answer: the app reads and writes ONLY
    inside the security-scoped library folder the user granted, so it cannot
    edit a document sitting anywhere else in place. iOS therefore hands us a
    COPY in our own container — which is the same shape the Share Extension's
    capture already uses.

    A warning today, but Apple has a habit of promoting these to errors.
    """
    for target in data.get("targets", {}).values():
        info = target.get("info")
        if not isinstance(info, dict):
            continue
        if "notesage_iOS/Info.plist" not in str(info.get("path", "")):
            continue
        info.setdefault("properties", {})["LSSupportsOpeningDocumentsInPlace"] = False


def exclude_static_lib_from_bundle(data: dict) -> None:
    """`libapp.a` must not ship INSIDE the app bundle.

    Tauri's generated `project.yml` lists `Externals` as a source path of the
    app target, which makes XcodeGen copy everything under it — including the
    1.4 GB Rust staticlib — into the bundle as a resource, ON TOP of linking
    it properly via LIBRARY_SEARCH_PATHS. App Store validation rejects that
    outright:

        ERROR ITMS-90171: Invalid bundle structure. The
        "Notesage.app/libapp.a" binary file is not permitted.

    `buildPhase: none` keeps the folder visible in the project (and the
    linker's search paths untouched) while adding it to no build phase.
    Re-applied here because `tauri ios init` regenerates project.yml.
    """
    for target in data.get("targets", {}).values():
        sources = target.get("sources")
        if not isinstance(sources, list):
            continue
        for i, entry in enumerate(sources):
            if isinstance(entry, str) and entry == "Externals":
                sources[i] = {"path": "Externals", "buildPhase": "none"}
            elif isinstance(entry, dict) and entry.get("path") == "Externals":
                entry["buildPhase"] = "none"


def strip_icon_alpha() -> None:
    """App Store Connect rejects an app icon that merely HAS an alpha channel
    ("Invalid large app icon… can't contain an alpha channel"), even when the
    alpha is fully opaque — which is exactly what `tauri icon` emits. Flatten
    every generated icon onto white; the pixels are unchanged (verified fully
    opaque), only the channel goes away. Idempotent, and re-run automatically
    here so a future `tauri ios init` / icon regeneration can't silently
    reintroduce the rejection."""
    icons = REPO / "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset"
    if not icons.is_dir():
        return
    try:
        from PIL import Image
    except ImportError:
        print("! Pillow not installed — skipping icon alpha strip (App Store needs it)")
        return
    stripped = 0
    for path in sorted(icons.glob("*.png")):
        image = Image.open(path)
        if image.mode == "RGB":
            continue
        flat = Image.new("RGB", image.size, (255, 255, 255))
        flat.paste(image, mask=image.split()[-1] if image.mode == "RGBA" else None)
        flat.save(path, "PNG")
        stripped += 1
    if stripped:
        print(f"stripped alpha from {stripped} app icons (App Store requirement)")


def sync_launch_assets() -> None:
    """`tauri ios init` regenerates `LaunchScreen.storyboard` and the asset
    catalog from its own templates, which would drop the launch logo (#675).
    Keep the canonical copies under `src-tauri/ios/LaunchAssets/` and re-apply
    them here on every integration. The storyboard's icon must stay identical
    in size and position to the plugin's launch cover — the two are one
    continuous image across the launch-screen → webview handoff."""
    source = REPO / "src-tauri/ios/LaunchAssets"
    if not source.is_dir():
        return
    shutil.copyfile(source / "LaunchScreen.storyboard", GEN / "LaunchScreen.storyboard")
    imageset = GEN / "Assets.xcassets" / "LaunchLogo.imageset"
    if imageset.exists():
        shutil.rmtree(imageset)
    shutil.copytree(source / "LaunchLogo.imageset", imageset)
    print("synced launch screen + LaunchLogo imageset")


def copy_share_info_plist() -> None:
    """Install the tracked Info.plist as the extension's, versions filled in.

    Copied rather than referenced by INFOPLIST_FILE: `ios-testflight.sh` stamps
    the build number into the extension's plist at release time, and it
    promises to rewrite only gitignored files under `gen/`. Pointing Xcode at
    the tracked original would make that promise false.

    Run AFTER `xcodegen generate`: xcodegen creates the target directory, and
    with no `info:` key it leaves the file itself alone.
    """
    src = REPO / "src-tauri/ios/ShareExtension-Info.plist"
    data = plistlib.loads(src.read_bytes())
    # Versions are deliberately absent from the tracked file so the pair cannot
    # drift from the app. App Store Connect rejects a mismatched pair.
    marketing = ios_marketing_version()
    data["CFBundleShortVersionString"] = marketing
    # CFBundleVersion is a placeholder for local builds: the real build number
    # is stamped onto the ARCHIVE by `ios-testflight.sh`, after it exists.
    #
    # Deliberately NOT mirrored from project.yml's app target, which is stale by
    # construction — Tauri writes the app's version at build time and never
    # writes it back, so that value was 0.50.0.1 against an app at 0.53.0. The
    # same trap the CFBundleShortVersionString comment above describes.
    data["CFBundleVersion"] = marketing
    SHARE_INFO_PLIST.parent.mkdir(parents=True, exist_ok=True)
    SHARE_INFO_PLIST.write_bytes(plistlib.dumps(data))
    print(f"installed {SHARE_INFO_PLIST.relative_to(REPO)} from the tracked plist")


def main() -> None:
    if not PROJECT_YML.exists():
        sys.exit("gen/apple/project.yml not found — run `tauri ios init` first")
    patch_project_yml()
    strip_icon_alpha()
    sync_launch_assets()
    subprocess.run(["xcodegen", "generate"], cwd=GEN, check=True)
    copy_share_info_plist()
    ent = plistlib.loads(APP_ENTITLEMENTS.read_bytes())
    assert APP_GROUP in ent.get("com.apple.security.application-groups", []), (
        "app entitlements missing the App Group after generation"
    )
    # Both generated entitlements files must carry the container: the app
    # creates the library there and the extension resolves it independently.
    # `ios-testflight.sh` re-checks the same thing on the signed .ipa, but a
    # failure here is a build earlier and a lot cheaper.
    for label, path in (("app", APP_ENTITLEMENTS), ("extension", SHARE_ENTITLEMENTS)):
        generated = plistlib.loads(path.read_bytes())
        for key, expected in ICLOUD_ENTITLEMENTS.items():
            assert generated.get(key) == expected, (
                f"{label} entitlements missing {key} after generation "
                f"({path.relative_to(REPO)}): got {generated.get(key)!r}"
            )
    # The app's Info.plist is written at BUILD time by Tauri from project.yml's
    # `info.properties`, so assert on the yml: an absent key fails silently at
    # runtime (no refresh ever runs). Check the built .app with
    # `plutil -p Notesage.app/Info.plist` when verifying on a device.
    app_props = yaml.safe_load(PROJECT_YML.read_text())["targets"]["notesage_iOS"]["info"]["properties"]
    assert "fetch" in app_props.get("UIBackgroundModes", []), "UIBackgroundModes lacks fetch"
    assert BG_REFRESH_IDENTIFIER in app_props.get("BGTaskSchedulerPermittedIdentifiers", []), (
        "BGTaskSchedulerPermittedIdentifiers lacks the refresh task"
    )
    print("xcodegen regenerated the project — NotesageShare is wired")


if __name__ == "__main__":
    main()
