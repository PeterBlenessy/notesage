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
    .target(
      name: "tauri-plugin-notesage-ios",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
