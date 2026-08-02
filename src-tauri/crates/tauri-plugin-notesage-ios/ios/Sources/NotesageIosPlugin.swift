import Foundation
import Tauri
import UIKit

struct PingArgs: Decodable {
  let value: String
}

class NotesageIosPlugin: Plugin {
  /// Round-trip probe. Echoes the value back so the Rust side can assert the
  /// full chain works before the real library-access surface is ported here.
  @objc public func ping(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PingArgs.self)
    invoke.resolve(["value": "swift:\(args.value)"])
  }
}

@_cdecl("init_plugin_notesage_ios")
func initPlugin() -> Plugin {
  return NotesageIosPlugin()
}
