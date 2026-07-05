// @vitest-environment jsdom

import "@/test/tauri-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen } from "@/test/component-harness";
import { SidebarRowIndicators } from "../SidebarRowIndicators";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitStore } from "@/stores/git-store";
import { useEditorStore } from "@/stores/editor-store";
import { useExternalChangeStore } from "@/stores/external-change-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useConnectionsStore } from "@/stores/connections-store";
import type { ProjectMetadata } from "@/stores/project-metadata-store";
import type { ExternalChangeEntry } from "@/stores/external-change-store";
import type { Connection } from "@/lib/ai/connections";

/**
 * #129 composition tests for `SidebarRowIndicators`. Each test seeds the
 * relevant stores (git-store, external-change-store, editor-store,
 * project-metadata-store) and asserts the observable indicator markup.
 */

function resetStores() {
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
    expandedFolders: new Set<string>(),
    explorerCollapsed: false,
    projectsCollapsed: false,
    notesCollapsed: false,
  });
  useGitStore.setState({ repos: {} });
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    externalChanges: {},
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  useExternalChangeStore.setState({ changes: {} } as unknown as Parameters<typeof useExternalChangeStore.setState>[0]);
  useSettingsStore.setState({ gitEnabled: true } as unknown as Parameters<typeof useSettingsStore.setState>[0]);
  useProjectMetadataStore.setState({ metadataMap: {} } as unknown as Parameters<typeof useProjectMetadataStore.setState>[0]);
  useConnectionsStore.setState({ connections: [] } as unknown as Parameters<typeof useConnectionsStore.setState>[0]);
}

function makeConnection(overrides: Partial<Connection>): Connection {
  return {
    id: "conn-test",
    label: "Test Connection",
    provider: "anthropic",
    auth: "api_key",
    capabilities: ["interactive"],
    ...overrides,
  } as Connection;
}

