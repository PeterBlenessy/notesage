import { LanguageSupport, StreamLanguage } from "@codemirror/language";

/**
 * Extension → language loader mapping with dynamic imports.
 * Each entry is a factory that returns a `LanguageSupport` instance.
 * Vite splits each import into a separate chunk — zero initial bundle cost.
 */
const LANGUAGE_MAP: Record<string, () => Promise<LanguageSupport>> = {
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: false })),
  jsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  mjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  ts: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  tsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true, typescript: true })),
  py: () => import("@codemirror/lang-python").then((m) => m.python()),
  rs: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  c: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  h: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  hpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  yml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  toml: () =>
    import("@codemirror/legacy-modes/mode/toml").then(
      (m) => new LanguageSupport(StreamLanguage.define(m.toml)),
    ),
  md: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  sh: () =>
    import("@codemirror/legacy-modes/mode/shell").then(
      (m) => new LanguageSupport(StreamLanguage.define(m.shell)),
    ),
  bash: () =>
    import("@codemirror/legacy-modes/mode/shell").then(
      (m) => new LanguageSupport(StreamLanguage.define(m.shell)),
    ),
  zsh: () =>
    import("@codemirror/legacy-modes/mode/shell").then(
      (m) => new LanguageSupport(StreamLanguage.define(m.shell)),
    ),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  swift: () =>
    import("@codemirror/legacy-modes/mode/swift").then(
      (m) => new LanguageSupport(StreamLanguage.define(m.swift)),
    ),
  kt: () =>
    import("@codemirror/legacy-modes/mode/clike").then(
      (m) => new LanguageSupport(StreamLanguage.define(m.kotlin)),
    ),
  rb: () =>
    import("@codemirror/legacy-modes/mode/ruby").then(
      (m) => new LanguageSupport(StreamLanguage.define(m.ruby)),
    ),
  php: () => import("@codemirror/lang-php").then((m) => m.php()),
};

/** Human-readable display names for supported extensions. */
const LANGUAGE_NAMES: Record<string, string> = {
  js: "JavaScript",
  jsx: "JSX",
  mjs: "JavaScript",
  ts: "TypeScript",
  tsx: "TSX",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  c: "C",
  h: "C/C++ Header",
  cpp: "C++",
  hpp: "C++ Header",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  md: "Markdown",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  sql: "SQL",
  xml: "XML",
  swift: "Swift",
  kt: "Kotlin",
  rb: "Ruby",
  php: "PHP",
};

/** Extensions that open in the HTML rendered viewer instead of CodeEditor. */
const HTML_VIEWER_EXTENSIONS = new Set(["html", "htm"]);

/**
 * Check if a filename should open in the HtmlViewer (rendered iframe mode).
 */
export function isHtmlViewerFile(fileName: string): boolean {
  return HTML_VIEWER_EXTENSIONS.has(getExtension(fileName));
}

/**
 * Check if a filename has a known code file extension.
 * Returns `true` for files that should open in the CodeEditor.
 * Note: .html/.htm files are excluded — they open in HtmlViewer instead.
 */
export function isCodeFile(fileName: string): boolean {
  const ext = getExtension(fileName);
  return ext !== "" && ext in LANGUAGE_MAP && !HTML_VIEWER_EXTENSIONS.has(ext);
}

/**
 * Get the human-readable language name for a file extension.
 * Returns `null` for unsupported extensions.
 */
export function getLanguageName(extension: string): string | null {
  return LANGUAGE_NAMES[extension.toLowerCase()] ?? null;
}

/**
 * Dynamically load the CodeMirror language support for a file extension.
 * Returns `null` for unsupported extensions.
 */
export async function loadLanguage(extension: string): Promise<LanguageSupport | null> {
  const loader = LANGUAGE_MAP[extension.toLowerCase()];
  if (!loader) return null;
  try {
    return await loader();
  } catch {
    return null;
  }
}

/** Extract the file extension (lowercase, no dot) from a filename. */
function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/** Re-export getExtension for use by CodeEditor */
export { getExtension };
