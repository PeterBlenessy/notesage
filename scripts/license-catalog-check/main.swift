//
//  Exercise the licence catalogue: decoding, sectioning, search, and the
//  packaging guard.
//
//  The licences have to be *in the app*, not merely in the repository. MIT asks
//  that the notice accompany every copy, Apache 2.0 §4(d) that the NOTICE
//  attributions be reproduced — so a change that drops notices from the bundle
//  breaks the terms Notesage ships under, silently and invisibly. That is what
//  the last check here guards.
//
//  There is no XCTest target in this repo and adding one would mean a second
//  build system in CI, so this follows `check-library-ordering.sh` and its
//  siblings: compile the real source, assert against it, exit non-zero on a
//  failure. `LicenseCatalog.swift` imports Foundation and nothing else
//  precisely so this can run on macOS.
//
//  It reads the REAL generated file rather than a fixture. A fixture would
//  keep passing while the thing that actually ships rotted.
//
//  Named main.swift because Swift allows top-level code in that file only.
//

import Foundation

var failures = 0

func check(_ name: String, _ actual: some Equatable, _ expected: some Equatable) {
    let ok = "\(actual)" == "\(expected)"
    print("\(ok ? "ok  " : "FAIL") \(name)\(ok ? "" : "  — got \(actual), want \(expected)")")
    if !ok { failures += 1 }
}

func expect(_ name: String, _ condition: Bool, _ detail: @autoclosure () -> String = "") {
    print("\(condition ? "ok  " : "FAIL") \(name)\(condition ? "" : "  — \(detail())")")
    if !condition { failures += 1 }
}

// ---------------------------------------------------------------------------
// Synthetic cases: sectioning and search, where order and matching are the
// things a screenshot cannot confirm.
// ---------------------------------------------------------------------------

func comp(
    _ name: String, _ kind: String, licence: String? = nil,
    version: String? = nil, publisher: String? = nil, textId: String? = "t"
) -> LicenseCatalog.Component {
    LicenseCatalog.Component(
        kind: kind, name: name, version: version, license: licence,
        publisher: publisher, url: nil, textId: textId)
}

let mixed = [
    comp("zlib", "cargo"),
    comp("react", "npm"),
    comp("Inter", "bundled"),
    comp("Anchor", "npm"),
    comp("serde", "cargo"),
]

let sections = LicenseCatalog.sections(of: mixed)
check("section order is fixed", sections.map(\.title), ["Bundled", "Application", "Engine"])
check("npm section sorts case-insensitively", sections[1].components.map(\.name), ["Anchor", "react"])
check("cargo section sorts", sections[2].components.map(\.name), ["serde", "zlib"])

// An unknown ecosystem must surface, not be swallowed into "Other".
let withUnknown = mixed + [comp("mystery", "swiftpm")]
check(
    "unknown kind gets its own section, named after itself",
    LicenseCatalog.sections(of: withUnknown).map(\.title),
    ["Bundled", "Application", "Engine", "swiftpm"])

// Two builds of one package must order totally, or the list reshuffles between
// two reads of identical data.
let duplicates = [comp("dup", "npm", version: "2.0.0"), comp("dup", "npm", version: "1.0.0")]
check(
    "same name orders by version",
    LicenseCatalog.sections(of: duplicates)[0].components.map { $0.version ?? "" },
    ["1.0.0", "2.0.0"])

check("empty query returns everything", LicenseCatalog.filter(mixed, query: "").count, mixed.count)
check("whitespace query returns everything", LicenseCatalog.filter(mixed, query: "   ").count, mixed.count)
check("name search is case-insensitive", LicenseCatalog.filter(mixed, query: "REACT").map(\.name), ["react"])

let searchable = [
    comp("alpha", "npm", licence: "Apache-2.0", publisher: "Acme"),
    comp("beta", "npm", licence: "MIT", publisher: "Globex"),
]
check("licence is searchable", LicenseCatalog.filter(searchable, query: "apache").map(\.name), ["alpha"])
check("publisher is searchable", LicenseCatalog.filter(searchable, query: "globex").map(\.name), ["beta"])

