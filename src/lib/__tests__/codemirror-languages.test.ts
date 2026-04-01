import { describe, it, expect } from "vitest";
import { isCodeFile, getLanguageName, loadLanguage } from "../codemirror-languages";

describe("isCodeFile", () => {
  const supportedFiles = [
    "main.js", "app.jsx", "index.mjs", "main.ts", "App.tsx",
    "script.py", "lib.rs", "main.go", "App.java",
    "main.c", "utils.h", "main.cpp", "utils.hpp",
    "index.html", "styles.css", "config.json",
    "config.yaml", "config.yml", "config.toml",
    "README.md", "script.sh", "script.bash", "script.zsh",
    "query.sql", "data.xml", "main.swift", "Main.kt",
    "app.rb", "index.php",
  ];

  it.each(supportedFiles)("returns true for %s", (fileName) => {
    expect(isCodeFile(fileName)).toBe(true);
  });

  const unsupportedFiles = [
    "readme.txt", "debug.log", "data.csv", "export.dat",
    "Makefile", "LICENSE", "Dockerfile",
  ];

  it.each(unsupportedFiles)("returns false for %s", (fileName) => {
    expect(isCodeFile(fileName)).toBe(false);
  });

  it("returns false for files with no extension", () => {
    expect(isCodeFile("Makefile")).toBe(false);
    expect(isCodeFile("LICENSE")).toBe(false);
  });

  it("is case-insensitive for extensions", () => {
    expect(isCodeFile("main.JS")).toBe(true);
    expect(isCodeFile("main.TS")).toBe(true);
    expect(isCodeFile("main.PY")).toBe(true);
  });
});

describe("getLanguageName", () => {
  const expectedNames: [string, string][] = [
    ["js", "JavaScript"],
    ["jsx", "JSX"],
    ["mjs", "JavaScript"],
    ["ts", "TypeScript"],
    ["tsx", "TSX"],
    ["py", "Python"],
    ["rs", "Rust"],
    ["go", "Go"],
    ["java", "Java"],
    ["c", "C"],
    ["h", "C/C++ Header"],
    ["cpp", "C++"],
    ["hpp", "C++ Header"],
    ["html", "HTML"],
    ["css", "CSS"],
    ["json", "JSON"],
    ["yaml", "YAML"],
    ["yml", "YAML"],
    ["toml", "TOML"],
    ["md", "Markdown"],
    ["sh", "Shell"],
    ["bash", "Bash"],
    ["zsh", "Zsh"],
    ["sql", "SQL"],
    ["xml", "XML"],
    ["swift", "Swift"],
    ["kt", "Kotlin"],
    ["rb", "Ruby"],
    ["php", "PHP"],
  ];

  it.each(expectedNames)("returns '%s' → '%s'", (ext, name) => {
    expect(getLanguageName(ext)).toBe(name);
  });

  it("returns null for unsupported extensions", () => {
    expect(getLanguageName("txt")).toBeNull();
    expect(getLanguageName("log")).toBeNull();
    expect(getLanguageName("csv")).toBeNull();
    expect(getLanguageName("dat")).toBeNull();
    expect(getLanguageName("")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(getLanguageName("JS")).toBe("JavaScript");
    expect(getLanguageName("PY")).toBe("Python");
  });
});

describe("loadLanguage", () => {
  it("resolves to a LanguageSupport-like object for supported extensions", async () => {
    const lang = await loadLanguage("ts");
    expect(lang).not.toBeNull();
    // LanguageSupport has an extension property
    expect(lang).toHaveProperty("extension");
  });

  it("resolves to null for unsupported extensions", async () => {
    expect(await loadLanguage("txt")).toBeNull();
    expect(await loadLanguage("unknown")).toBeNull();
    expect(await loadLanguage("")).toBeNull();
  });

  it("loads a legacy-mode language (shell)", async () => {
    const lang = await loadLanguage("sh");
    expect(lang).not.toBeNull();
    expect(lang).toHaveProperty("extension");
  });

  it("loads a legacy-mode language (toml)", async () => {
    const lang = await loadLanguage("toml");
    expect(lang).not.toBeNull();
    expect(lang).toHaveProperty("extension");
  });

  it("loads a legacy-mode language (swift)", async () => {
    const lang = await loadLanguage("swift");
    expect(lang).not.toBeNull();
  });

  it("loads a legacy-mode language (kotlin)", async () => {
    const lang = await loadLanguage("kt");
    expect(lang).not.toBeNull();
  });

  it("loads a legacy-mode language (ruby)", async () => {
    const lang = await loadLanguage("rb");
    expect(lang).not.toBeNull();
  });
});
