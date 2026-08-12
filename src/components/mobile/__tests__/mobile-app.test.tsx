// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  setMockInvokeHandler,
} from "@/test/component-harness";
import { useMobileStore } from "@/stores/mobile-store";
import { LibraryBrowser } from "@/components/mobile/LibraryBrowser";
import { Reader } from "@/components/mobile/Reader";
import { Onboarding } from "@/components/mobile/Onboarding";

// pdf.js needs browser globals (DOMMatrix) absent in jsdom; the Reader
// lazy-loads the viewer, so stub it to assert routing without rendering pdf.js.
vi.mock("@/components/editor/viewers/PdfViewer", () => ({
  PdfViewer: ({ fileName }: { fileName: string }) => <div>pdf-viewer:{fileName}</div>,
}));

// The reader opens external links through the opener plugin — capture calls.
const openUrlMock = vi.fn((_url: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrlMock(url),
}));

/** Mirrors MobileApp's screen switch without ThemeProvider (avoids matchMedia). */
function Shell() {
  const openDoc = useMobileStore((s) => s.openDoc);
  return openDoc ? <Reader /> : <LibraryBrowser />;
}

const invokeMock = vi.mocked(invoke);
const calledCommands = () => invokeMock.mock.calls.map((c) => c[0] as string);

/** Commands the read-only mobile shell is allowed to invoke. */
const ALLOWED = new Set([
  "ios_get_library_grant",
  "ios_pick_library_folder",
  "ios_clear_library_grant",
  "ios_list_directory",
  "ios_read_file",
  "ios_read_binary",
  "ios_ensure_downloaded",
  // Cheap metadata probe (size only, no content) run before ios_read_file for
  // text/markdown/html — lets the reader decline an oversized file instead of
  // reading it (issue #616).
  "ios_stat_file",
  // Presents the native share sheet over a TEMP COPY of the file — reads the
  // library, writes only to the app's own temp dir.
  "ios_share_file",
  // Declares the native chrome overlay — pure UI, no filesystem access. In
  // tests it is unmocked and rejects, which is exactly the web-fallback path.
  "ios_set_chrome",
  // Pure render — takes markdown text, returns an HTML fragment. Touches no
  // filesystem and no library path, so it cannot widen the read surface.
  "render_markdown_fragment",
  // In-memory document store for the sandboxed HTML/mermaid iframes — writes
  // nothing to the library.
  "html_preview_register",
  "html_preview_unregister",
  // #586 — the DELIBERATE write surface: three library-root-confined
  // note-editing commands (sanitized rel paths, native name dedupe) plus the
  // pure-UI native name prompt. This is the intentional end of the
  // read-only posture; anything beyond these still fails the lock below.
  "ios_write_file",
  "ios_create_file",
  "ios_create_directory",
  "ios_rename_file",
  // #618 — swipe-delete: file-only (directories refused natively), backed by
  // iCloud's 30-day Recently Deleted recovery.
  "ios_delete_file",
  // Native QuickLook preview — reads a temp copy, writes nothing.
  "ios_quick_look",
  // System thumbnail generation — pure read, rendered by the OS.
  "ios_thumbnail",
  "ios_text_prompt",
]);

/** Commands that would mutate paths OUTSIDE the granted library, or reach
 *  AI — must never be invoked from the mobile shell. (The desktop
 *  absolute-path write commands are distinct from the ios_* rel-path ones
 *  allowed above.) */
const FORBIDDEN = [
  "ios_write_capture",
  "write_file",
  "delete_path",
  "create_file",
  "create_directory",
  "rename_path",
  "ai_chat_stream",
  "ai_chat",
];

beforeEach(() => {
  // jsdom elements have no scrollIntoView; the find debounce can fire after a
  // test finishes and an unhandled TypeError fails the whole run.
  Element.prototype.scrollIntoView = vi.fn();
  useMobileStore.getState().reset();
  invokeMock.mockClear();
  useMobileStore.setState({ grantState: "granted", libraryName: "Notesage" });
});

describe("mobile read-only browse → read flow", () => {
  it("lists the library and opens a markdown note rendered", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "Sub", path: "Sub", is_directory: true, hidden: false },
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_read_file", () => "---\ntitle: T\n---\n\n# Hello Mobile\n\nBody text.");
    // Markdown is rendered by the Rust (comrak) pipeline, the same one the
    // desktop preview uses — including stripping frontmatter. The mock stands
    // in for that command; the real stripping is covered in preview.rs.
    setMockInvokeHandler(
      "render_markdown_fragment",
      () => "<h1>Hello Mobile</h1>\n<p>Body text.</p>",
    );

    renderWithProviders(<Shell />);

    const fileRow = await screen.findByText("note.md");
    fireEvent.click(fileRow);

    // Reader renders the markdown heading (frontmatter stripped).
    expect(await screen.findByText("Hello Mobile")).toBeTruthy();
    // The raw frontmatter must not leak into the rendered view.
    expect(screen.queryByText(/title: T/)).toBeNull();
  });

  it("only invokes allowed read commands — never a write/AI command", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_read_file", () => "# Hi");
    setMockInvokeHandler("render_markdown_fragment", () => "<h1>Hi</h1>");

    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByText("note.md"));
    await screen.findByText("Hi");

    const cmds = calledCommands();
    expect(cmds.length).toBeGreaterThan(0);
    for (const cmd of cmds) {
      expect(ALLOWED.has(cmd)).toBe(true);
    }
    for (const forbidden of FORBIDDEN) {
      expect(cmds).not.toContain(forbidden);
    }
  });
});

describe("library browser states", () => {
  it("shows an empty state for an empty folder", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    renderWithProviders(<LibraryBrowser />);
    expect(await screen.findByText("Nothing here yet")).toBeTruthy();
  });

  it("shows an error state with retry when listing fails", async () => {
    setMockInvokeHandler("ios_list_directory", () => {
      throw new Error("boom");
    });
    renderWithProviders(<LibraryBrowser />);
    expect(await screen.findByText("Couldn't open this folder")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

interface CapturedChromeSpec {
  topCenter?: {
    title: string;
    subtitle?: string;
    menu?: Array<{ id: string; title: string; icon?: string }>;
  };
  topRight?: {
    id: string;
    icon: string;
    menuOnTap?: boolean;
    menu?: Array<{ id: string; title: string; selected?: boolean; sectionBreak?: boolean }>;
  };
}

describe("sort toggle (#632)", () => {
  it("toggles between alphabetical (folders first) and modified-newest, persisted", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "beta.md", path: "beta.md", is_directory: false, hidden: false, modified: 300 },
      { name: "Alpha", path: "Alpha", is_directory: true, hidden: false, modified: 100 },
      { name: "zulu.md", path: "zulu.md", is_directory: false, hidden: false, modified: 200 },
    ]);

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("beta.md");
    const rowNames = () =>
      screen.getAllByRole("button", { name: /Alpha|beta\.md|zulu\.md/ }).map((b) => b.textContent);

    // Alphabetical: folders first, then files A→Z.
    expect(rowNames()[0]).toContain("Alpha");
    expect(rowNames()[1]).toContain("beta.md");

    fireEvent.click(screen.getByRole("button", { name: "Sort by modified date" }));

    // Modified: newest first, folders and files interleaved (Files-app style).
    await waitFor(() => expect(rowNames()[0]).toContain("beta.md"));
    expect(rowNames()[1]).toContain("zulu.md");
    expect(rowNames()[2]).toContain("Alpha");
    // The choice persists in the store.
    expect(useMobileStore.getState().sortMode).toBe("modified");
  });

  it("declares the Files-style view-options menu: view section, then labeled sort picks", async () => {
    let captured: CapturedChromeSpec = {};
    setMockInvokeHandler("ios_set_chrome", (args) => {
      captured = (args as { spec: CapturedChromeSpec }).spec;
      return null;
    });
    setMockInvokeHandler("ios_list_directory", () => []);

    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(captured.topRight?.id).toBe("view-options"));
    // Ellipsis control hosting sections (Peter's Files-app design): view
    // mode on top, sort selection in its own section beneath.
    expect(captured.topRight?.icon).toBe("ellipsis");
    expect(captured.topRight?.menuOnTap).toBe(true);
    expect(captured.topRight?.menu?.map((m) => [m.title, m.selected])).toEqual([
      ["List", true],
      ["Gallery", false],
      ["Alphabetical", true],
      ["Date modified", false],
      // Group by section (#656), its own divider-led group beneath sort.
      ["Recent", false],
      ["None", true],
    ]);
    // The sort section starts with a divider.
    expect(captured.topRight?.menu?.[2]?.sectionBreak).toBe(true);
    // So does the Group by section.
    expect(captured.topRight?.menu?.[4]?.sectionBreak).toBe(true);

    useMobileStore.getState().setSortMode("modified");
    await waitFor(() =>
      expect(captured.topRight?.menu?.map((m) => m.selected)).toEqual([
        true, false, false, true, false, true,
      ]),
    );
  });
});

