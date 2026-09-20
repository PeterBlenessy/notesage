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
// Licence grouping: the top level of the screen.
// ---------------------------------------------------------------------------

// One dual licence spelled three ways covers 592 of 1,510 components. Left
// alone that is three rows saying the same thing.
check("OR is unordered, so both spellings canonicalise the same",
      LicenseCatalog.canonicalLicence("Apache-2.0 OR MIT"),
      LicenseCatalog.canonicalLicence("MIT OR Apache-2.0"))
check("slash form joins them", LicenseCatalog.canonicalLicence("MIT/Apache-2.0"), "Apache-2.0 OR MIT")
check("lower-case or is the same licence", LicenseCatalog.canonicalLicence("MIT or Apache-2.0"), "Apache-2.0 OR MIT")
check("a single licence is left alone", LicenseCatalog.canonicalLicence("MIT"), "MIT")
check("an undeclared licence says so", LicenseCatalog.canonicalLicence(nil), "Licence not declared")
check("empty counts as undeclared", LicenseCatalog.canonicalLicence("   "), "Licence not declared")
// An expression this does not understand must look odd rather than be folded
// into something it is not.
check("a wrapping pair of brackets is not its own row",
      LicenseCatalog.canonicalLicence("(MPL-2.0 OR Apache-2.0)"), "Apache-2.0 OR MPL-2.0")
// Brackets that group part of a compound expression carry meaning.
check("inner brackets are left alone",
      LicenseCatalog.canonicalLicence("(MIT OR Apache-2.0) AND Unicode-3.0"),
      "(MIT OR Apache-2.0) AND Unicode-3.0")
check("an unrecognised expression passes through",
      LicenseCatalog.canonicalLicence("SomeLicence WITH an-exception"),
      "SomeLicence WITH an-exception")

let grouped = LicenseCatalog.licenceGroups(of: [
    comp("a", "npm", licence: "MIT"),
    comp("b", "npm", licence: "MIT OR Apache-2.0"),
    comp("c", "cargo", licence: "Apache-2.0 OR MIT"),
    comp("d", "cargo", licence: "MIT"),
    comp("e", "cargo", licence: "MIT"),
])
check("groups are largest-first", grouped.map(\.licence), ["MIT", "Apache-2.0 OR MIT"])
check("the dual spellings landed in one group", grouped[1].components.map(\.name), ["b", "c"])
check("group subtitle counts packages", LicenseCatalog.subtitle(for: grouped[0]), "3 packages")
check("one package is not pluralised", LicenseCatalog.subtitle(for: grouped[1]).isEmpty, false)

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

    // 65 of 1,510, down from 167 once the generator learned canonical texts.
    //
    // Every one that remains is copyright-bearing — 61 MIT, the rest BSD and
    // ISC — and those cannot be filled from a template: MIT asks for "the
    // above copyright notice", which is the package's own and is not
    // recoverable. A canonical MIT text would read as compliance while
    // attributing nobody, which is worse than admitting the gap.
    //
    // The 102 that WERE fillable are the fixed-text licences, whose words are
    // the same for every licensor. The check below pins that at zero.
    let missing = LicenseCatalog.componentsWithoutText(catalog)
    expect(
        "the number of components with no notice text has not grown past the recorded gap",
        missing.count <= 70,
        "\(missing.count)/\(catalog.components.count) lack a notice — was 65; "
            + "if this grew, find out what stopped shipping its licence file")

    // The fallback's whole claim: a licence whose text is fixed can always be
    // carried, so none of them may be missing one. If this fails the canonical
    // texts have stopped being applied and 102 components lost their notice.
    let fixedText = ["Apache-2.0", "MPL-2.0", "BSL-1.0", "CC0-1.0", "Unicode-3.0", "Unlicense"]
    let fixedWithoutText = missing.filter { component in
        guard let licence = component.license else { return false }
        return fixedText.contains { licence.contains($0) }
    }
    expect(
        "no fixed-text licence is left without a notice",
        fixedWithoutText.isEmpty,
        "\(fixedWithoutText.count) e.g. \(fixedWithoutText.prefix(3).map(\.name))")

    // And the substitution must actually be happening.
    let canonical = catalog.components.filter { $0.canonicalFor != nil }
    expect(
        "the canonical-text fallback is carrying the packages that ship none",
        canonical.count > 90,
        "only \(canonical.count) components carry a canonical text")

    // Sectioning the real thing must not lose anyone.
    let sectioned = LicenseCatalog.sections(of: catalog.components)
    let total = sectioned.reduce(0) { $0 + $1.components.count }
    check("sectioning preserves every component", total, catalog.components.count)

    // Nor may grouping — the screen shows fewer ROWS, never fewer notices.
    let groups = LicenseCatalog.licenceGroups(of: catalog.components)
    let grouped = groups.reduce(0) { $0 + $1.components.count }
    check("grouping preserves every component", grouped, catalog.components.count)
    // 42 today, and that is what the data is rather than a target that was
    // aimed at: the top twelve rows cover 97% of the components and the tail
    // is genuinely different terms, not spellings left unnormalised. The cap
    // is here to catch canonicalisation regressing — without it the raw count
    // is 51 — not to push the number down further.
    expect(
        "grouping collapses the list to something a person can scan",
        groups.count <= 45,
        "\(groups.count) licence rows from \(catalog.components.count) components")
    // Every notice still reachable: the union of the groups' textIds must be
    // every textId in the file, or a notice exists that nothing can open.
    let reachable = Set(groups.flatMap(\.textIds))
    let all = Set(catalog.components.compactMap(\.textId))
    check("every notice is reachable from some group", reachable.count, all.count)
    print("     \(groups.count) licence groups, largest: \(groups[0].licence) (\(groups[0].components.count))")

    print("     \(catalog.components.count) components, \(catalog.texts.count) notices, \(missing.count) without text")
} catch {
    print("FAIL the generated catalogue does not decode — \(error)")
    failures += 1
}

print(failures == 0 ? "\nall checks passed" : "\n\(failures) check(s) failed")
exit(failures == 0 ? 0 : 1)