check(
    "a component with no declared licence says so rather than showing nothing",
    LicenseCatalog.subtitle(for: comp("x", "npm")), "Licence not declared")
check(
    "subtitle carries licence and version",
    LicenseCatalog.subtitle(for: comp("x", "npm", licence: "MIT", version: "1.2.3")), "MIT · 1.2.3")

// ---------------------------------------------------------------------------
// The real file. This is the packaging guard.
// ---------------------------------------------------------------------------

let repo = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
let generated = repo.appendingPathComponent("src/generated/third-party-licenses.json")

guard let data = try? Data(contentsOf: generated) else {
    print("FAIL generated catalogue is missing at \(generated.path)")
    print("     run `pnpm licenses:generate`")
    exit(1)
}

do {
    let catalog = try LicenseCatalog.decode(data)

    expect(
        "the generated catalogue decodes into the shape the app reads",
        !catalog.components.isEmpty && !catalog.texts.isEmpty,
        "\(catalog.components.count) components, \(catalog.texts.count) texts")

    // A drop from ~1,500 to a handful is the failure this is here to catch: it
    // would look like a working screen with almost nothing on it.
    expect(
        "the catalogue still covers the whole dependency tree",
        catalog.components.count > 1_000,
        "only \(catalog.components.count) components — did the generator run against a pruned tree?")

    let kinds = Set(catalog.components.map(\.kind))
    expect(
        "both ecosystems are represented",
        kinds.contains("npm") && kinds.contains("cargo"),
        "kinds present: \(kinds.sorted())")

    // Every notice the components point at must actually be in the file. A
    // dangling textId means the screen shows a component with no licence text,
    // which is precisely the obligation being missed.
    let dangling = catalog.components.filter { c in
        guard let id = c.textId else { return false }
        return catalog.texts[id] == nil
    }
    expect(
        "no component points at a notice that is not in the file",
        dangling.isEmpty,
        "\(dangling.count) dangling, e.g. \(dangling.prefix(3).map(\.name))")

    // Truncation guard, borrowed from niva's AcknowledgementsTests: a notice
    // that got clipped still looks like a notice.
    let suspiciouslyShort = catalog.texts.filter { $0.value.count < 100 }
    expect(
        "no bundled notice looks truncated",
        suspiciouslyShort.isEmpty,
        "\(suspiciouslyShort.count) under 100 chars")

    // Components with no notice text at all: 167 of 1,510 at the time of
    // writing, 51 npm and 116 cargo. They are NOT unlicensed — they declare
    // one (61 MIT, 19 Apache-2.0, the rest dual-licence variants) but ship no
    // licence file, so the generator has nothing verbatim to carry.
    //
    // That is a real gap and it is recorded rather than accepted: the fix is
    // to substitute the canonical SPDX text when a package declares a licence
    // but omits its file, which is what most licence tooling does. It belongs
    // in `scripts/generate-licenses.mjs` and affects the desktop app equally,
    // so it is not this screen's job.
    //
    // The ceiling exists so the gap cannot quietly grow while nobody is
    // looking. Lower it when the generator learns canonical texts.
    let missing = LicenseCatalog.componentsWithoutText(catalog)
    expect(
        "the number of components with no notice text has not grown past the recorded gap",
        missing.count <= 170,
        "\(missing.count)/\(catalog.components.count) lack a notice — was 167; "
            + "if this grew, find out what stopped shipping its licence file")

    // Sectioning the real thing must not lose anyone.
    let sectioned = LicenseCatalog.sections(of: catalog.components)
    let total = sectioned.reduce(0) { $0 + $1.components.count }
    check("sectioning preserves every component", total, catalog.components.count)

    print("     \(catalog.components.count) components, \(catalog.texts.count) notices, \(missing.count) without text")
} catch {
    print("FAIL the generated catalogue does not decode — \(error)")
    failures += 1
}

print(failures == 0 ? "\nall checks passed" : "\n\(failures) check(s) failed")
exit(failures == 0 ? 0 : 1)