describe("breadcrumb island (#615)", () => {
  it("declares the current folder as topCenter with an ancestor jump menu (root first)", async () => {
    let captured: CapturedChromeSpec = {};
    setMockInvokeHandler("ios_set_chrome", (args) => {
      captured = (args as { spec: CapturedChromeSpec }).spec;
      return null;
    });
    setMockInvokeHandler("ios_list_directory", () => []);
    useMobileStore.setState({
      folderStack: [
        { relPath: "Projects", name: "Projects" },
        { relPath: "Projects/Deep", name: "Deep" },
      ],
    });

    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(captured.topCenter?.title).toBe("Deep"));
    // The island carries the PATH too — it replaces the in-content title +
    // breadcrumb row, which must not render while native chrome is active.
    expect(captured.topCenter?.subtitle).toBe("Notesage › Projects");
    expect(captured.topCenter?.menu?.map((m) => m.title)).toEqual(["Notesage", "Projects"]);
    expect(captured.topCenter?.menu?.[0]?.id).toBe("jump-0");
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Deep" })).toBeNull(),
    );
  });

  it("renders a passive breadcrumb (no menu) at the library root", async () => {
    let captured: CapturedChromeSpec = {};
    setMockInvokeHandler("ios_set_chrome", (args) => {
      captured = (args as { spec: CapturedChromeSpec }).spec;
      return null;
    });
    setMockInvokeHandler("ios_list_directory", () => []);

    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(captured.topCenter?.title).toBe("Notesage"));
    expect(captured.topCenter?.menu).toBeUndefined();
  });
});

describe("foreground refresh (#650)", () => {
  it("reloads the listing when the app returns to the foreground (post-share staleness)", async () => {
    let entries = [{ name: "old.md", path: "old.md", is_directory: false, hidden: false }];
    setMockInvokeHandler("ios_list_directory", () => entries);

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("old.md");

    // A share-extension save lands while backgrounded…
    entries = [
      ...entries,
      { name: "shared.png", path: "shared.png", is_directory: false, hidden: false },
    ];
    // …and the return to foreground fires visibilitychange.
    fireEvent(document, new Event("visibilitychange"));

    expect(await screen.findByText("shared.png")).toBeTruthy();
    // Refresh keeps the current listing visible — no skeleton flash.
    expect(screen.getByText("old.md")).toBeTruthy();
  });
});

describe("native QuickLook routing", () => {
  it("opens videos via ios_quick_look without navigating away from the browser", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "demo.mov", path: "demo.mov", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_quick_look", (args) => {
      expect((args as { relPath: string }).relPath).toBe("demo.mov");
      return null;
    });

    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByText("demo.mov"));

    await waitFor(() => expect(calledCommands()).toContain("ios_quick_look"));
    // No navigation: the browser stays put under the native preview.
    expect(useMobileStore.getState().openDoc).toBeNull();
  });

  it("falls back to the Reader when the native layer is absent", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "slides.pptx", path: "slides.pptx", is_directory: false, hidden: false },
    ]);
    // ios_quick_look deliberately unmocked — rejects like a build without
    // the native layer.
    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByText("slides.pptx"));

    await waitFor(() =>
      expect(useMobileStore.getState().openDoc?.relPath).toBe("slides.pptx"),
    );
  });
});

describe("swipe delete (#618)", () => {
  it("the Delete action removes the file and refreshes the listing", async () => {
    let entries = [
      { name: "doomed.md", path: "doomed.md", is_directory: false, hidden: false },
      { name: "keeper.md", path: "keeper.md", is_directory: false, hidden: false },
    ];
    setMockInvokeHandler("ios_list_directory", () => entries);
    setMockInvokeHandler("ios_delete_file", (args) => {
      expect((args as { relPath: string }).relPath).toBe("doomed.md");
      entries = entries.filter((e) => e.path !== "doomed.md");
      return null;
    });

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("doomed.md");
    // The action buttons exist behind the row (revealed by swipe on device;
    // clickable directly in jsdom, which has no real gesture).
    // The strip is aria-hidden until revealed — include hidden nodes; the
    // click path is identical to a post-swipe tap.
    const deleteButtons = screen.getAllByRole("button", { name: /Delete/, hidden: true });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => expect(calledCommands()).toContain("ios_delete_file"));
    await waitFor(() => expect(screen.queryByText("doomed.md")).toBeNull());
    expect(screen.getByText("keeper.md")).toBeTruthy();
  });

  it("directories expose no swipe actions (folder deletion stays off the surface)", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "Folder", path: "Folder", is_directory: true, hidden: false },
    ]);
    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("Folder");
    expect(screen.queryByRole("button", { name: /Delete/, hidden: true })).toBeNull();
    expect(screen.queryByRole("button", { name: /Share/, hidden: true })).toBeNull();
  });
});

describe("gallery view toggle (#633)", () => {
  it("starts in list layout and switches to the gallery grid on toggle, back on toggle again", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "Sub", path: "Sub", is_directory: true, hidden: false },
    ]);

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("Sub");
    expect(screen.queryByRole("list", { name: "Notes gallery" })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Switch to gallery view" }));
    expect(await screen.findByRole("list", { name: "Notes gallery" })).toBeTruthy();
    expect(useMobileStore.getState().viewMode).toBe("gallery");

    fireEvent.click(screen.getByRole("button", { name: "Switch to list view" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Notes gallery" })).toBeNull());
    expect(useMobileStore.getState().viewMode).toBe("list");
  });

  it("only invokes allowed read commands while browsing in gallery mode", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "Sub", path: "Sub", is_directory: true, hidden: false },
    ]);
    useMobileStore.getState().setViewMode("gallery");

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("Sub");

    for (const cmd of calledCommands()) {
      expect(ALLOWED.has(cmd)).toBe(true);
    }

  });
});

