#!/usr/bin/env bash
# Generate pkg-config stub files for building Notesage on Linux.
#
# Tauri v2 depends on WebKitGTK on Linux, which requires system-level
# GTK3/GDK3 development libraries.  When these are not installed (e.g. in
# CI or lightweight dev containers), `cargo check` fails at the pkg-config
# probe step.
#
# This script creates minimal .pc stub files that satisfy pkg-config so
# that `cargo check` (compile-only, no linking) can succeed.  For a full
# `cargo build` or `cargo test`, install the real dev packages:
#
#   sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev \
#       libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libasound2-dev
#
# Usage:
#   ./scripts/generate-pkg-config-stubs.sh
#   PKG_CONFIG_PATH=$(pwd)/.pkg-config-stubs cargo check

set -euo pipefail

STUB_DIR="$(cd "$(dirname "$0")/.." && pwd)/.pkg-config-stubs"
mkdir -p "$STUB_DIR"

PACKAGES=(
  # GTK / GDK
  gdk-3.0 gdk-x11-3.0 gdk-wayland-3.0 gdkwayland-3.0
  gtk+-3.0

  # GLib ecosystem
  glib-2.0 gobject-2.0 gio-2.0 gio-unix-2.0
  gmodule-2.0 gmodule-no-export-2.0 gmodule-export-2.0 gthread-2.0

  # Graphics
  gdk-pixbuf-2.0 cairo cairo-gobject cairo-ft
  pango pangocairo pangoft2

  # Text / fonts
  harfbuzz fontconfig freetype2 fribidi

  # Low-level graphics
  pixman-1 libpng16 zlib epoxy egl gl glesv2

  # WebKitGTK / Soup
  webkit2gtk-4.1 javascriptcoregtk-4.1 libsoup-3.0

  # Wayland
  wayland-client wayland-protocols wayland-server wayland-egl

  # X11
  x11 xrandr xi xext xau xcb xdmcp xrender xfixes xcursor
  xcomposite xdamage xinerama xtst xkbcommon

  # Accessibility
  atk atk-bridge-2.0 atspi-2

  # System
  alsa dbus-1 sysprof-capture-4 libffi
  openssl libcrypto libssl libudev
)

for pkg in "${PACKAGES[@]}"; do
  cat > "$STUB_DIR/$pkg.pc" <<PCEOF
prefix=/usr
libdir=\${prefix}/lib/x86_64-linux-gnu
includedir=\${prefix}/include

Name: $pkg
Description: Stub for cargo check on Linux (Notesage targets macOS)
Version: 99.0.0
Cflags: -I\${includedir}
Libs: -L\${libdir}
PCEOF
done

echo "Generated $(ls "$STUB_DIR"/*.pc | wc -l) pkg-config stubs in $STUB_DIR"
echo ""
echo "Run cargo check with:"
echo "  PKG_CONFIG_PATH=$STUB_DIR cargo check"
