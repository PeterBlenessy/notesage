import Foundation
import Tauri
import UIKit

// MARK: - Argument types (decoded from the invoke payload)

struct RelPathArgs: Decodable {
  let relPath: String
}

// MARK: - Plugin

/// Bridges the mobile reader's library access to iOS.
///
/// Every `relPath` arriving here has already been sanitized by the Rust layer
/// (`ios_library::sanitize_rel_path` rejects absolute paths and `..`), so this
/// side resolves them against the bookmarked root without re-validating.
///
/// Deliberately read-only: there is no capture method here. The Share
/// Extension writes captures in its own process, so exposing a write on the
/// app's plugin would widen its surface for something the app never does.
class NotesageIosPlugin: Plugin {
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
      invoke.resolve(["entries": try LibraryAccess.listDirectory(args.relPath)])
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
      invoke.resolve(["bytes": [UInt8](try LibraryAccess.readBinary(args.relPath))])
    } catch { invoke.reject(String(describing: error)) }
  }

  @objc public func ensureDownloaded(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(RelPathArgs.self)
      invoke.resolve(["state": try LibraryAccess.ensureDownloaded(args.relPath).rawValue])
    } catch { invoke.reject(String(describing: error)) }
  }
}

@_cdecl("init_plugin_notesage_ios")
func initPlugin() -> Plugin {
  return NotesageIosPlugin()
}