describe("create flow (#586)", () => {
  it("root '+' creates a folder (native prompt) and enters it — never offers New Note", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    setMockInvokeHandler("ios_text_prompt", () => "Ideas");
    setMockInvokeHandler("ios_create_directory", (args) => {
      expect((args as { relPath: string }).relPath).toBe("Ideas");
      return "Ideas";
    });

    renderWithProviders(<LibraryBrowser />);
    fireEvent.click(await screen.findByRole("button", { name: "New folder" }));

    // Creation ran and the browser entered the new folder.
    await waitFor(() => expect(calledCommands()).toContain("ios_create_directory"));
    await waitFor(() => {
      const stack = useMobileStore.getState().folderStack;
      expect(stack[stack.length - 1]?.relPath).toBe("Ideas");
    });
    // Root offers folder creation directly — no note option anywhere.
    expect(screen.queryByText("New Note")).toBeNull();
  });

  it("sub-folder '+' opens a pending editor with NO file yet; Save creates it under the title-derived name", async () => {
    useMobileStore.getState().enterFolder({ relPath: "Sub", name: "Sub" });
    setMockInvokeHandler("ios_list_directory", () => []);
    setMockInvokeHandler("ios_create_file", (args) => {
      const a = args as { relPath: string; content: string };
      // Created DIRECTLY under the title-derived name — no Untitled
      // intermediate on disk, ever.
      expect(a.relPath).toBe("Sub/Groceries.md");
      expect(a.content).toBe("# Groceries\n\n- milk");
      return "Sub/Groceries.md";
    });
    // The post-save reload reads the real file — mock it so no async work is
    // left unhandled at teardown (the CI-only unhandled-rejection failure).
    setMockInvokeHandler("ios_read_file", () => "# Groceries\n\n- milk");
    setMockInvokeHandler("render_markdown_fragment", () => "<h1>Groceries</h1>");

    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByRole("button", { name: "New note" }));

    // The editor opens on a pending note — nothing has touched the disk.
    const editor = await screen.findByRole("textbox", { name: "Note editor" });
    expect(calledCommands()).not.toContain("ios_create_file");
    expect(calledCommands()).not.toContain("ios_text_prompt");

    fireEvent.change(editor, { target: { value: "# Groceries\n\n- milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(useMobileStore.getState().openDoc?.relPath).toBe("Sub/Groceries.md"),
    );
    expect(useMobileStore.getState().openDoc?.isNew).toBeUndefined();
  });

  it("backing out of an untouched new note leaves NO file behind (accidental '+' tap)", async () => {
    useMobileStore.getState().enterFolder({ relPath: "Sub", name: "Sub" });
    setMockInvokeHandler("ios_list_directory", () => []);

    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByRole("button", { name: "New note" }));
    await screen.findByRole("textbox", { name: "Note editor" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => expect(useMobileStore.getState().openDoc).toBeNull());
    expect(calledCommands()).not.toContain("ios_create_file");
    expect(calledCommands()).not.toContain("ios_write_file");
  });

  it("long-pressing sub-folder '+' opens the New Folder menu instead of creating a note", async () => {
    useMobileStore.getState().enterFolder({ relPath: "Sub", name: "Sub" });
    setMockInvokeHandler("ios_list_directory", () => []);

    renderWithProviders(<LibraryBrowser />);
    const plus = await screen.findByRole("button", { name: "New note" });
    // Same real-timer hold pattern as the back button's ancestor-menu test:
    // the 450ms hold elapses naturally, waitFor picks up the menu.
    fireEvent.pointerDown(plus.parentElement!);
    await waitFor(
      () => expect(screen.getByRole("menuitem", { name: /New Folder/ })).toBeTruthy(),
      { timeout: 1500 },
    );
    expect(calledCommands()).not.toContain("ios_create_file");
  });

  it("cancelling the folder-name prompt creates nothing", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    setMockInvokeHandler("ios_text_prompt", () => null);

    renderWithProviders(<LibraryBrowser />);
    fireEvent.click(await screen.findByRole("button", { name: "New folder" }));

    await waitFor(() => expect(calledCommands()).toContain("ios_text_prompt"));
    expect(calledCommands()).not.toContain("ios_create_directory");
    expect(calledCommands()).not.toContain("ios_create_file");
  });
});

