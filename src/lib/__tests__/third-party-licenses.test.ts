import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import data from "@/generated/third-party-licenses.json";

/**
 * The notice list is an obligation, not a courtesy (#949): most of the
 * licences Notesage ships under require the notice to travel with the
 * distributed copy. These guard the two ways that quietly stops being true —
 * the generated list going missing or empty, and a bundled component losing
 * the licence file the generator reads its text from.
 */
const ROOT = resolve(__dirname, "../../..");

interface Component {
  kind: string;
  name: string;
  version: string;
  license: string;
  textId: string | null;
}

const components = data.components as Component[];
const texts = data.texts as Record<string, string>;

describe("third-party notice list", () => {
  it("covers both dependency ecosystems and the hand-declared bundles", () => {
    const kinds = new Set(components.map((c) => c.kind));
    expect(kinds).toEqual(new Set(["bundled", "npm", "cargo"]));
    // Sanity floor rather than an exact count: the point is that a generator
    // that silently produced nothing fails here.
    expect(components.filter((c) => c.kind === "npm").length).toBeGreaterThan(100);
    expect(components.filter((c) => c.kind === "cargo").length).toBeGreaterThan(100);
  });

  it("names the components that ship outside any manifest", () => {
    const bundled = components.filter((c) => c.kind === "bundled").map((c) => c.name);
    expect(bundled).toContain("foliate-js");
    expect(bundled).toContain("zip.js");
    expect(bundled.some((n) => n.includes("llama.cpp"))).toBe(true);
    expect(bundled.some((n) => n.includes("Inter"))).toBe(true);
  });

  it("carries the full text for every bundled component", () => {
    for (const c of components.filter((c) => c.kind === "bundled")) {
      expect(c.textId, `${c.name} has no licence text`).toBeTruthy();
      expect(texts[c.textId!]?.length ?? 0).toBeGreaterThan(200);
    }
  });

  it("resolves every text id it references", () => {
    const missing = components.filter((c) => c.textId && !texts[c.textId]).map((c) => c.name);
    expect(missing).toEqual([]);
  });

  it("declares a licence for everything, so nothing ships unattributed", () => {
    const unknown = components.filter((c) => c.license === "UNKNOWN" && !c.textId).map((c) => c.name);
    // A package with no declared licence AND no licence file cannot be
    // attributed at all — that needs a human decision, not a silent row.
    expect(unknown).toEqual([]);
  });
});

describe("the licence files the generator reads from", () => {
  // These are vendored or downloaded, so nothing but this test notices when
  // one goes missing — and the generator would then throw at release time.
  it.each([
    "public/foliate-js/LICENSE",
    "public/foliate-js/vendor/LICENSE",
    "src-tauri/binaries/LICENSE",
    "src-tauri/fonts/LICENSE",
  ])("%s ships with the thing it covers", (rel) => {
    const path = resolve(ROOT, rel);
    expect(existsSync(path), `${rel} is missing`).toBe(true);
    expect(readFileSync(path, "utf8").trim().length).toBeGreaterThan(200);
  });
});
