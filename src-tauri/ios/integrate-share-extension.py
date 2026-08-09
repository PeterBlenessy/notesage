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

import plistlib
import subprocess
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
        {"path": "../../crates/tauri-plugin-notesage-ios/ios/Sources/LibraryAccess.swift"},
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


def patch_project_yml() -> None:
    data = yaml.safe_load(PROJECT_YML.read_text())
    targets = data.setdefault("targets", {})
    targets["NotesageShare"] = SHARE_TARGET  # idempotent: full overwrite

    app = targets["notesage_iOS"]
    deps = app.setdefault("dependencies", [])
    if not any(d.get("target") == "NotesageShare" for d in deps):
        deps.append({"target": "NotesageShare"})

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

    PROJECT_YML.write_text(yaml.safe_dump(data, sort_keys=False, width=1000))
    print(f"patched {PROJECT_YML.relative_to(REPO)}")


def main() -> None:
    if not PROJECT_YML.exists():
        sys.exit("gen/apple/project.yml not found — run `tauri ios init` first")
    patch_project_yml()
    subprocess.run(["xcodegen", "generate"], cwd=GEN, check=True)
    ent = plistlib.loads(APP_ENTITLEMENTS.read_bytes())
    assert APP_GROUP in ent.get("com.apple.security.application-groups", []), (
        "app entitlements missing the App Group after generation"
    )
    print("xcodegen regenerated the project — NotesageShare is wired")


if __name__ == "__main__":
    main()