describe("edit flow (#586)", () => {
  it("an empty new note auto-enters edit mode; Save writes and renames to the doc title", async () => {
    useMobileStore.setState({ openDoc: { relPath: "Sub/Untitled.md", name: "Untitled.md" } });
    setMockInvokeHandler("ios_read_file", () => "");
    setMockInvokeHandler("render_markdown_fragment", () => "");
    setMockInvokeHandler("ios_write_file", (args) => {
      expect((args as { content: string }).content).toBe("# Shopping List\n\n- milk");
      return null;
    });
    setMockInvokeHandler("ios_rename_file", (args) => {
      const a = args as { relPath: string; newName: string };
      expect(a.relPath).toBe("Sub/Untitled.md");
      expect(a.newName).toBe("Shopping List.md");
      return "Sub/Shopping List.md";
    });

    renderWithProviders(<Reader />);
    // Empty note → straight into the editor, no tap needed.
    const editor = await screen.findByRole("textbox", { name: "Note editor" });
    fireEvent.change(editor, { target: { value: "# Shopping List\n\n- milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Saved, renamed, and re-opened under the title-derived name.
    await waitFor(() =>
      expect(useMobileStore.getState().openDoc?.relPath).toBe("Sub/Shopping List.md"),
    );
    expect(calledCommands()).toContain("ios_write_file");
  });

  it("editing an existing note whose title matches the filename saves without renaming", async () => {
    useMobileStore.setState({ openDoc: { relPath: "Sub/hello.md", name: "hello.md" } });
    setMockInvokeHandler("ios_read_file", () => "# hello\n\nworld");
    setMockInvokeHandler("render_markdown_fragment", () => "<h1>hello</h1><p>world</p>");
    setMockInvokeHandler("ios_write_file", () => null);

    renderWithProviders(<Reader />);
    await screen.findByText("hello");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = await screen.findByRole("textbox", { name: "Note editor" });
    // The raw source (not the rendered HTML) is what's edited.
    expect((editor as HTMLTextAreaElement).value).toBe("# hello\n\nworld");
    fireEvent.change(editor, { target: { value: "# hello\n\nworld — edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calledCommands()).toContain("ios_write_file"));
    expect(calledCommands()).not.toContain("ios_rename_file");
    // Back to the rendered view after save.
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Note editor" })).toBeNull());
  });

  it("backing out of an edit saves the draft first (Notes semantics)", async () => {
    useMobileStore.setState({ openDoc: { relPath: "Sub/hello.md", name: "hello.md" } });
    setMockInvokeHandler("ios_read_file", () => "# hello");
    setMockInvokeHandler("render_markdown_fragment", () => "<h1>hello</h1>");
    let written: string | null = null;
    setMockInvokeHandler("ios_write_file", (args) => {
      written = (args as { content: string }).content;
      return null;
    });

    renderWithProviders(<Reader />);
    await screen.findByText("hello");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = await screen.findByRole("textbox", { name: "Note editor" });
    fireEvent.change(editor, { target: { value: "# hello\n\nqueued thought" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => expect(written).toBe("# hello\n\nqueued thought"));
    await waitFor(() => expect(useMobileStore.getState().openDoc).toBeNull());
  });
});

describe("library browser load-generation guard (rapid navigation races)", () => {
  it("drops a stale folder listing when folder navigation and a document open race an in-flight load", async () => {
    // Deferred resolvers keyed by relPath so the test controls resolution
    // order independently of call order — the exact shape of a race.
    const deferred: Record<string, (entries: unknown[]) => void> = {};
    setMockInvokeHandler("ios_list_directory", (args) => {
      const relPath = (args as { relPath: string }).relPath;
      return new Promise((resolve) => {
        deferred[relPath] = resolve;
      });
    });

    renderWithProviders(<LibraryBrowser />);
    // Root listing kicks off on mount and is left in flight.
    await waitFor(() => expect(deferred[""]).toBeDefined());

    // Rapid navigation: enter a folder (supersedes the in-flight root load)
    // AND open a document in the same window — interleaving folder and
    // document navigation the way a fast double-tap would.
    useMobileStore.getState().enterFolder({ relPath: "Sub", name: "Sub" });
    useMobileStore.getState().openDocument({ relPath: "Sub/note.md", name: "note.md" });
    await waitFor(() => expect(deferred["Sub"]).toBeDefined());

    // Resolve the CURRENT folder's listing first...
    deferred["Sub"]([{ name: "leaf.md", path: "Sub/leaf.md", is_directory: false, hidden: false }]);
    expect(await screen.findByText("leaf.md")).toBeTruthy();

    // ...then resolve the SUPERSEDED root listing out of order. A load
    // without the generation guard would clobber the correct view with this
    // stale data.
    deferred[""]([{ name: "root-file.md", path: "root-file.md", is_directory: false, hidden: false }]);
    await new Promise((r) => setTimeout(r, 10));

    expect(screen.queryByText("root-file.md")).toBeNull();
    expect(screen.getByText("leaf.md")).toBeTruthy();
  });
});

describe("reader states", () => {
  it("routes PDFs to the PDF viewer (reads bytes, not the unsupported state)", async () => {
    useMobileStore.setState({ openDoc: { relPath: "doc.pdf", name: "doc.pdf" } });
    // The wire format is a raw IPC response — an ArrayBuffer, no JSON
    // (see iosReadBinary).
    setMockInvokeHandler("ios_read_binary", () => new TextEncoder().encode("%PDF-1.4").buffer);
    renderWithProviders(<Reader />);
    expect(await screen.findByText("pdf-viewer:doc.pdf")).toBeTruthy();
    expect(calledCommands()).toContain("ios_read_binary");
    // It must NOT fall back to the unsupported message for PDF.
    expect(screen.queryByText("Can't preview this format yet")).toBeNull();
  });

  it("shows an unsupported state for other binary formats (DOCX)", async () => {
    useMobileStore.setState({ openDoc: { relPath: "doc.docx", name: "doc.docx" } });
    renderWithProviders(<Reader />);
    expect(await screen.findByText("Can't preview this format yet")).toBeTruthy();
  });

  it("offers an iCloud download when the file isn't local yet", async () => {
    useMobileStore.setState({ openDoc: { relPath: "note.md", name: "note.md" } });
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not downloaded");
    });
    setMockInvokeHandler("ios_ensure_downloaded", () => "downloading");
    renderWithProviders(<Reader />);
    expect(await screen.findByText("Downloading from iCloud")).toBeTruthy();
  });
});

describe("large file guard (issue #616)", () => {
  it("declines an oversized text file gracefully instead of reading it", async () => {
    // Regression lock for the actual repro: a multi-hundred-MB Apple Health
    // export.xml read via ios_read_file crosses IPC as one JSON string,
    // blocking the WebView main thread and wedging the whole app. The
    // reader must stat the file first and never call ios_read_file at all
    // once the probe says the file is oversized.
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "export.xml", path: "export.xml", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_stat_file", () => ({ sizeBytes: 200 * 1024 * 1024 }));
    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByText("export.xml"));

    expect(await screen.findByText("Too large to open")).toBeTruthy();
    expect(calledCommands()).not.toContain("ios_read_file");
  });

  it("offers the native share sheet from the decline card", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "export.xml", path: "export.xml", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_stat_file", () => ({ sizeBytes: 200 * 1024 * 1024 }));
    setMockInvokeHandler("ios_share_file", () => undefined);
    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByText("export.xml"));
    await screen.findByText("Too large to open");

    fireEvent.click(screen.getByRole("button", { name: "Share instead" }));
    await waitFor(() => expect(calledCommands()).toContain("ios_share_file"));
  });

  it("opens a file under the threshold normally, after a fast stat probe", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_stat_file", () => ({ sizeBytes: 1024 }));
    setMockInvokeHandler("ios_read_file", () => "# Small note");
    setMockInvokeHandler("render_markdown_fragment", () => "<h1>Small note</h1>");
    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByText("note.md"));

    expect(await screen.findByText("Small note")).toBeTruthy();
    expect(calledCommands()).toContain("ios_stat_file");
  });

  it("fails open and reads normally when the size probe is unavailable (older native build)", async () => {
    // ios_stat_file deliberately left unmocked — invoke rejects with "No
    // handler registered". A missing/failing probe must never regress an
    // ordinary read that used to work before this guard existed.
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_read_file", () => "# Fallback note");
    setMockInvokeHandler("render_markdown_fragment", () => "<h1>Fallback note</h1>");
    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByText("note.md"));

    expect(await screen.findByText("Fallback note")).toBeTruthy();
  });

  it("backing out while the size probe is in flight cancels the load instead of applying a stale decline state", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "export.xml", path: "export.xml", is_directory: false, hidden: false },
    ]);
    let resolveStat: ((v: { sizeBytes: number }) => void) | null = null;
    setMockInvokeHandler(
      "ios_stat_file",
      () => new Promise((res) => { resolveStat = res; }),
    );
    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByText("export.xml"));
    await waitFor(() => expect(resolveStat).not.toBeNull());

    // Back out before the stat probe resolves — the same generation-guard
    // idiom the loader already uses for folder-navigation races.
    useMobileStore.getState().goBack();
    expect(await screen.findByText("export.xml")).toBeTruthy(); // back in the folder listing

    // The superseded probe resolves late with an oversized result.
    resolveStat!({ sizeBytes: 900 * 1024 * 1024 });
    await new Promise((r) => setTimeout(r, 10));

    // Must not apply the decline state for a document that's no longer open.
    expect(screen.queryByText("Too large to open")).toBeNull();
  });
});

describe("onboarding", () => {
  it("grants access via the folder picker", async () => {
    useMobileStore.setState({ grantState: "ungranted" });
    setMockInvokeHandler("ios_pick_library_folder", () => ({ displayName: "Notesage", granted: true }));

    renderWithProviders(<Onboarding />);
    // The button is named for what the user does — pick a folder. The
    // permission story is told by the cards above it, not the control.
    fireEvent.click(screen.getByRole("button", { name: "Select your Notesage folder" }));

    await waitFor(() => expect(useMobileStore.getState().grantState).toBe("granted"));
    expect(calledCommands()).toContain("ios_pick_library_folder");
  });

  it("reports a dismissed picker instead of silently doing nothing", async () => {
    // Regression lock. A cancelled pick used to resolve with granted:false and
    // fall through an `if` with no else — so it looked exactly like a dead
    // button. That ambiguity cost real debugging time when the bridge was
    // genuinely broken: there was no way to tell the two apart.
    useMobileStore.setState({ grantState: "ungranted" });
    setMockInvokeHandler("ios_pick_library_folder", () => ({ displayName: "", granted: false }));

    renderWithProviders(<Onboarding />);
    fireEvent.click(screen.getByRole("button", { name: "Select your Notesage folder" }));

    await waitFor(() => expect(calledCommands()).toContain("ios_pick_library_folder"));
    // Still ungranted, and the user was told why rather than left guessing.
    expect(useMobileStore.getState().grantState).toBe("ungranted");
    // The Toaster portal isn't mounted in this harness, so assert the call.
    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        expect.stringMatching(/No folder selected/i),
      ),
    );
  });
});