describe("SidebarRowIndicators (#129)", () => {
  beforeEach(() => {
    resetStores();
  });

  it("renders nothing when the row has no state to surface", () => {
    const { container } = renderWithProviders(
      <SidebarRowIndicators path="/p/a/file.md" kind="file" />,
    );
    expect(container.querySelector("[data-sidebar-indicators]")).toBeNull();
  });

  it("renders the git status glyph + tooltip for a modified file", () => {
    // Seed workspace with the owning project so the hook can resolve the
    // repo root. Then seed the git-store with a modified status.
    useWorkspaceStore.setState((prev) => ({
      ...prev,
      projects: [{ path: "/p", name: "p", fileTree: [] }],
    }));
    useGitStore.setState({
      repos: {
        "/p": {
          isGitRepo: true,
          currentBranch: "main",
          fileStatuses: [{ path: "/p/a/file.md", status: "modified", staged: false }],
          fileStatusMap: new Map([
            ["/p/a/file.md", [{ path: "/p/a/file.md", status: "modified", staged: false }]],
          ]),
          isLoading: false,
          statusError: false,
        },
      },
    });

    renderWithProviders(
      <SidebarRowIndicators path="/p/a/file.md" kind="file" />,
    );

    // The M glyph lands with an aria-label that embeds the tooltip. The
    // hook normalizes "Modified" as the tooltip string.
    expect(screen.getByLabelText(/Git: Modified/i)).toBeTruthy();
  });

  it("renders the aggregate '●' for a folder with git changes inside it", () => {
    useWorkspaceStore.setState((prev) => ({
      ...prev,
      projects: [{ path: "/p", name: "p", fileTree: [] }],
    }));
    useGitStore.setState({
      repos: {
        "/p": {
          isGitRepo: true,
          currentBranch: "main",
          fileStatuses: [{ path: "/p/sub/file.md", status: "modified", staged: false }],
          fileStatusMap: new Map([
            ["/p/sub/file.md", [{ path: "/p/sub/file.md", status: "modified", staged: false }]],
          ]),
          isLoading: false,
          statusError: false,
        },
      },
    });

    renderWithProviders(<SidebarRowIndicators path="/p/sub" kind="folder" />);

    expect(screen.getByLabelText(/Git: Contains changes/i)).toBeTruthy();
  });

  it("renders the external-change dot when the file has a pending external change", () => {
    const entry: ExternalChangeEntry = {
      filePath: "/p/a/file.md",
      fileName: "file.md",
      oldContent: "original",
      newContent: "updated",
      hunks: [],
      timestamp: Date.now(),
      status: "pending",
    };
    useExternalChangeStore.setState({
      changes: { "/p/a/file.md": entry },
    } as unknown as Parameters<typeof useExternalChangeStore.setState>[0]);

    renderWithProviders(
      <SidebarRowIndicators path="/p/a/file.md" kind="file" />,
    );

    expect(
      screen.getByLabelText("External change pending review"),
    ).toBeTruthy();
  });

  it("renders the AI-lock padlock on a project row carrying aiLock metadata", () => {
    const lockedMeta: ProjectMetadata = {
      name: "Locked Project",
      description: "",
      ai: {},
      aiLock: {
        connectionId: "conn-anthropic",
        lockedAt: Date.now(),
      },
    } as ProjectMetadata;
    useProjectMetadataStore.setState({
      metadataMap: { "/p": lockedMeta },
    } as unknown as Parameters<typeof useProjectMetadataStore.setState>[0]);
    useConnectionsStore.setState({
      connections: [makeConnection({ id: "conn-anthropic", label: "Claude — Personal" })],
    } as unknown as Parameters<typeof useConnectionsStore.setState>[0]);

    renderWithProviders(<SidebarRowIndicators path="/p" kind="project" />);

    expect(screen.getByLabelText("Locked to Claude — Personal")).toBeTruthy();
  });

  it("suppresses the AI-lock padlock on file + folder rows even when metadata is set", () => {
    const lockedMeta: ProjectMetadata = {
      name: "Locked Project",
      description: "",
      ai: {},
      aiLock: {
        connectionId: "conn-anthropic",
        lockedAt: Date.now(),
      },
    } as ProjectMetadata;
    useProjectMetadataStore.setState({
      metadataMap: { "/p/a/file.md": lockedMeta },
    } as unknown as Parameters<typeof useProjectMetadataStore.setState>[0]);

    renderWithProviders(
      <SidebarRowIndicators path="/p/a/file.md" kind="file" />,
    );

    // File kind ignores aiLock entirely — no padlock regardless of
    // metadata on the path (which is unrealistic for files anyway).
    expect(
      screen.queryByLabelText(/^Locked to/),
    ).toBeNull();
  });

  // Branch-diff-review re-wire — repo-backed project / folder rows carry a
  // small GitBranch badge so the user can see which roots are git repos
  // (and thus which rows offer "Compare branch…"). Derived purely from
  // git-store state; gated on settings.gitEnabled.
  describe("git repo badge", () => {
    function seedRepo(path: string, overrides: Partial<{ isGitRepo: boolean; currentBranch: string }> = {}) {
      useGitStore.setState({
        repos: {
          [path]: {
            isGitRepo: true,
            currentBranch: "main",
            fileStatuses: [],
            fileStatusMap: new Map(),
            isLoading: false,
            statusError: false,
            ...overrides,
          },
        },
      });
    }

    it("shows the badge with the current branch tooltip on a repo-backed project row", () => {
      seedRepo("/p", { currentBranch: "feature/x" });
      renderWithProviders(<SidebarRowIndicators path="/p" kind="project" />);
      expect(
        screen.getByLabelText("Git repository — on feature/x"),
      ).toBeTruthy();
    });

    it("shows the badge on a repo-backed folder row", () => {
      seedRepo("/f");
      renderWithProviders(<SidebarRowIndicators path="/f" kind="folder" />);
      expect(screen.getByLabelText("Git repository — on main")).toBeTruthy();
    });

    it("falls back to a generic tooltip when the branch is not yet known", () => {
      seedRepo("/p", { currentBranch: "" });
      renderWithProviders(<SidebarRowIndicators path="/p" kind="project" />);
      expect(screen.getByLabelText("Git repository")).toBeTruthy();
    });

    it("does not show the badge on a non-repo project row", () => {
      useGitStore.setState({
        repos: {
          "/p": {
            isGitRepo: false,
            currentBranch: "",
            fileStatuses: [],
            fileStatusMap: new Map(),
            isLoading: false,
            statusError: false,
          },
        },
      });
      const { container } = renderWithProviders(
        <SidebarRowIndicators path="/p" kind="project" />,
      );
      expect(container.querySelector("[data-sidebar-indicators]")).toBeNull();
    });

    it("hides the badge when git integration is disabled", () => {
      seedRepo("/p");
      useSettingsStore.setState({
        gitEnabled: false,
      } as unknown as Parameters<typeof useSettingsStore.setState>[0]);
      const { container } = renderWithProviders(
        <SidebarRowIndicators path="/p" kind="project" />,
      );
      expect(container.querySelector("[data-sidebar-indicators]")).toBeNull();
    });

    it("never shows the badge on file rows even when git-store has an entry for the path", () => {
      seedRepo("/p/a/file.md");
      const { container } = renderWithProviders(
        <SidebarRowIndicators path="/p/a/file.md" kind="file" />,
      );
      expect(container.querySelector("[data-sidebar-indicators]")).toBeNull();
    });
  });

  // Regression lock for the 2026-04-27 audit finding #18 — the padlock
  // tooltip used to render `aiLock.connectionId` directly, leaking the
  // raw store id (e.g. `conn-1774086797085-ak920t`) to the user. The
  // fix routes through `describeLockTarget` + a `connections-store`
  // lookup so the user-set label is shown instead.
  describe("aiLock tooltip — connection label not raw id (audit #18)", () => {
    it("renders the connection label when the connection exists", () => {
      const lockedMeta: ProjectMetadata = {
        name: "Locked Project",
        description: "",
        ai: {},
        aiLock: {
          connectionId: "conn-1774086797085-ak920t",
          lockedAt: Date.now(),
        },
      } as ProjectMetadata;
      useProjectMetadataStore.setState({
        metadataMap: { "/p": lockedMeta },
      } as unknown as Parameters<typeof useProjectMetadataStore.setState>[0]);
      useConnectionsStore.setState({
        connections: [makeConnection({ id: "conn-1774086797085-ak920t", label: "Claude — Personal" })],
      } as unknown as Parameters<typeof useConnectionsStore.setState>[0]);

      renderWithProviders(<SidebarRowIndicators path="/p" kind="project" />);

      // Label IS the descriptive text — appears in the aria-label AND
      // the tooltip content (Radix portals the latter, harder to query
      // in jsdom; the aria-label is the assertion-friendly mirror).
      expect(screen.getByLabelText("Locked to Claude — Personal")).toBeTruthy();
      expect(
        screen.queryByLabelText(/conn-1774086797085-ak920t/),
      ).toBeNull();
    });

    it("falls back to the connection id with an (unavailable) suffix when the connection has been removed", () => {
      const lockedMeta: ProjectMetadata = {
        name: "Locked Project",
        description: "",
        ai: {},
        aiLock: {
          connectionId: "conn-removed-123",
          lockedAt: Date.now(),
        },
      } as ProjectMetadata;
      useProjectMetadataStore.setState({
        metadataMap: { "/p": lockedMeta },
      } as unknown as Parameters<typeof useProjectMetadataStore.setState>[0]);
      // connections-store intentionally empty — the lock outlived the
      // connection. We surface the raw id so the user can still
      // identify which connection used to be locked, and the
      // "(unavailable)" suffix tells them the lock no longer resolves.
      useConnectionsStore.setState({
        connections: [],
      } as unknown as Parameters<typeof useConnectionsStore.setState>[0]);

      renderWithProviders(<SidebarRowIndicators path="/p" kind="project" />);

      expect(
        screen.getByLabelText("Locked to conn-removed-123 (unavailable)"),
      ).toBeTruthy();
    });
  });
});
