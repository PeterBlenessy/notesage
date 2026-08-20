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
     writes the security-scoped library bookmark into the shared
     `group.com.notesage.app` UserDefaults suite, which is what the extension
     resolves to write captures.
  3. Registers the extension as a dependency of the app target (xcodegen
     embeds app-extension dependencies into PlugIns/ automatically).
  4. Re-runs `xcodegen generate`.

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
APP_ENTITLEMENTS = GEN / "notesage_iOS" / "notesage_iOS.entitlements"

APP_GROUP = "group.com.notesage.app"
TEAM_ID = "M39TDQ2D7L"

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
        # Localizations (#653). The .lproj folders must land as RESOURCES of
        # the extension bundle — `buildPhase: resources` — or NSLocalizedString
        # falls back to the key at runtime. Also drives the "Languages" list
        # App Store Connect derives from the bundle.
        {"path": "../../ios/ShareResources/en.lproj", "buildPhase": "resources", "type": "folder"},
        {"path": "../../ios/ShareResources/sv.lproj", "buildPhase": "resources", "type": "folder"},
    ],
    "info": {
        # xcodegen GENERATES this file (adds CFBundle* defaults itself); the
        # properties mirror src-tauri/ios/ShareExtension-Info.plist.
        "path": "NotesageShare/Info.plist",
        "properties": {
            "CFBundleDisplayName": "Notesage",
            "NSExtension": {
                "NSExtensionPointIdentifier": "com.apple.share-services",
                "NSExtensionPrincipalClass": "$(PRODUCT_MODULE_NAME).ShareViewController",
                "NSExtensionAttributes": {
                    "NSExtensionActivationRule": {
                        "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
                        "NSExtensionActivationSupportsText": True,
                        # Documents (Safari-viewed PDFs, Files shares, EPUBs…)
                        # — without this iOS never lists Notesage for files.
                        "NSExtensionActivationSupportsFileWithMaxCount": 3,
                        "NSExtensionActivationSupportsImageWithMaxCount": 10,
                        "NSExtensionActivationSupportsMovieWithMaxCount": 3,
                    }
                },
            },
        },
    },
    "entitlements": {
        # Mirrors src-tauri/ios/ShareExtension.entitlements (App Group only).
        "path": "NotesageShare/NotesageShare.entitlements",
        "properties": {"com.apple.security.application-groups": [APP_GROUP]},
    },
    "settings": {
        "base": {
            "PRODUCT_BUNDLE_IDENTIFIER": "com.notesage.app.ShareExtension",
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
    share_info = targets["NotesageShare"]["info"]["properties"]
    # Set BOTH from the config. Tauri overwrites the app's generated plist at
    # build time anyway, but a plain `xcodegen generate` + Xcode build does not
    # go through Tauri — leaving the app target stale there would just move the
    # mismatch, with the extension ahead of the app instead of behind it.
    marketing = ios_marketing_version()
    app_info["CFBundleShortVersionString"] = marketing
    share_info["CFBundleShortVersionString"] = marketing
    # The build number is stamped onto the archive after it exists
    # (`scripts/ios-testflight.sh`), so the value here is a placeholder for
    # local builds only — mirror the app's so the two agree in Xcode.
    if "CFBundleVersion" in app_info:
        share_info["CFBundleVersion"] = app_info["CFBundleVersion"]

    # Export-compliance answer, baked in (TestFlight/App Store): Notesage
    # uses only standard HTTPS/TLS, which is exempt. Declaring it here stops
    # App Store Connect asking on EVERY upload and prevents a build sitting
    # in "Missing Compliance" limbo. Both targets get it — the extension is
    # a separate binary and is asked separately.
    app_info.setdefault("ITSAppUsesNonExemptEncryption", False)
    app.setdefault("info", {}).setdefault("properties", app_info)
    share_info.setdefault("ITSAppUsesNonExemptEncryption", False)

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


def main() -> None:
    if not PROJECT_YML.exists():
        sys.exit("gen/apple/project.yml not found — run `tauri ios init` first")
    patch_project_yml()
    strip_icon_alpha()
    sync_launch_assets()
    subprocess.run(["xcodegen", "generate"], cwd=GEN, check=True)
    ent = plistlib.loads(APP_ENTITLEMENTS.read_bytes())
    assert APP_GROUP in ent.get("com.apple.security.application-groups", []), (
        "app entitlements missing the App Group after generation"
    )
    print("xcodegen regenerated the project — NotesageShare is wired")


if __name__ == "__main__":
    main()