describe("HTML reports", () => {
  const registered: Array<{ id: string; content: string }> = [];
  const openHtml = async (fileName = "report.html") => {
    registered.length = 0;
    setMockInvokeHandler("ios_list_directory", () => [
      { name: fileName, path: fileName, is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler(
      "ios_read_file",
      () => "<html><body><h1>Q3</h1><script>renderCharts()</script></body></html>",
    );
    setMockInvokeHandler("html_preview_register", (args) => {
      registered.push(args as { id: string; content: string });
    });
    setMockInvokeHandler("html_preview_unregister", () => {});
    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByText(fileName));
    return await screen.findByTitle(fileName);
  };

  it("renders an exported report instead of showing its markup as text", async () => {
    // The gap this closes: iOS Files shows a .html report as source with
    // scripts disabled, so a report with inline charts is unreadable on phone.
    const frame = await openHtml();
    expect(frame.tagName).toBe("IFRAME");
    expect(screen.queryByText(/<script>/)).toBeNull();
  });

  it("lets the report's own scripts run", async () => {
    const frame = await openHtml();
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
  });

  it("injects the find agent so search works inside the sandboxed frame", async () => {
    // The app cannot reach a cross-origin frame's DOM — the injected agent is
    // the ONLY way find-in-document can work for HTML reports.
    await openHtml();
    expect(registered.length).toBe(1);
    expect(registered[0].content).toContain("notesage-find");
    // The report's own markup still leads the document.
    expect(registered[0].content.startsWith("<html>")).toBe(true);
  });

  it("shows a search island for HTML reports and drives the agent over postMessage", async () => {
    const frame = await openHtml();
    const posted: unknown[] = [];
    const frameWindow = { postMessage: (msg: unknown) => posted.push(msg) };
    Object.defineProperty(frame, "contentWindow", { value: frameWindow });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Q3" } });
    await waitFor(() => {
      expect(posted).toContainEqual({ ns: "notesage-find", type: "query", q: "Q3" });
    });
    // The agent's state replies drive the match counter.
    // Replies are shape-checked (no e.source identity check — WKWebView
    // does not preserve source identity for opaque-origin frames).
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { ns: "notesage-find", type: "state", total: 4, current: 0 },
        source: frameWindow as unknown as Window,
      }),
    );
    expect(await screen.findByText("1/4")).toBeTruthy();
  });

  it("keeps the report on an opaque origin so it cannot reach the app", async () => {
    // `allow-scripts` WITHOUT `allow-same-origin` is the whole security
    // posture here: the report executes, but has no access to this app's DOM,
    // storage, or the Tauri IPC bridge. Granting same-origin alongside
    // allow-scripts would let a document remove its own sandbox entirely.
    const frame = await openHtml();
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("serves the document from the htmlpreview:// scheme, not srcdoc/blob/data", async () => {
    // srcDoc, blob: AND data: documents all inherit the host window's CSP, and
    // in the embedded build Tauri's nonce injection neutralises
    // 'unsafe-inline' — the report renders unstyled with its scripts refused
    // (dev builds hide this: Vite serves the app with no CSP). Only a
    // custom-scheme response carries its own empty policy. Same mechanism and
    // reasoning as the desktop HtmlViewer (commands/html_preview.rs).
    const frame = await openHtml();
    expect(frame.getAttribute("srcdoc")).toBeNull();
    const src = frame.getAttribute("src") ?? "";
    expect(src).toMatch(/^htmlpreview:\/\/localhost\//);
    // The document itself was registered with the backend before the iframe
    // pointed at it.
    expect(registered).toHaveLength(1);
    expect(registered[0].content).toContain("renderCharts()");
    expect(src.endsWith(registered[0].id)).toBe(true);
  });

  it("treats .htm the same as .html", async () => {
    const frame = await openHtml("legacy.htm");
    expect(frame.tagName).toBe("IFRAME");
  });
});

describe("folder picker cancellation", () => {
  it("shows the friendly no-folder message when the picker resolves ungranted", async () => {
    setMockInvokeHandler("ios_pick_library_folder", () => ({ displayName: "", granted: false }));
    useMobileStore.setState({ grantState: "ungranted" });
    renderWithProviders(<Onboarding />);
    fireEvent.click(screen.getByRole("button", { name: "Select your Notesage folder" }));
    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/No folder selected/i)),
    );
  });

  it("survives a REJECTED picker invoke without leaving the user stuck", async () => {
    // The native layer resolves granted:false on a routine cancel, but a real
    // failure (picker unavailable, bookmark write error) still rejects. That
    // path must surface an error toast and return to a re-tappable button —
    // the original bug was a raw NSError string here, and the old test suite
    // never exercised a rejection at all.
    setMockInvokeHandler("ios_pick_library_folder", () => {
      throw new Error("bookmark write failed");
    });
    useMobileStore.setState({ grantState: "ungranted" });
    renderWithProviders(<Onboarding />);
    fireEvent.click(screen.getByRole("button", { name: "Select your Notesage folder" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(useMobileStore.getState().grantState).toBe("ungranted");
    // The button is still there for another attempt.
    expect(screen.getByRole("button", { name: "Select your Notesage folder" })).toBeTruthy();
  });
});

describe("hidden entries", () => {
  it("never renders dotfiles or dot-directories, even if the native layer returns them", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: ".notesage", path: ".notesage", is_directory: true, hidden: true },
      { name: ".git", path: ".git", is_directory: true, hidden: true },
      { name: ".secret.md", path: ".secret.md", is_directory: false, hidden: true },
      { name: "visible.md", path: "visible.md", is_directory: false, hidden: false },
    ]);
    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("visible.md");
    expect(screen.queryByText(".notesage")).toBeNull();
    expect(screen.queryByText(".git")).toBeNull();
    expect(screen.queryByText(".secret.md")).toBeNull();
  });
});

describe("links in rendered markdown", () => {
  const openNote = async (html: string) => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "note.md", path: "docs/note.md", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_read_file", () => "irrelevant");
    setMockInvokeHandler("render_markdown_fragment", () => html);
    useMobileStore.setState({ openDoc: { relPath: "docs/note.md", name: "note.md" } });
    renderWithProviders(<Reader />);
    await screen.findByText(/link/);
  };

  it("opens external links in the system browser, never in the app frame", async () => {
    await openNote('<p><a href="https://example.com/x">ext link</a></p>');
    fireEvent.click(screen.getByText("ext link"));
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith("https://example.com/x"));
  });

  it("navigates relative note links inside the library", async () => {
    await openNote('<p><a href="../other/target.md">rel link</a></p>');
    fireEvent.click(screen.getByText("rel link"));
    await waitFor(() =>
      expect(useMobileStore.getState().openDoc).toEqual({
        relPath: "other/target.md",
        name: "target.md",
      }),
    );
  });

  it("refuses links that escape the library root", async () => {
    await openNote('<p><a href="../../../etc/passwd">bad link</a></p>');
    fireEvent.click(screen.getByText("bad link"));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(useMobileStore.getState().openDoc?.relPath).toBe("docs/note.md");
  });
});

