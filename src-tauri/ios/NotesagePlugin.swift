// NotesagePlugin.swift — Tauri mobile plugin bridge (reference source).
//
// Exposes the LibraryAccess logic to Rust as a Tauri v2 iOS plugin. The Rust
// commands in `commands/ios_library.rs::ios_impl` call these methods via
// `PluginHandle::run_mobile_plugin("<method>", payload)` (see
// `src-tauri/ios/README.md` for the one-time wiring). This file is the bridge;
// `LibraryAccess.swift` holds the actual security-scoped / NSFileCoordinator
// logic and is reused by the Share Extension without Tauri.
//
// NOT yet integrated — needs `tauri ios init` on a Mac so the `Tauri` Swift
// package (Plugin / Invoke) is on the path, then add this file to the app
// target and register the plugin (see README).

import Foundation
import Tauri
import UIKit

// MARK: - Argument types (decoded from the JS invoke payload)

struct RelPathArgs: Decodable { let relPath: String }
struct CaptureArgs: Decodable {
    let url: String
    let title: String?
    let selectionText: String?
    let tags: [String]?
}

// MARK: - Plugin

class NotesagePlugin: Plugin {
    private var topViewController: UIViewController? {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?.rootViewController
    }

    @objc public func pickLibraryFolder(_ invoke: Invoke) {
        DispatchQueue.main.async {
            guard let presenter = self.topViewController else {
                invoke.reject("No view controller to present the folder picker")
                return
            }
            LibraryAccess.pickLibraryFolder(presenter: presenter) { result in
                switch result {
                case .success(let grant):
                    invoke.resolve(["displayName": grant.displayName, "granted": grant.granted])
                case .failure(let error):
                    invoke.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc public func getLibraryGrant(_ invoke: Invoke) {
        let g = LibraryAccess.getLibraryGrant()
        invoke.resolve(["displayName": g.displayName, "granted": g.granted])
    }

    @objc public func clearLibraryGrant(_ invoke: Invoke) {
        LibraryAccess.clearLibraryGrant()
        invoke.resolve()
    }

    @objc public func listDirectory(_ invoke: Invoke) {
        do {
            let args = try invoke.parseArgs(RelPathArgs.self)
            let entries = try LibraryAccess.listDirectory(args.relPath)
            // FileEntryDTO is Codable → resolve the encoded array directly.
            invoke.resolve(["entries": entries])
        } catch { invoke.reject(String(describing: error)) }
    }

    @objc public func readFile(_ invoke: Invoke) {
        do {
            let args = try invoke.parseArgs(RelPathArgs.self)
            invoke.resolve(["text": try LibraryAccess.readFile(args.relPath)])
        } catch { invoke.reject(String(describing: error)) }
    }

    @objc public func readBinary(_ invoke: Invoke) {
        do {
            let args = try invoke.parseArgs(RelPathArgs.self)
            let data = try LibraryAccess.readBinary(args.relPath)
            invoke.resolve(["bytes": [UInt8](data)])
        } catch { invoke.reject(String(describing: error)) }
    }

    @objc public func ensureDownloaded(_ invoke: Invoke) {
        do {
            let args = try invoke.parseArgs(RelPathArgs.self)
            invoke.resolve(["state": try LibraryAccess.ensureDownloaded(args.relPath).rawValue])
        } catch { invoke.reject(String(describing: error)) }
    }

    @objc public func writeCapture(_ invoke: Invoke) {
        do {
            let args = try invoke.parseArgs(CaptureArgs.self)
            let rel = try LibraryAccess.writeCapture(
                url: args.url,
                title: args.title,
                selectionText: args.selectionText,
                tags: args.tags ?? []
            )
            invoke.resolve(["relPath": rel])
        } catch { invoke.reject(String(describing: error)) }
    }
}

// Registered from Rust via `tauri::ios_plugin_binding!(init_plugin_notesage)`.
@_cdecl("init_plugin_notesage")
func initPlugin() -> Plugin {
    return NotesagePlugin()
}
