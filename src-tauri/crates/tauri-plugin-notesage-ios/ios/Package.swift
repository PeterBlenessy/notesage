// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "tauri-plugin-notesage-ios",
  platforms: [
    .iOS(.v16)
  ],
  products: [
    .library(
      name: "tauri-plugin-notesage-ios",
      type: .static,
      targets: ["tauri-plugin-notesage-ios"])
  ],
  dependencies: [
    // Resolved by Tauri when it wires this package into the generated project.
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    // Declarations only, for the two `notesage_capture_*` functions a folder
    // screen needs to draw an article row. The definitions come from the
    // app's Rust static library at link time — see the header for why that
    // works and why the package cannot simply use the app's bridging header.
    .target(
      name: "CNotesageCapture",
      path: "CNotesageCapture",
      publicHeadersPath: "include"),
    .target(
      name: "tauri-plugin-notesage-ios",
      dependencies: [
        .byName(name: "Tauri"),
        .byName(name: "CNotesageCapture"),
      ],
      path: "Sources")
  ]
)