describe("theme changes", () => {
  it("does NOT re-read a PDF when the theme flips (only markdown re-renders)", async () => {
    useMobileStore.setState({ openDoc: { relPath: "doc.pdf", name: "doc.pdf" } });
    setMockInvokeHandler("ios_read_binary", () => new TextEncoder().encode("%PDF-1.4").buffer);
    renderWithProviders(<Reader />);
    await screen.findByText("pdf-viewer:doc.pdf");
    const readsBefore = calledCommands().filter((c) => c === "ios_read_binary").length;

    // Flip the theme class the way ThemeProvider does.
    document.documentElement.classList.add("dark");
    await waitFor(() => {
      // Give the observer a tick; the assertion below is the real check.
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    await new Promise((r) => setTimeout(r, 50));
    const readsAfter = calledCommands().filter((c) => c === "ios_read_binary").length;
    expect(readsAfter).toBe(readsBefore);
    document.documentElement.classList.remove("dark");
  });
});

describe("mermaid preview lifecycle", () => {
  it("unregisters already-registered diagrams when unmounted mid-render", async () => {
    // Regression lock for a real leak: cleanup ids were only collected after
    // the whole render loop finished, so backing out while diagram 2 was
    // still rendering orphaned diagram 1's document in the htmlpreview store
    // (which has no eviction). Ids must be released as soon as they register.
    const resolvers: Array<(v: { svg: string }) => void> = [];
    vi.doMock("mermaid", () => ({
      default: {
        initialize: vi.fn(),
        render: () => new Promise<{ svg: string }>((res) => resolvers.push(res)),
      },
    }));
    const registered: string[] = [];
    const unregistered: string[] = [];
    setMockInvokeHandler("html_preview_register", (args) => {
      registered.push((args as { id: string }).id);
    });
    setMockInvokeHandler("html_preview_unregister", (args) => {
      unregistered.push((args as { id: string }).id);
    });
    setMockInvokeHandler("ios_read_file", () => "irrelevant");
    setMockInvokeHandler(
      "render_markdown_fragment",
      () =>
        '<pre><code class="language-mermaid">a-->b</code></pre>' +
        '<pre><code class="language-mermaid">c-->d</code></pre>',
    );
    useMobileStore.setState({ openDoc: { relPath: "diagrams.md", name: "diagrams.md" } });
    const { unmount } = renderWithProviders(<Reader />);

    // Let diagram 1 render + register; diagram 2 stays pending.
    await waitFor(() => expect(resolvers.length).toBeGreaterThanOrEqual(1));
    resolvers[0]({ svg: '<svg viewBox="0 0 10 10"></svg>' });
    await waitFor(() => expect(registered.length).toBe(1));

    unmount();
    await waitFor(() => expect(unregistered).toContain(registered[0]));
    vi.doUnmock("mermaid");
  });
});

describe("search islands", () => {
  it("filters the folder listing as the user types", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "alpha.md", path: "alpha.md", is_directory: false, hidden: false },
      { name: "beta.md", path: "beta.md", is_directory: false, hidden: false },
    ]);
    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("alpha.md");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "bet" } });
    await waitFor(() => expect(screen.queryByText("alpha.md")).toBeNull());
    expect(screen.getByText("beta.md")).toBeTruthy();
    // Closing the search restores the full listing.
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(await screen.findByText("alpha.md")).toBeTruthy();
  });

  it("finds and highlights matches in an open note", async () => {
    setMockInvokeHandler("ios_read_file", () => "irrelevant");
    setMockInvokeHandler(
      "render_markdown_fragment",
      () => "<p>the word needle appears here, and needle again</p>",
    );
    useMobileStore.setState({ openDoc: { relPath: "note.md", name: "note.md" } });
    renderWithProviders(<Reader />);
    await screen.findByText(/needle appears/);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
    await waitFor(() => {
      expect(document.querySelectorAll("mark.dom-find-highlight").length).toBe(2);
    });
    // Navigation between matches is offered.
    expect(await screen.findByText("1/2")).toBeTruthy();
  });

  it("navigating between matches does not silently reset the article and wipe find marks (issue #605 root cause)", async () => {
    setMockInvokeHandler("ios_read_file", () => "irrelevant");
    setMockInvokeHandler(
      "render_markdown_fragment",
      () => "<p>needle one, needle two, needle three</p>",
    );
    useMobileStore.setState({ openDoc: { relPath: "note.md", name: "note.md" } });
    renderWithProviders(<Reader />);
    await screen.findByText(/needle one/);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
    await waitFor(() => {
      expect(document.querySelectorAll("mark.dom-find-highlight").length).toBe(3);
    });

    // Advancing to the next match updates findIndex/findTotal — state that
    // has nothing to do with the rendered HTML string. That re-render must
    // not silently reset the article's innerHTML and wipe every mark it
    // just painted (React diffs dangerouslySetInnerHTML by object identity,
    // not by the __html string's value, so an unmemoized `{ __html }`
    // object resets the DOM on every unrelated re-render).
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));

    expect(document.querySelectorAll("mark.dom-find-highlight").length).toBe(3);
    expect(await screen.findByText("2/3")).toBeTruthy();
  });

  it("watchdog heals when only some marks are silently detached, not just the first (issue #605)", async () => {
    setMockInvokeHandler("ios_read_file", () => "irrelevant");
    setMockInvokeHandler(
      "render_markdown_fragment",
      () => "<p>needle one, needle two, needle three</p>",
    );
    useMobileStore.setState({ openDoc: { relPath: "note.md", name: "note.md" } });
    renderWithProviders(<Reader />);
    await screen.findByText(/needle one/);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
    await waitFor(() => {
      expect(document.querySelectorAll("mark.dom-find-highlight").length).toBe(3);
    });

    // Simulate a hypothetical external actor (outside React entirely — the
    // watchdog's remaining reason to exist) silently unwrapping only the
    // second and third marks back to plain text. The first mark stays
    // connected, so a watchdog that only checks marks[0] would never notice.
    const marks = Array.from(document.querySelectorAll("mark.dom-find-highlight"));
    for (const mark of marks.slice(1)) {
      mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
    }
    expect(document.querySelectorAll("mark.dom-find-highlight").length).toBe(1);

    // The watchdog's next tick must notice the partial breakage and re-wrap
    // every match — not leave the lone survivor as the new normal.
    await waitFor(
      () => expect(document.querySelectorAll("mark.dom-find-highlight").length).toBe(3),
      { timeout: 2000 },
    );
  });

  it("goToMatch heals partially-detached marks before navigating (issue #605)", async () => {
    setMockInvokeHandler("ios_read_file", () => "irrelevant");
    setMockInvokeHandler(
      "render_markdown_fragment",
      () => "<p>needle one, needle two, needle three</p>",
    );
    useMobileStore.setState({ openDoc: { relPath: "note.md", name: "note.md" } });
    renderWithProviders(<Reader />);
    await screen.findByText(/needle one/);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
    await waitFor(() => {
      expect(document.querySelectorAll("mark.dom-find-highlight").length).toBe(3);
    });

    const marks = Array.from(document.querySelectorAll("mark.dom-find-highlight"));
    for (const mark of marks.slice(1)) {
      mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
    }
    expect(document.querySelectorAll("mark.dom-find-highlight").length).toBe(1);

    // Navigate immediately, before the 500ms watchdog tick has a chance to
    // fire — goToMatch's own heal path must catch the partial breakage too.
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));

    expect(document.querySelectorAll("mark.dom-find-highlight").length).toBe(3);
  });
});

describe("share", () => {
  it("shares the open document via the native share sheet", async () => {
    setMockInvokeHandler("ios_read_file", () => "hello");
    setMockInvokeHandler("render_markdown_fragment", () => "<p>hello</p>");
    const shared: string[] = [];
    setMockInvokeHandler("ios_share_file", (args) => {
      shared.push((args as { relPath: string }).relPath);
    });
    useMobileStore.setState({ openDoc: { relPath: "notes/today.md", name: "today.md" } });
    renderWithProviders(<Reader />);
    await screen.findByText("hello");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(shared).toEqual(["notes/today.md"]));
  });

  it("surfaces a share failure as a toast instead of failing silently", async () => {
    setMockInvokeHandler("ios_read_file", () => "hello");
    setMockInvokeHandler("render_markdown_fragment", () => "<p>hello</p>");
    setMockInvokeHandler("ios_share_file", () => {
      throw new Error("A share sheet is already open");
    });
    useMobileStore.setState({ openDoc: { relPath: "notes/today.md", name: "today.md" } });
    renderWithProviders(<Reader />);
    await screen.findByText("hello");
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Couldn't share/)),
    );
  });
});

describe("folder view row swipe actions (issue #618)", () => {
  it("hides the Share action on a file row until it is swiped", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
    ]);
    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("note.md");
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("reveals a Share action when a file row is swiped left", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
    ]);
    renderWithProviders(<LibraryBrowser />);
    const row = await screen.findByRole("button", { name: "note.md" });
    fireEvent.pointerDown(row, { clientX: 200 });
    fireEvent.pointerMove(row, { clientX: 100 });
    fireEvent.pointerUp(row, { clientX: 100 });
    expect(await screen.findByRole("button", { name: "Share" })).toBeTruthy();
  });

  it("invokes ios_share_file with the row's relPath when the revealed Share action is tapped", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "today.md", path: "notes/today.md", is_directory: false, hidden: false },
    ]);
    const shared: string[] = [];
    setMockInvokeHandler("ios_share_file", (args) => {
      shared.push((args as { relPath: string }).relPath);
    });
    renderWithProviders(<LibraryBrowser />);
    const row = await screen.findByRole("button", { name: "today.md" });
    fireEvent.pointerDown(row, { clientX: 200 });
    fireEvent.pointerMove(row, { clientX: 100 });
    fireEvent.pointerUp(row, { clientX: 100 });
    fireEvent.click(await screen.findByRole("button", { name: "Share" }));
    await waitFor(() => expect(shared).toEqual(["notes/today.md"]));
  });

  it("a plain tap (no swipe) on a file row still opens the document — functional parity", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_read_file", () => "# Hi");
    setMockInvokeHandler("render_markdown_fragment", () => "<h1>Hi</h1>");
    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByRole("button", { name: "note.md" }));
    expect(await screen.findByText("Hi")).toBeTruthy();
  });

  it("does not reveal a Share action when a directory row is swiped", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "Sub", path: "Sub", is_directory: true, hidden: false },
    ]);
    renderWithProviders(<LibraryBrowser />);
    const row = await screen.findByRole("button", { name: /Sub/ });
    fireEvent.pointerDown(row, { clientX: 200 });
    fireEvent.pointerMove(row, { clientX: 100 });
    fireEvent.pointerUp(row, { clientX: 100 });
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });
});

describe("App Review safety — local-folder demo path (issue #594)", () => {
  it("onboarding tells the user a local on-device folder works too, not just iCloud", async () => {
    // A reviewer with no iCloud account must be able to tell, from the copy
    // alone, that granting a local "On My iPhone" folder is a supported path
    // — not a workaround they have to guess at. Prevents a Guideline
    // 2.1-style "I can't test this without your iCloud account" rejection.
    useMobileStore.setState({ grantState: "ungranted" });
    renderWithProviders(<Onboarding />);
    expect(
      screen.getAllByText(/on my iphone|on this device|without icloud|local folder|any folder/i)
        .length,
    ).toBeGreaterThan(0);
  });

  it("cancelling from onboarding leaves the button re-tappable, not stuck busy", async () => {
    useMobileStore.setState({ grantState: "ungranted" });
    setMockInvokeHandler("ios_pick_library_folder", () => ({ displayName: "", granted: false }));
    renderWithProviders(<Onboarding />);
    fireEvent.click(screen.getByRole("button", { name: "Select your Notesage folder" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    // A reviewer who backs out of the picker must land on a re-tappable
    // control, not a control frozen on "Opening…".
    expect(screen.getByRole("button", { name: "Select your Notesage folder" })).toBeTruthy();
    expect(screen.queryByText("Opening…")).toBeNull();
  });

  it("an empty library folder renders a real empty state, not placeholder content", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    renderWithProviders(<LibraryBrowser />);
    expect(await screen.findByText("Nothing here yet")).toBeTruthy();
    expect(screen.queryByText(/lorem ipsum/i)).toBeNull();
  });
});

describe("long-press ancestor menu (web fallback)", () => {
  it("holding Back opens the folder-hierarchy jump menu (Files pattern)", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    useMobileStore.setState({
      libraryName: "Notesage",
      folderStack: [
        { relPath: "Investeringar", name: "Investeringar" },
        { relPath: "Investeringar/reports", name: "reports" },
      ],
    });
    renderWithProviders(<LibraryBrowser />);
    const back = await screen.findByRole("button", { name: "Back" });
    fireEvent.pointerDown(back.parentElement!);
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy(), { timeout: 1500 });
    // Ancestors only — the current folder is where we already are.
    expect(screen.getByRole("menuitem", { name: "Notesage" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Investeringar" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "reports" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Notesage" }));
    expect(useMobileStore.getState().folderStack).toEqual([]);
  });
});

describe("native pull-to-refresh (issue #620)", () => {
  it("does not render a topRight refresh island / RefreshCw button — replaced by native pull-to-refresh", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("Nothing here yet");
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  it("reloads the listing when the native pull-to-refresh bridge event fires (mirrors WKWebView's UIRefreshControl dispatching notesage:chrome)", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("Nothing here yet");
    const callsBefore = calledCommands().filter((c) => c === "ios_list_directory").length;

    // The native UIRefreshControl dispatches this exact event shape on pull —
    // the same bridge tap events already use — so the browser doesn't need to
    // know whether "refresh" came from a gesture or a (removed) button.
    fireEvent(window, new CustomEvent("notesage:chrome", { detail: { id: "refresh" } }));

    await waitFor(() => {
      const callsAfter = calledCommands().filter((c) => c === "ios_list_directory").length;
      expect(callsAfter).toBe(callsBefore + 1);
    });
  });

  it("never renders a spinning icon — the dead refreshing state / animate-spin styling was removed with the button", async () => {
    let resolveList: ((entries: unknown[]) => void) | null = null;
    setMockInvokeHandler("ios_list_directory", () => {
      return new Promise((resolve) => {
        resolveList = resolve;
      });
    });

    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(resolveList).not.toBeNull());
    resolveList!([]);
    await screen.findByText("Nothing here yet");

    // Fire a refresh the same way the native pull gesture would, and hold the
    // reload pending — if a `refreshing`-driven spinner still existed
    // anywhere, this is the deterministic moment it would render.
    resolveList = null;
    fireEvent(window, new CustomEvent("notesage:chrome", { detail: { id: "refresh" } }));
    await waitFor(() => expect(resolveList).not.toBeNull());

    expect(document.querySelector(".animate-spin")).toBeNull();
    resolveList!([]);
  });
});

describe("accessibility — Dynamic Type + Bold Text (issue #617)", () => {
  const dispatchA11y = (detail: { scale: number; bold: boolean }) => {
    fireEvent(window, new CustomEvent("notesage:a11y", { detail }));
  };

  it("reflects a Dynamic Type scale change on the library browser root", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
    ]);
    const { container } = renderWithProviders(<LibraryBrowser />);
    await screen.findByText("note.md");

    dispatchA11y({ scale: 1.3, bold: false });

    const root = container.querySelector("[data-a11y-scale]");
    expect(root?.getAttribute("data-a11y-scale")).toBe("1.3");
  });

  it("reflects the Bold Text setting on the library browser root", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    const { container } = renderWithProviders(<LibraryBrowser />);
    await screen.findByText("Nothing here yet");

    dispatchA11y({ scale: 1, bold: true });

    const root = container.querySelector("[data-a11y-scale]");
    expect(root?.getAttribute("data-a11y-bold")).toBe("true");
  });

  it("wires the folder title to scale via the a11y CSS variable", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    renderWithProviders(<LibraryBrowser />);
    const title = await screen.findByText("Notesage");
    expect(title.className).toContain("--ns-a11y-scale");
  });

  it("wires a file row's name to scale and weight via the a11y CSS variables", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
    ]);
    renderWithProviders(<LibraryBrowser />);
    const row = await screen.findByText("note.md");
    expect(row.className).toContain("--ns-a11y-scale");
    expect(row.style.fontWeight).toContain("--ns-a11y-weight");
  });

  it("wires the breadcrumb nav to scale and weight via the a11y CSS variables", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    useMobileStore.setState({
      libraryName: "Notesage",
      folderStack: [{ relPath: "Sub", name: "Sub" }],
    });
    renderWithProviders(<LibraryBrowser />);
    const crumb = await screen.findByRole("button", { name: "Sub" });
    const nav = crumb.closest("nav");
    expect(nav?.className).toContain("--ns-a11y-scale");
    expect((nav as HTMLElement)?.style.fontWeight).toContain("--ns-a11y-weight");
  });

  it("wires the empty-folder heading and body text to scale and weight via the a11y CSS variables", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    renderWithProviders(<LibraryBrowser />);
    const heading = await screen.findByText("Nothing here yet");
    const body = screen.getByText("This folder is empty.");
    expect(heading.className).toContain("--ns-a11y-scale");
    expect(heading.style.fontWeight).toContain("--ns-a11y-weight");
    expect(body.className).toContain("--ns-a11y-scale");
    expect(body.style.fontWeight).toContain("--ns-a11y-weight");
  });

  it("wires the browser-error heading and message text to scale and weight via the a11y CSS variables", async () => {
    setMockInvokeHandler("ios_list_directory", () => {
      throw new Error("boom");
    });
    renderWithProviders(<LibraryBrowser />);
    const heading = await screen.findByText("Couldn't open this folder");
    const message = screen.getByText("Error: boom");
    expect(heading.className).toContain("--ns-a11y-scale");
    expect(heading.style.fontWeight).toContain("--ns-a11y-weight");
    expect(message.className).toContain("--ns-a11y-scale");
    expect(message.style.fontWeight).toContain("--ns-a11y-weight");
  });

  it("wires the search zero-results message to scale and weight via the a11y CSS variables", async () => {
    // Gap #626's aw-review found: the zero-results message ("Nothing
    // matches ...") is a third empty-state alongside EmptyFolder/BrowserError
    // that was never wired up.
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
    ]);
    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("note.md");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    const message = await screen.findByText('Nothing matches "zzz"');
    expect(message.className).toContain("--ns-a11y-scale");
    expect(message.style.fontWeight).toContain("--ns-a11y-weight");
  });

  it("wires the ancestor-jump menu items to scale and weight via their own a11y CSS scope (portaled content)", async () => {
    // Gap #626's aw-review found: the long-press "jump to folder" menu is
    // portaled to document.body, outside the a11y-scoped root's DOM subtree
    // — CSS custom properties follow the DOM tree, not the React tree, so it
    // needs its own scope applied to the portaled container, the same way
    // Chrome.tsx's Island does for SearchIsland/status content.
    setMockInvokeHandler("ios_list_directory", () => []);
    useMobileStore.setState({
      libraryName: "Notesage",
      folderStack: [{ relPath: "Sub", name: "Sub" }],
    });
    renderWithProviders(<LibraryBrowser />);
    const back = await screen.findByRole("button", { name: "Back" });
    fireEvent.pointerDown(back.parentElement!);
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy(), { timeout: 1500 });
    const item = screen.getByRole("menuitem", { name: "Notesage" });
    expect(item.className).toContain("--ns-a11y-scale");
    expect(item.style.fontWeight).toContain("--ns-a11y-weight");
    const menu = screen.getByRole("menu");
    expect(menu.getAttribute("data-a11y-scale")).not.toBeNull();
  });

  it("reflects the a11y scale/bold on the onboarding screen root", async () => {
    useMobileStore.setState({ grantState: "ungranted" });
    const { container } = renderWithProviders(<Onboarding />);

    dispatchA11y({ scale: 1.2, bold: true });

    const root = container.querySelector("[data-a11y-scale]");
    expect(root?.getAttribute("data-a11y-scale")).toBe("1.2");
    expect(root?.getAttribute("data-a11y-bold")).toBe("true");
  });

  it("wires the onboarding heading to scale via the a11y CSS variable", async () => {
    useMobileStore.setState({ grantState: "ungranted" });
    renderWithProviders(<Onboarding />);
    const heading = screen.getByText("Welcome to Notesage");
    expect(heading.className).toContain("--ns-a11y-scale");
  });

  it("wires the onboarding body paragraph to scale and weight via the a11y CSS variables", async () => {
    useMobileStore.setState({ grantState: "ungranted" });
    renderWithProviders(<Onboarding />);
    const body = screen.getByText(/Read your Notesage notes on the go/);
    expect(body.className).toContain("--ns-a11y-scale");
    expect(body.style.fontWeight).toContain("--ns-a11y-weight");
  });

  it("wires the onboarding feature title and description to scale and weight via the a11y CSS variables", async () => {
    useMobileStore.setState({ grantState: "ungranted" });
    renderWithProviders(<Onboarding />);
    const title = screen.getByText("Read-only & private");
    const description = screen.getByText(/single exception is the/);
    expect(title.className).toContain("--ns-a11y-scale");
    expect(title.style.fontWeight).toContain("--ns-a11y-weight");
    expect(description.className).toContain("--ns-a11y-scale");
    expect(description.style.fontWeight).toContain("--ns-a11y-weight");
  });

  it("leaves reader content typography untouched by the a11y bridge", async () => {
    setMockInvokeHandler("ios_read_file", () => "# Hi");
    setMockInvokeHandler("render_markdown_fragment", () => "<h1>Hi</h1>");
    useMobileStore.setState({ openDoc: { relPath: "note.md", name: "note.md" } });
    const { container } = renderWithProviders(<Reader />);
    await screen.findByText("Hi");

    dispatchA11y({ scale: 1.5, bold: true });

    // Reader never opts into the a11y bridge — no scoped root to find.
    expect(container.querySelector("[data-a11y-scale]")).toBeNull();
  });
});

describe("library re-pick", () => {
  it("the root folder button reopens the folder picker", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    setMockInvokeHandler("ios_pick_library_folder", () => ({ displayName: "Elsewhere", granted: true }));
    renderWithProviders(<LibraryBrowser />);
    await screen.findByRole("button", { name: "Change library folder" });
    fireEvent.click(screen.getByRole("button", { name: "Change library folder" }));
    await waitFor(() => expect(calledCommands()).toContain("ios_pick_library_folder"));
    // A granted pick lands the browser in the new library.
    await waitFor(() => expect(useMobileStore.getState().libraryName).toBe("Elsewhere"));
  });

  it("treats a dismissed picker as a non-event (no error surfaced)", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    setMockInvokeHandler("ios_pick_library_folder", () => ({ displayName: "", granted: false }));
    renderWithProviders(<LibraryBrowser />);
    const { toast } = await import("sonner");
    const btn = await screen.findByRole("button", { name: "Change library folder" });
    vi.mocked(toast.error).mockClear();
    fireEvent.click(btn);
    await waitFor(() => expect(calledCommands()).toContain("ios_pick_library_folder"));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
